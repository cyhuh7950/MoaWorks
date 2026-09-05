from __future__ import annotations
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import make_msgid
from hashlib import sha256
from pathlib import Path
import re
from secrets import compare_digest
import smtplib
import ssl
from typing import Protocol

from app.services.mail_mime_builder import OutboundAttachment, OutboundMessage, build_mail_message
from app.services.mail_daily_send_quota import (
    MailDailyQuotaUnavailable,
    MailDailySendLimitExceeded,
)
from app.services.mail_transports import MailTransportFailure, send_smtp_data, smtp_session, smtp_failure

@dataclass(frozen=True)
class RecipientClassification:
    internal: list[tuple[str, str, str]]
    external: list[tuple[str, str]]

class MailDeliveryPolicy:
    def classify(self, company_domain: str, active_users: dict[str, str], recipients: list[tuple[str, str]]) -> RecipientClassification:
        domain = company_domain.strip().lower()
        users = {email.lower(): user_id for email, user_id in active_users.items()}
        internal, external = [], []
        for kind, raw_email in recipients:
            email = raw_email.strip().lower()
            user_id = users.get(email)
            if user_id:
                internal.append((kind, email, user_id))
            elif email.rsplit("@", 1)[-1] == domain:
                raise ValueError("등록되지 않은 사내 주소로는 메일을 보낼 수 없습니다.")
            else:
                external.append((kind, email))
        return RecipientClassification(internal, external)

@dataclass(frozen=True)
class DeliveryResult:
    status: str
    relay_response: str | None = None
    error_message: str | None = None
    next_attempt_at: datetime | None = None

class RelayDeliveryError(RuntimeError):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient

class RelayAdapter(Protocol):
    def prepare(self, envelope: dict, provider: dict): ...

    def send_prepared(self, prepared, provider: dict) -> str: ...

_SECRET_RE = re.compile(r"(?i)(password|token|authorization|secret)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+")
_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
def mask_delivery_error(message: str) -> str:
    masked = _SECRET_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", str(message))
    masked = _EMAIL_RE.sub("[EMAIL]", masked)
    return masked[:500]

def _job_value(job, name: str, default=None):
    return job.get(name, default) if isinstance(job, dict) else getattr(job, name, default)


class MailDeliveryService:
    """메일 상세 화면에서 외부 발송 상태를 조회하는 호환 서비스."""

    def list_mail_external_deliveries(self, cursor, mail_id: str) -> list[dict]:
        cursor.execute(
            """
            SELECT q.id, r.recipient_email, p.provider_type, q.status,
                   q.attempt_count, q.next_attempt_at, q.sent_at
            FROM mail_delivery_queue q
            JOIN mail_recipients r ON r.id = q.recipient_id
            JOIN mail_provider_configs p ON p.id = q.provider_config_id
            WHERE q.mail_id = %s AND r.delivery_source = 'direct'
            ORDER BY r.recipient_kind, r.recipient_email
            """,
            (mail_id,),
        )
        return cursor.fetchall()

class MailDeliveryWorker:
    def __init__(self, worker_id: str, adapter: RelayAdapter, *, quota=None):
        self.worker_id, self.adapter, self.quota = worker_id, adapter, quota
    def deliver_claimed(self, job, provider: dict, *, before_data=None) -> DeliveryResult:
        if not provider.get("delivery_enabled") or provider.get("last_test_status") != "success":
            return DeliveryResult("blocked", error_message="외부 발송 잠금 또는 연결 검증이 필요합니다.")
        if provider.get("provider_type") == "oci_email_delivery" and _job_value(job, "recipient_suppressed", False):
            return DeliveryResult("blocked", error_message="OCI suppression 목록에 등록된 수신자입니다.")
        attempt = int(_job_value(job, "attempt_count", 0)) + 1
        envelope = {key: _job_value(job, key) for key in ("mail_id","message_id","queue_id","delivery_kind","sender_email","sender_display_name","reply_to_email","message_encoding","recipient_email","subject","body_text","body_html","attachments")}
        if _job_value(job, 'delivery_kind') == 'submission':
            envelope.update({key: _job_value(job, key) for key in ('raw_storage_key', 'raw_sha256', 'raw_size')})
        if _job_value(job, "delivery_kind") == "auto_forward" or _job_value(job, "delivery_kind") == "out_of_office":
            envelope["sender_email"] = _job_value(job, "sender_email_override") or envelope["sender_email"]
            envelope["sender_display_name"] = _job_value(job, "sender_display_name_override") or envelope["sender_display_name"]
            envelope["reply_to_email"] = _job_value(job, "reply_to_email_override") or envelope["reply_to_email"]
        phase = 'prepare'
        try:
            if hasattr(self.adapter, "prepare") and hasattr(self.adapter, "send_prepared"):
                prepared = self.adapter.prepare(envelope, provider)
                phase = 'send'
                ownership_options = {'before_data': before_data} if before_data is not None else {}
                if self.quota is not None and getattr(
                    self.adapter, "supports_attempt_reservation", False
                ):
                    response = self.adapter.send_prepared(
                        prepared,
                        provider,
                        before_network_attempt=self.quota.reserve_attempt,
                        **ownership_options,
                    )
                else:
                    if self.quota is not None:
                        self.quota.reserve_attempt()
                    response = self.adapter.send_prepared(prepared, provider, **ownership_options)
            else:  # compatibility for legacy in-process callers without quota
                if self.quota is not None:
                    raise MailDailyQuotaUnavailable(
                        "quota-aware delivery requires prepare/send_prepared adapter"
                    )
                if before_data is not None:
                    raise RelayDeliveryError('소유권 확인을 지원하지 않는 발송 adapter입니다.')
                phase = 'send'
                response = self.adapter.send(envelope, provider)
            return DeliveryResult("sent", relay_response=mask_delivery_error(response))
        except MailDailySendLimitExceeded as exc:
            return DeliveryResult(
                "quota_deferred",
                error_message="MAIL_DAILY_SEND_LIMIT_EXCEEDED",
                next_attempt_at=exc.reset_at,
            )
        except MailDailyQuotaUnavailable:
            return DeliveryResult(
                "quota_deferred",
                error_message="MAIL_DAILY_QUOTA_UNAVAILABLE",
                next_attempt_at=datetime.now(UTC) + timedelta(seconds=60),
            )
        except (RelayDeliveryError, MailTransportFailure) as exc:
            if phase == 'prepare':
                return DeliveryResult('failed', error_message=mask_delivery_error('PREPARE_FAILED: 발송 자료/설정 준비 실패'))
            if getattr(exc, 'result_unknown', False):
                return DeliveryResult('result_unknown', error_message=mask_delivery_error(str(exc)))
            maximum = int(provider.get("max_retry_count", 3))
            error = mask_delivery_error(str(exc))
            if exc.transient and attempt < maximum:
                delay = int(provider.get("retry_interval_sec", 60)) * (2 ** (attempt - 1))
                return DeliveryResult("retry_pending", error_message=error, next_attempt_at=datetime.now(UTC)+timedelta(seconds=delay))
            return DeliveryResult("failed", error_message=error)
        except Exception:
            return DeliveryResult('failed' if phase == 'prepare' else 'result_unknown',
                error_message='PREPARE_FAILED: 발송 자료/설정 준비 실패' if phase == 'prepare' else 'SEND_RESULT_UNKNOWN: 중복 위험 확인 필요')

class SmtpRelayAdapter:
    def build_message(self, envelope: dict, provider: dict) -> EmailMessage:
        display_name = (envelope.get("sender_display_name") or "").strip()
        sender_email = envelope["sender_email"] if envelope.get("delivery_kind") in {"auto_forward", "out_of_office"} else (provider.get("from_address") or envelope["sender_email"])
        attachments: list[OutboundAttachment] = []
        for attachment in envelope.get("attachments") or []:
            path = Path(str(attachment.get("path") or ""))
            if not path.is_file():
                raise RelayDeliveryError("첨부 파일을 찾을 수 없습니다.", transient=False)
            content = path.read_bytes()
            expected_size = attachment.get("size_bytes")
            if expected_size is not None and len(content) != int(expected_size):
                raise RelayDeliveryError("첨부 파일 저장 상태가 올바르지 않습니다.", transient=False)
            expected_sha256 = attachment.get("sha256")
            if expected_sha256 is not None and (
                not isinstance(expected_sha256, str)
                or not compare_digest(expected_sha256, sha256(content).hexdigest())
            ):
                raise RelayDeliveryError("첨부 파일 저장 상태가 올바르지 않습니다.", transient=False)
            file_name = Path(str(attachment.get("file_name") or "attachment.bin").replace("\\", "/")).name[:255]
            attachments.append(
                OutboundAttachment(
                    file_name=file_name,
                    content_type=str(attachment.get("content_type") or "application/octet-stream"),
                    content=content,
                    content_disposition=str(attachment.get("content_disposition") or "attachment"),
                    content_id=attachment.get("content_id"),
                )
            )
        sender_domain = sender_email.rsplit("@", 1)[-1] if "@" in sender_email else "localhost"
        message_id = str(envelope.get("message_id") or "").strip()
        if not message_id:
            stable_id = str(envelope.get("mail_id") or envelope.get("queue_id") or "").strip()
            message_id = f"<{stable_id}@{sender_domain}>" if stable_id else make_msgid(domain=sender_domain)
        return build_mail_message(
            OutboundMessage(
                sender_email=sender_email,
                sender_display_name=display_name,
                reply_to_email=envelope.get("reply_to_email"),
                message_encoding=str(envelope.get("message_encoding") or "utf-8"),
                recipient_email=envelope["recipient_email"],
                subject=envelope["subject"],
                body_text=envelope["body_text"],
                body_html=envelope.get("body_html"),
                message_id=message_id,
                attachments=tuple(attachments),
            )
        )

    def send(self, envelope: dict, provider: dict, *, before_data=None) -> str:
        try:
            message = self.build_message(envelope, provider)
        except ValueError as exc:
            raise RelayDeliveryError(str(exc), transient=False) from exc
        return self.send_prepared(message, provider, envelope=envelope, before_data=before_data)

    def send_prepared(self, message, provider, *, envelope, before_data=None):
        host, port = provider["relay_host"], int(provider["relay_port"])
        tls_mode = provider.get("tls_mode", "starttls")
        client_cls = smtplib.SMTP_SSL if tls_mode == "tls" else smtplib.SMTP
        try:
            client = (client_cls(host, port, timeout=10, context=ssl.create_default_context())
                      if tls_mode == 'tls' else client_cls(host, port, timeout=10))
            with smtp_session(client):
                client.ehlo()
                if tls_mode == "starttls":
                    client.starttls(context=ssl.create_default_context()); client.ehlo()
                if provider.get("username"):
                    client.login(provider["username"], provider["password"])
                sender = (envelope['sender_email'] if envelope.get('delivery_kind') in {'auto_forward','out_of_office'}
                          else provider.get('from_address') or envelope['sender_email'])
                send_smtp_data(client,message,sender,envelope['recipient_email'],before_data=before_data)
                return "relay accepted"
        except Exception as exc:
            raise smtp_failure(exc) from exc
