from __future__ import annotations

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

try:
    import dns.resolver
except Exception:  # pragma: no cover - optional dependency fallback
    dns = None  # type: ignore[assignment]

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailDeliveryAttemptItem,
    MailDeliveryEventItem,
    MailDeliveryOutcomeSummary,
    MailDeliveryProviderView,
    MailDeliveryQueueItem,
    MailDeliveryQueueResponse,
    MailDeliveryQueueSummary,
    MailDeliveryRetryResponse,
    MailDeliveryStatusResponse,
)
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.observability_service import ObservabilityService
from app.services.mail_transports import (
    OciEmailDeliveryTransport,
    OutboundMessage,
    RelaySmtpConfig,
    SelfHostedSmtpTransport,
)
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService

_PROVIDER_KEY = "self_hosted"
_LEGACY_PROVIDER_KEY = "self_hosted_smtp"
_QUEUE_TERMINAL = {"sent", "failed", "cancelled"}
_QUEUE_ACTIVE = {"queued", "retry_pending", "failed"}


class MailDeliveryService:
    def __init__(
        self,
        *,
        self_hosted_transport=None,
        oci_transport=None,
        security=None,
    ) -> None:
        self.db = PostgresService()
        self.self_hosted_transport = self_hosted_transport or SelfHostedSmtpTransport(
            mx_resolver=self._resolve_smtp_hosts
        )
        self.oci_transport = oci_transport or OciEmailDeliveryTransport()
        self.security = security or SecurityService()

    def ensure_provider(self, cursor, company_id: str, company_domain: str) -> dict[str, Any]:
        cursor.execute(
            """
            SELECT *
            FROM mail_delivery_providers
            WHERE company_id = %s AND provider_key IN (%s, %s)
            ORDER BY CASE WHEN provider_key = %s THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (company_id, _PROVIDER_KEY, _LEGACY_PROVIDER_KEY, _PROVIDER_KEY),
        )
        row = cursor.fetchone()
        if row is not None:
            return row

        now = self._now()
        provider_id = self._new_id("mailprov")
        cursor.execute(
            """
            INSERT INTO mail_delivery_providers (
                id, company_id, provider_key, enabled, sender_domain, helo_name,
                sender_address, use_tls, timeout_sec, max_retry_count, retry_interval_sec,
                created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                provider_id,
                company_id,
                _PROVIDER_KEY,
                True,
                company_domain.lower(),
                f"mail.{company_domain.lower()}",
                f"no-reply@{company_domain.lower()}",
                False,
                15,
                3,
                300,
                now,
                now,
            ),
        )
        created = cursor.fetchone()
        if created is None:
            raise ValueError("자체 SMTP Provider 생성에 실패했습니다.")
        return created

    def get_status(self, company_id: str) -> MailDeliveryStatusResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._fetch_provider(cursor, company_id)
                summary = self._fetch_summary(cursor, company_id)
        return MailDeliveryStatusResponse(provider=self._to_provider_view(provider), summary=summary)

    def get_queue(self, company_id: str, limit: int = 40) -> MailDeliveryQueueResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._fetch_provider(cursor, company_id)
                summary = self._fetch_summary(cursor, company_id)
                cursor.execute(
                    """
                    SELECT *
                    FROM mail_delivery_queue
                    WHERE company_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (company_id, limit),
                )
                queue_rows = cursor.fetchall()
                queue_ids = [row["id"] for row in queue_rows]
                attempts = self._fetch_attempts(cursor, queue_ids)
                events = self._fetch_events(cursor, queue_ids)
        return MailDeliveryQueueResponse(
            provider=self._to_provider_view(provider),
            summary=summary,
            queue=[self._to_queue_item(row) for row in queue_rows],
            attempts=attempts,
            events=events,
        )

    def enqueue_external_deliveries(
        self,
        *,
        cursor,
        actor: AuthUserSummary,
        provider: dict[str, Any],
        mail_id: str,
        sender_email: str,
        subject: str,
        body_text: str,
        body_html: str | None,
        recipients: list[str],
    ) -> list[dict[str, Any]]:
        now = self._now()
        queued_rows: list[dict[str, Any]] = []
        for recipient in recipients:
            queue_id = self._new_id("mailqueue")
            cursor.execute(
                """
                INSERT INTO mail_delivery_queue (
                    id, company_id, provider_id, provider_key, mail_id, sender_email,
                    recipient_email, subject, body_text, body_html, status, attempt_count,
                    last_error, next_retry_at, sent_at, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    queue_id,
                    actor.companyId,
                    provider["id"],
                    provider["provider_key"],
                    mail_id,
                    sender_email,
                    recipient,
                    subject,
                    body_text,
                    body_html,
                    "queued",
                    0,
                    None,
                    None,
                    None,
                    now,
                    now,
                ),
            )
            row = cursor.fetchone()
            if row is None:
                raise ValueError("외부 발송 큐 생성에 실패했습니다.")
            queued_rows.append(row)
            self._insert_event(
                cursor,
                queue_id=row["id"],
                event_type="mail.delivery.queue.created",
                message="외부 발송 큐가 생성되었습니다.",
                payload={"recipient": recipient, "provider": provider["provider_key"]},
            )
        return queued_rows

    def process_queue_ids(self, company_id: str, queue_ids: list[str]) -> list[MailDeliveryQueueItem]:
        self.db.ensure_migrations_applied()
        processed: list[MailDeliveryQueueItem] = []
        for queue_id in queue_ids:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT q.*, p.sender_domain, p.helo_name, p.sender_address,
                               p.use_tls, p.timeout_sec, p.max_retry_count, p.retry_interval_sec,
                               p.enabled, p.smtp_host, p.smtp_port, p.smtp_username,
                               p.encrypted_password
                        FROM mail_delivery_queue q
                        JOIN mail_delivery_providers p ON p.id = q.provider_id
                        WHERE q.id = %s AND q.company_id = %s
                        """,
                        (queue_id, company_id),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        raise ValueError("대상 외부 발송 큐를 찾을 수 없습니다.")
                    if row["status"] in _QUEUE_TERMINAL:
                        processed.append(self._to_queue_item(row))
                        continue
                    updated = self._attempt_delivery(cursor, row)
                connection.commit()
            processed.append(self._to_queue_item(updated))
            self._emit_observability(updated)
        return processed

    def retry_queue(self, company_id: str, queue_id: str) -> MailDeliveryRetryResponse:
        items = self.process_queue_ids(company_id, [queue_id])
        if not items:
            raise ValueError("재시도 결과를 확인할 수 없습니다.")
        item = items[0]
        message = "외부 발송을 다시 시도했습니다."
        if item.status == "retry_pending":
            message = "외부 발송 실패로 재시도가 예약되었습니다."
        elif item.status == "failed":
            message = "외부 발송이 실패했고 최대 재시도 횟수에 도달했습니다."
        elif item.status == "sent":
            message = "외부 발송이 성공했습니다."
        return MailDeliveryRetryResponse(queueItem=item, message=message)

    def process_mail(self, company_id: str, mail_id: str) -> list[MailDeliveryQueueItem]:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id
                    FROM mail_delivery_queue
                    WHERE company_id = %s AND mail_id = %s
                    ORDER BY created_at ASC
                    """,
                    (company_id, mail_id),
                )
                queue_ids = [row["id"] for row in cursor.fetchall()]
        if not queue_ids:
            return []
        return self.process_queue_ids(company_id, queue_ids)

    def build_delivery_summary(
        self,
        *,
        provider: dict[str, Any],
        internal_count: int,
        external_count: int,
        queue_items: list[MailDeliveryQueueItem],
    ) -> MailDeliveryOutcomeSummary:
        return MailDeliveryOutcomeSummary(
            provider=provider["provider_key"],
            engineEnabled=bool(provider["enabled"]),
            internalRecipientCount=internal_count,
            externalRecipientCount=external_count,
            queuedCount=sum(1 for item in queue_items if item.status == "queued"),
            sentCount=sum(1 for item in queue_items if item.status == "sent"),
            failedCount=sum(1 for item in queue_items if item.status == "failed"),
            retryPendingCount=sum(1 for item in queue_items if item.status == "retry_pending"),
        )

    def list_mail_external_deliveries(self, cursor, mail_id: str) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT id, recipient_email, provider_key, status, attempt_count, last_error, next_retry_at, sent_at
            FROM mail_delivery_queue
            WHERE mail_id = %s
            ORDER BY created_at ASC
            """,
            (mail_id,),
        )
        return cursor.fetchall()

    def _attempt_delivery(self, cursor, row: dict[str, Any]) -> dict[str, Any]:
        now = self._now()
        if not row["enabled"]:
            return self._mark_queue_result(
                cursor,
                row,
                status="failed",
                last_error="자체 SMTP 엔진이 비활성화되어 있습니다.",
                next_retry_at=None,
                sent_at=None,
                response_detail="provider_disabled",
            )

        attempt_count = int(row["attempt_count"] or 0) + 1
        cursor.execute(
            """
            UPDATE mail_delivery_queue
            SET status = %s,
                attempt_count = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            ("sending", attempt_count, now, row["id"]),
        )
        sending_row = cursor.fetchone()
        if sending_row is None:
            raise ValueError("외부 발송 큐 갱신에 실패했습니다.")
        sending_row = {**row, **sending_row}
        self._insert_event(cursor, queue_id=row["id"], event_type="mail.delivery.attempt", message="외부 SMTP 발송을 시도했습니다.", payload={"attemptCount": attempt_count})

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

        try:
            ObservabilityService().emit_event(
                EventEnvelope(
                    eventId=self._new_id("evt"),
                    eventType=event_type,
                    category=MonitoringCategory.MAIL,
                    severity=severity,
                    resourceType="mail_delivery_queue",
                    resourceId=row["id"],
                    requestId=self._new_id("req"),
                    dedupKey=f"mail-delivery:{row['id']}:{row['status']}",
                    title="외부 SMTP 발송 상태",
                    message=row.get("last_error") or f"외부 발송 상태: {row['status']}",
                    source="mail-delivery-service",
                    companyId=row["company_id"],
                    actorUserId=row.get("sender_email"),
                    visibility=Visibility.ADMIN,
                    payload={
                        "recipient": row["recipient_email"],
                        "provider": row["provider_key"],
                        "status": row["status"],
                        "attemptCount": int(row.get("attempt_count") or 0),
                        "lastError": row.get("last_error"),
                    },
                )
            )
        except Exception:
            return

    def _to_provider_view(self, row: dict[str, Any]) -> MailDeliveryProviderView:
        return MailDeliveryProviderView(
            providerId=row["id"],
            companyId=row["company_id"],
            providerKey=row["provider_key"],
            enabled=bool(row["enabled"]),
            senderDomain=row["sender_domain"],
            heloName=row["helo_name"],
            senderAddress=row["sender_address"],
            useTls=bool(row["use_tls"]),
            timeoutSec=int(row["timeout_sec"]),
            maxRetryCount=int(row["max_retry_count"]),
            retryIntervalSec=int(row["retry_interval_sec"]),
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )

    def _to_queue_item(self, row: dict[str, Any]) -> MailDeliveryQueueItem:
        return MailDeliveryQueueItem(
            queueId=row["id"],
            mailId=row["mail_id"],
            sender=row["sender_email"],
            recipient=row["recipient_email"],
            subject=row["subject"],
            provider=row["provider_key"],
            status=row["status"],
            attemptCount=int(row.get("attempt_count") or 0),
            lastError=row.get("last_error"),
            nextRetryAt=row.get("next_retry_at"),
            sentAt=row.get("sent_at"),
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _now(self) -> datetime:
        return datetime.now(UTC)
