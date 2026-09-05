from __future__ import annotations

from dataclasses import dataclass
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

from app.core.config import settings
from app.services.mail_delivery_feedback import MailDeliveryFeedbackOperations, parse_delivery_feedback
from app.services.mail_inbound_service import classify_inbound_security, parse_inbound_message
from app.services.postgres_service import PostgresService


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def verify_ingest_token(provided: str, expected: str) -> None:
    if not provided or not expected or not secrets.compare_digest(provided, expected):
        raise PermissionError("메일 수신 ingest 인증에 실패했습니다.")


@dataclass(frozen=True, slots=True)
class MailInboundIngestResult:
    inbound_id: str
    disposition: str
    duplicate: bool


class MailInboundStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.storage_path).resolve()

    def store_raw(self, content_sha256: str, content: bytes) -> str:
        return self._store(content_sha256, "raw.eml", content)

    def store_attachment(self, content_sha256: str, index: int, content: bytes) -> str:
        if index < 0:
            raise ValueError("첨부 순번이 올바르지 않습니다.")
        return self._store(content_sha256, f"attachment-{index}.bin", content)

    def _store(self, content_sha256: str, file_name: str, content: bytes) -> str:
        if not _SHA256.fullmatch(content_sha256):
            raise ValueError("수신 메일 저장 식별자가 올바르지 않습니다.")
        relative = Path("mail") / "inbound" / content_sha256[:2] / content_sha256 / file_name
        destination = (self.root / relative).resolve()
        if self.root not in destination.parents:
            raise ValueError("수신 메일 저장 경로가 올바르지 않습니다.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.read_bytes() != content:
                raise ValueError("같은 식별자의 저장 내용이 일치하지 않습니다.")
            return relative.as_posix()
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return relative.as_posix()


class MailInboundOperations:
    def __init__(self, db=None, storage=None) -> None:
        self.db = db or PostgresService()
        self.storage = storage or MailInboundStorage()

    @staticmethod
    def _id(prefix: str) -> str:
        return f"{prefix}_{uuid4().hex}"

    def ingest(self, *, envelope_from: str, recipient_email: str, raw_message: bytes,
               connection=None, submission_mail_id: str | None = None,
               recipient_kind: str = 'to', recipient_company_id: str | None = None,
               submission_queue_id: str | None = None) -> MailInboundIngestResult:
        if bool(submission_mail_id) != bool(submission_queue_id):
            raise ValueError('submission 메일과 queue source를 함께 지정해야 합니다.')
        owns_transaction = connection is None
        normalized_recipient = recipient_email.strip().lower()
        if owns_transaction and normalized_recipient.startswith("bounce+"):
            feedback = parse_delivery_feedback(
                envelope_recipient=normalized_recipient,
                raw_message=raw_message,
            )
            now = datetime.now(UTC)
            self.db.ensure_migrations_applied()
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    raw_storage_key = self.storage.store_raw(feedback.content_sha256, raw_message)
                    inserted = MailDeliveryFeedbackOperations.record(cursor, feedback, raw_storage_key, now)
                connection.commit()
            return MailInboundIngestResult(feedback.queue_id, "bounce", not inserted)
        parsed = parse_inbound_message(raw_message)
        decision = classify_inbound_security(parsed)
        recipient_email = normalized_recipient
        now = datetime.now(UTC)
        if owns_transaction:
            self.db.ensure_migrations_applied()
        with (self.db.connect() if owns_transaction else nullcontext(connection)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT u.id AS user_id,u.company_id
                    FROM users u JOIN mail_domain_settings d ON d.company_id=u.company_id
                    WHERE u.status='active' AND LOWER(u.email)=%s
                      AND LOWER(split_part(u.email,'@',2))=LOWER(d.mail_domain)
                    """ + (' AND u.company_id=%s' if recipient_company_id else '') + ' LIMIT 1',
                    (recipient_email, recipient_company_id) if recipient_company_id else (recipient_email,),
                )
                recipient = cursor.fetchone()
                if recipient is None:
                    raise ValueError("활성 수신 계정을 찾을 수 없습니다.")

                raw_storage_key = self.storage.store_raw(parsed.content_sha256, raw_message)
                inbound_id = self._id("inbound")
                conflict_clause = (
                    'ON CONFLICT (company_id, content_sha256) WHERE submission_queue_id IS NULL'
                    if submission_queue_id is None else
                    'ON CONFLICT (company_id, submission_queue_id) WHERE submission_queue_id IS NOT NULL'
                )
                cursor.execute(
                    f"""INSERT INTO mail_inbound_messages (
                        id,company_id,internet_message_id,content_sha256,raw_storage_key,envelope_from,
                        header_from,authentication_results,spam_result,virus_status,security_disposition,
                        processing_status,received_at,created_at,updated_at,submission_queue_id
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,'spooled',%s,%s,%s,%s)
                    {conflict_clause} DO UPDATE SET updated_at=EXCLUDED.updated_at
                    RETURNING id,mail_message_id,processing_status""",
                    (
                        inbound_id, recipient["company_id"], parsed.message_id, parsed.content_sha256,
                        raw_storage_key, envelope_from.strip().lower(), parsed.sender_email,
                        json.dumps(parsed.authentication_results, ensure_ascii=False), parsed.spam_result,
                        parsed.virus_status, decision.disposition, now, now, now,
                        submission_queue_id,
                    ),
                )
                inbound = cursor.fetchone()
                inbound_id = inbound["id"]
                cursor.execute(
                    """SELECT id FROM mail_inbound_recipients
                    WHERE inbound_message_id=%s AND recipient_user_id=%s""",
                    (inbound_id, recipient["user_id"]),
                )
                if cursor.fetchone() is not None:
                    if owns_transaction:
                        connection.commit()
                    return MailInboundIngestResult(inbound_id, decision.disposition, True)

                if decision.disposition == "quarantine":
                    self._insert_inbound_recipient(cursor, inbound_id, recipient, recipient_email, decision.disposition, None, now)
                    cursor.execute(
                        """UPDATE mail_inbound_messages SET processing_status='quarantined',processed_at=%s,updated_at=%s
                        WHERE id=%s""",
                        (now, now, inbound_id),
                    )
                    self._audit(cursor, recipient, inbound_id, "mail.inbound.quarantined", decision.reason, now)
                    if owns_transaction:
                        connection.commit()
                    return MailInboundIngestResult(inbound_id, decision.disposition, False)

                message_id = inbound.get("mail_message_id") or submission_mail_id
                if message_id is None:
                    message_id = self._id("mail")
                    cursor.execute(
                        """INSERT INTO mail_messages (
                            id,company_id,sender_user_id,sender_account_id,sender_email,subject,body_text,body_html,
                            status,sent_at,created_at,updated_at,retention_expires_at,attachment_count,
                            sender_display_name,reply_to_email,message_encoding,sender_copy_saved,read_receipt_requested
                        ) VALUES (%s,%s,NULL,NULL,%s,%s,%s,%s,'sent',%s,%s,%s,%s,%s,%s,NULL,'utf-8',FALSE,FALSE)""",
                        (
                            message_id, recipient["company_id"], parsed.sender_email, parsed.subject,
                            parsed.body_text, parsed.body_html, now, now, now, now + timedelta(days=30),
                            len(parsed.attachments), parsed.sender_display_name,
                        ),
                    )
                    for index, attachment in enumerate(parsed.attachments):
                        storage_key = self.storage.store_attachment(parsed.content_sha256, index, attachment.content)
                        cursor.execute(
                            """INSERT INTO mail_attachments (
                                id,message_id,file_name,content_type,size_bytes,storage_key,created_at
                            ) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                            (
                                self._id("attach"), message_id, attachment.file_name, attachment.content_type,
                                len(attachment.content), storage_key, now,
                            ),
                        )

                mail_recipient_id = self._id("rcpt")
                cursor.execute(
                    """INSERT INTO mail_recipients (
                        id,message_id,recipient_user_id,recipient_email,recipient_kind,is_read,is_starred,
                        received_at,is_spam,spam_marked_at,delivery_source
                    ) VALUES (%s,%s,%s,%s,%s,FALSE,FALSE,%s,%s,%s,%s)""",
                    (
                        mail_recipient_id, message_id, recipient["user_id"], recipient_email, recipient_kind, now,
                        decision.disposition == "spam", now if decision.disposition == "spam" else None,
                        'direct' if submission_mail_id else 'external_smtp',
                    ),
                )
                self._insert_inbound_recipient(
                    cursor, inbound_id, recipient, recipient_email, decision.disposition, mail_recipient_id, now
                )
                cursor.execute(
                    """UPDATE mail_inbound_messages SET mail_message_id=%s,processing_status='processed',
                    processed_at=%s,last_error=NULL,updated_at=%s WHERE id=%s""",
                    (message_id, now, now, inbound_id),
                )
                self._audit(cursor, recipient, inbound_id, "mail.inbound.processed", decision.reason, now)
            if owns_transaction:
                connection.commit()
        return MailInboundIngestResult(inbound_id, decision.disposition, False)

    def _insert_inbound_recipient(self, cursor, inbound_id, recipient, recipient_email, disposition, mail_recipient_id, now):
        cursor.execute(
            """INSERT INTO mail_inbound_recipients (
                id,inbound_message_id,recipient_user_id,recipient_email,disposition,mail_recipient_id,created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (self._id("inboundrcpt"), inbound_id, recipient["user_id"], recipient_email, disposition, mail_recipient_id, now),
        )

    def _audit(self, cursor, recipient, inbound_id, event, reason, now):
        cursor.execute(
            """INSERT INTO audit_logs (
                id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at
            ) VALUES (%s,%s,NULL,'mail-gateway','mail_inbound_message',%s,%s,'spooled','processed',%s,%s)""",
            (self._id("audit"), recipient["company_id"], inbound_id, event, reason, now),
        )
