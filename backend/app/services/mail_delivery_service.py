from __future__ import annotations
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.headerregistry import Address
from pathlib import Path
import re
import smtplib
import ssl
from typing import Protocol

from app.services.mail_transports import MailTransportFailure

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
    def send(self, envelope: dict, provider: dict) -> str: ...

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
    def __init__(self, worker_id: str, adapter: RelayAdapter):
        self.worker_id, self.adapter = worker_id, adapter
    def deliver_claimed(self, job, provider: dict) -> DeliveryResult:
        if not provider.get("delivery_enabled") or provider.get("last_test_status") != "success":
            return DeliveryResult("blocked", error_message="외부 발송 잠금 또는 연결 검증이 필요합니다.")
        if provider.get("provider_type") == "oci_email_delivery" and _job_value(job, "recipient_suppressed", False):
            return DeliveryResult("blocked", error_message="OCI suppression 목록에 등록된 수신자입니다.")
        attempt = int(_job_value(job, "attempt_count", 0)) + 1
        envelope = {key: _job_value(job, key) for key in ("queue_id","delivery_kind","sender_email","sender_display_name","reply_to_email","message_encoding","recipient_email","subject","body_text","body_html","attachments")}
        if _job_value(job, "delivery_kind") == "auto_forward" or _job_value(job, "delivery_kind") == "out_of_office":
            envelope["sender_email"] = _job_value(job, "sender_email_override") or envelope["sender_email"]
            envelope["sender_display_name"] = _job_value(job, "sender_display_name_override") or envelope["sender_display_name"]
            envelope["reply_to_email"] = _job_value(job, "reply_to_email_override") or envelope["reply_to_email"]
        try:
            response = self.adapter.send(envelope, provider)
            return DeliveryResult("sent", relay_response=mask_delivery_error(response))
        except (RelayDeliveryError, MailTransportFailure) as exc:
            maximum = int(provider.get("max_retry_count", 3))
            error = mask_delivery_error(str(exc))
            if exc.transient and attempt < maximum:
                delay = int(provider.get("retry_interval_sec", 60)) * (2 ** (attempt - 1))
                return DeliveryResult("retry_pending", error_message=error, next_attempt_at=datetime.now(UTC)+timedelta(seconds=delay))
            return DeliveryResult("failed", error_message=error)

class SmtpRelayAdapter:
    def build_message(self, envelope: dict, provider: dict) -> EmailMessage:
        message = EmailMessage()
        display_name = (envelope.get("sender_display_name") or "").strip()
        sender_email = envelope["sender_email"] if envelope.get("delivery_kind") in {"auto_forward", "out_of_office"} else (provider.get("from_address") or envelope["sender_email"])
        message["From"] = Address(display_name=display_name, addr_spec=sender_email) if display_name else sender_email
        message["To"] = envelope["recipient_email"]
        message["Subject"] = envelope["subject"]
        if envelope.get("reply_to_email"):
            message["Reply-To"] = envelope["reply_to_email"]
        charset = envelope.get("message_encoding") or "utf-8"
        message.set_content(envelope["body_text"], charset=charset)
        if envelope.get("body_html"):
            message.add_alternative(envelope["body_html"], subtype="html", charset=charset)
        for attachment in envelope.get("attachments") or []:
            path = Path(str(attachment.get("path") or ""))
            if not path.is_file():
                raise RelayDeliveryError("첨부 파일을 찾을 수 없습니다.", transient=False)
            content_type = str(attachment.get("content_type") or "application/octet-stream")
            maintype, separator, subtype = content_type.partition("/")
            if not separator or not maintype or not subtype:
                maintype, subtype = "application", "octet-stream"
            file_name = Path(str(attachment.get("file_name") or "attachment.bin").replace("\\", "/")).name[:255]
            message.add_attachment(
                path.read_bytes(),
                maintype=maintype,
                subtype=subtype,
                filename=file_name,
            )
        return message

    def send(self, envelope: dict, provider: dict) -> str:
        message = self.build_message(envelope, provider)
        host, port = provider["relay_host"], int(provider["relay_port"])
        tls_mode = provider.get("tls_mode", "starttls")
        client_cls = smtplib.SMTP_SSL if tls_mode == "tls" else smtplib.SMTP
        try:
            with client_cls(host, port, timeout=10, context=ssl.create_default_context()) if tls_mode == "tls" else client_cls(host, port, timeout=10) as client:
                client.ehlo()
                if tls_mode == "starttls":
                    client.starttls(context=ssl.create_default_context()); client.ehlo()
                if provider.get("username"):
                    client.login(provider["username"], provider["password"])
                if envelope.get("delivery_kind") in {"auto_forward", "out_of_office"}:
                    refused = client.send_message(message, from_addr=envelope["sender_email"], to_addrs=[envelope["recipient_email"]])
                else:
                    refused = client.send_message(message)
                if refused:
                    raise RelayDeliveryError("relay recipient refused", transient=False)
                return "relay accepted"
        except (TimeoutError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError) as exc:
            raise RelayDeliveryError(str(exc), transient=True) from exc
        except smtplib.SMTPException as exc:
            raise RelayDeliveryError(str(exc), transient=False) from exc
