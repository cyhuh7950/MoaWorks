from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import re


_QUEUE_RECIPIENT = re.compile(r"^bounce\+([a-zA-Z0-9_-]+)@", re.IGNORECASE)
_EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class DeliveryFeedback:
    queue_id: str
    action: str
    status_code: str
    diagnostic: str
    content_sha256: str


def parse_delivery_feedback(*, envelope_recipient: str, raw_message: bytes) -> DeliveryFeedback:
    matched = _QUEUE_RECIPIENT.match(envelope_recipient.strip())
    if matched is None:
        raise ValueError("VERP 반송 주소에서 발송 큐를 확인할 수 없습니다.")
    text = raw_message.decode("utf-8", errors="replace")
    action = _field(text, "Action") or "unknown"
    status_code = _field(text, "Status") or "unknown"
    diagnostic = _field(text, "Diagnostic-Code") or "delivery status notification"
    diagnostic = _EMAIL.sub("[EMAIL]", diagnostic)[:500]
    return DeliveryFeedback(
        queue_id=matched.group(1),
        action=action.lower(),
        status_code=status_code,
        diagnostic=diagnostic,
        content_sha256=sha256(raw_message).hexdigest(),
    )


def _field(text: str, name: str) -> str | None:
    matched = re.search(rf"(?im)^{re.escape(name)}:\s*(.+?)\s*$", text)
    return matched.group(1).strip() if matched else None


class MailDeliveryFeedbackOperations:
    @staticmethod
    def record(cursor, feedback: DeliveryFeedback, raw_storage_key: str, now) -> bool:
        cursor.execute(
            """INSERT INTO mail_delivery_feedback (
                id,queue_id,content_sha256,action,status_code,diagnostic,raw_storage_key,received_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (queue_id, content_sha256) DO NOTHING RETURNING id""",
            (
                f"feedback_{feedback.content_sha256[:24]}", feedback.queue_id, feedback.content_sha256,
                feedback.action, feedback.status_code, feedback.diagnostic, raw_storage_key, now,
            ),
        )
        if cursor.fetchone() is None:
            return False
        terminal_status = {
            "failed": "failed",
            "expired": "failed",
            "delayed": "retry_pending",
            "delivered": "sent",
            "relayed": "sent",
        }.get(feedback.action, "failed")
        cursor.execute(
            """UPDATE mail_delivery_queue SET status=%s,dsn_action=%s,dsn_status_code=%s,
            last_error=%s,updated_at=%s WHERE id=%s RETURNING company_id""",
            (terminal_status, feedback.action, feedback.status_code, feedback.diagnostic, now, feedback.queue_id),
        )
        queue = cursor.fetchone()
        if queue is None:
            raise ValueError("DSN과 연결된 발송 큐를 찾을 수 없습니다.")
        cursor.execute(
            """INSERT INTO audit_logs (
                id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at
            ) VALUES (%s,%s,NULL,'mail-gateway','mail_delivery_queue',%s,'mail.delivery.feedback',NULL,%s,%s,%s)""",
            (
                f"audit_{feedback.content_sha256[:24]}", queue["company_id"], feedback.queue_id,
                terminal_status, feedback.diagnostic, now,
            ),
        )
        return True
