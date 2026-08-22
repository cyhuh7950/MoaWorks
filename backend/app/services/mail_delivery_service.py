from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb

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

        try:
            response_detail = self._send_via_provider(sending_row)
        except Exception as exc:
            max_retry_count = int(row["max_retry_count"] or 0)
            retry_interval_sec = int(row["retry_interval_sec"] or 0)
            should_retry = attempt_count < max_retry_count
            status = "retry_pending" if should_retry else "failed"
            next_retry_at = now + timedelta(seconds=retry_interval_sec) if should_retry else None
            updated = self._mark_queue_result(
                cursor,
                sending_row,
                status=status,
                last_error=str(exc),
                next_retry_at=next_retry_at,
                sent_at=None,
                response_detail=str(exc),
            )
            event_type = "mail.delivery.retry_pending" if should_retry else "mail.delivery.failed"
            message = "외부 SMTP 발송 실패로 재시도가 예약되었습니다." if should_retry else "외부 SMTP 발송이 실패했습니다."
            self._insert_event(cursor, queue_id=row["id"], event_type=event_type, message=message, payload={"error": str(exc), "attemptCount": attempt_count})
            return updated

        updated = self._mark_queue_result(
            cursor,
            sending_row,
            status="sent",
            last_error=None,
            next_retry_at=None,
            sent_at=now,
            response_detail=response_detail,
        )
        self._insert_event(cursor, queue_id=row["id"], event_type="mail.delivery.sent", message="외부 SMTP 발송이 완료되었습니다.", payload={"attemptCount": attempt_count})
        return updated

    def _mark_queue_result(
        self,
        cursor,
        row: dict[str, Any],
        *,
        status: str,
        last_error: str | None,
        next_retry_at: datetime | None,
        sent_at: datetime | None,
        response_detail: str | None,
    ) -> dict[str, Any]:
        now = self._now()
        cursor.execute(
            """
            UPDATE mail_delivery_queue
            SET status = %s,
                last_error = %s,
                next_retry_at = %s,
                sent_at = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (status, last_error, next_retry_at, sent_at, now, row["id"]),
        )
        updated = cursor.fetchone()
        if updated is None:
            raise ValueError("외부 발송 큐 상태 저장에 실패했습니다.")
        cursor.execute(
            """
            INSERT INTO mail_delivery_attempts (
                id, queue_id, status, error_message, response_detail, attempted_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (self._new_id("mailattempt"), row["id"], status, last_error, response_detail, now),
        )
        return updated

    def _send_via_provider(self, row: dict[str, Any]) -> str:
        raw_provider_key = str(row.get("provider_key") or "").strip().lower()
        provider_key = _PROVIDER_KEY if raw_provider_key == _LEGACY_PROVIDER_KEY else raw_provider_key
        sender_domain = str(row["sender_domain"]).strip().lower()
        requested_sender = str(row["sender_email"]).strip().lower()
        sender_email = (
            requested_sender
            if requested_sender.endswith(f"@{sender_domain}")
            else str(row["sender_address"]).strip().lower()
        )
        message = OutboundMessage(
            sender_email=sender_email,
            recipient_email=str(row["recipient_email"]).strip().lower(),
            subject=str(row["subject"]),
            body_text=str(row.get("body_text") or ""),
            body_html=row.get("body_html"),
            message_id=f"<{row['mail_id']}.{row['id']}@{sender_domain}>",
        )

        if provider_key == _PROVIDER_KEY:
            receipt = self.self_hosted_transport.send(
                message,
                helo_name=str(row["helo_name"]),
                timeout_sec=int(row.get("timeout_sec") or 15),
            )
        elif provider_key == "oci_email_delivery":
            encrypted_password = str(row.get("encrypted_password") or "")
            if not encrypted_password:
                raise ValueError("OCI SMTP 자격증명이 설정되지 않았습니다.")
            config = RelaySmtpConfig(
                host=str(row.get("smtp_host") or ""),
                port=int(row.get("smtp_port") or 587),
                username=str(row.get("smtp_username") or ""),
                password=self.security.decrypt_secret(encrypted_password),
                timeout_sec=int(row.get("timeout_sec") or 20),
            )
            receipt = self.oci_transport.send(message, config=config)
        else:
            raise ValueError(f"지원하지 않는 발신 Provider입니다: {raw_provider_key}")

        return (
            f"provider={receipt.provider_key};endpoint={receipt.endpoint};"
            f"remote_smtp_accepted={str(receipt.remote_smtp_accepted).lower()}"
        )

    def _resolve_smtp_hosts(self, domain: str) -> list[str]:
        normalized = domain.strip().lower()
        hosts: list[str] = []
        if dns is not None:
            try:
                answers = dns.resolver.resolve(normalized, "MX")
                ordered = sorted(answers, key=lambda item: int(item.preference))
                for answer in ordered:
                    candidate = str(answer.exchange).rstrip(".").lower()
                    if candidate and candidate not in hosts:
                        hosts.append(candidate)
            except Exception:
                pass
        if normalized not in hosts:
            hosts.append(normalized)
        return hosts

    def _fetch_provider(self, cursor, company_id: str) -> dict[str, Any]:
        cursor.execute(
            "SELECT domain FROM companies WHERE id = %s",
            (company_id,),
        )
        company = cursor.fetchone()
        if company is None:
            raise ValueError("회사를 찾을 수 없습니다.")
        return self.ensure_provider(cursor, company_id, company["domain"])

    def _fetch_summary(self, cursor, company_id: str) -> MailDeliveryQueueSummary:
        cursor.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
                COUNT(*) FILTER (WHERE status = 'sending') AS sending_count,
                COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
                COUNT(*) FILTER (WHERE status = 'retry_pending') AS retry_pending_count,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count
            FROM mail_delivery_queue
            WHERE company_id = %s
            """,
            (company_id,),
        )
        row = cursor.fetchone() or {}
        return MailDeliveryQueueSummary(
            queuedCount=int(row.get("queued_count") or 0),
            sendingCount=int(row.get("sending_count") or 0),
            sentCount=int(row.get("sent_count") or 0),
            failedCount=int(row.get("failed_count") or 0),
            retryPendingCount=int(row.get("retry_pending_count") or 0),
            cancelledCount=int(row.get("cancelled_count") or 0),
        )

    def _fetch_attempts(self, cursor, queue_ids: list[str]) -> list[MailDeliveryAttemptItem]:
        if not queue_ids:
            return []
        cursor.execute(
            """
            SELECT id, queue_id, status, error_message, response_detail, attempted_at
            FROM mail_delivery_attempts
            WHERE queue_id = ANY(%s)
            ORDER BY attempted_at DESC
            LIMIT 100
            """,
            (queue_ids,),
        )
        return [
            MailDeliveryAttemptItem(
                attemptId=row["id"],
                queueId=row["queue_id"],
                status=row["status"],
                errorMessage=row["error_message"],
                responseDetail=row["response_detail"],
                attemptedAt=row["attempted_at"],
            )
            for row in cursor.fetchall()
        ]

    def _fetch_events(self, cursor, queue_ids: list[str]) -> list[MailDeliveryEventItem]:
        if not queue_ids:
            return []
        cursor.execute(
            """
            SELECT id, queue_id, event_type, message, payload, created_at
            FROM mail_delivery_events
            WHERE queue_id = ANY(%s)
            ORDER BY created_at DESC
            LIMIT 100
            """,
            (queue_ids,),
        )
        return [
            MailDeliveryEventItem(
                eventId=row["id"],
                queueId=row["queue_id"],
                eventType=row["event_type"],
                message=row["message"],
                payload=row.get("payload") or {},
                createdAt=row["created_at"],
            )
            for row in cursor.fetchall()
        ]

    def _insert_event(self, cursor, *, queue_id: str, event_type: str, message: str, payload: dict[str, Any]) -> None:
        cursor.execute(
            """
            INSERT INTO mail_delivery_events (id, queue_id, event_type, message, payload, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (self._new_id("mailevent"), queue_id, event_type, message, Jsonb(payload), self._now()),
        )

    def _emit_observability(self, row: dict[str, Any]) -> None:
        severity = SeverityLevel.INFO
        event_type = "mail.delivery.sent"
        if row["status"] == "retry_pending":
            severity = SeverityLevel.WARN
            event_type = "mail.delivery.retry_pending"
        elif row["status"] == "failed":
            severity = SeverityLevel.ERROR
            event_type = "mail.delivery.failed"
        elif row["status"] == "queued":
            event_type = "mail.delivery.queue.created"

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
