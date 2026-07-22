from __future__ import annotations

import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.schemas.mail_messenger import MailRecipientView
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, rows: list[dict], *, fetchone: list[dict | None] | None = None):
        self.rows = rows
        self.fetchone_results = list(fetchone or [])
        self.executions: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params=()):
        self.executions.append((" ".join(str(sql).split()), tuple(params)))

    def fetchone(self):
        return self.fetchone_results.pop(0) if self.fetchone_results else None

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self.cursor_instance = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1


class FakeDb:
    def __init__(self, cursor: FakeCursor):
        self.connection = FakeConnection(cursor)
        self.ensure_count = 0

    def ensure_migrations_applied(self):
        self.ensure_count += 1

    def connect(self):
        return self.connection


class MailReadReceiptTest(unittest.TestCase):
    @staticmethod
    def actor(user_id="recipient-self", email="self@example.test"):
        return SimpleNamespace(companyId="company-a", userId=user_id, userEmail=email)

    @staticmethod
    def recipient(
        email: str,
        kind: str,
        user_id: str | None,
        *,
        is_read: bool,
        is_starred: bool,
        read_at: datetime | None,
    ) -> dict:
        return {
            "recipient_email": email,
            "recipient_user_id": user_id,
            "recipient_kind": kind,
            "is_read": is_read,
            "is_starred": is_starred,
            "received_at": None,
            "read_at": read_at,
        }

    @staticmethod
    def message(*, sender_view: bool) -> dict:
        now = datetime.now(UTC)
        return {
            "mail_id": "mail-1",
            "company_id": "company-a",
            "sender_user_id": "sender-a",
            "account_id": "account-a",
            "sender_email": "sender@example.test",
            "subject": "수신 확인",
            "body_text": "본문",
            "body_html": None,
            "status": "sent",
            "sent_at": now,
            "scheduled_at": None,
            "created_at": now,
            "updated_at": now,
            "retention_expires_at": None,
            "attachment_count": 0,
            "is_sender_view": sender_view,
        }

    def test_sender_receives_actual_internal_and_external_receipt_state(self):
        now = datetime.now(UTC)
        rows = [
            self.recipient("read@example.test", "to", "read-user", is_read=True, is_starred=True, read_at=now),
            self.recipient("external@outside.test", "cc", None, is_read=False, is_starred=False, read_at=None),
            self.recipient("hidden@example.test", "bcc", "hidden-user", is_read=False, is_starred=False, read_at=None),
        ]
        recipients = MailMessengerService()._fetch_mail_recipients(
            FakeCursor(rows), self.actor("sender-a", "sender@example.test"), "mail-1", is_sender_view=True
        )
        self.assertEqual([item.isRead for item in recipients], [True, False, False])
        self.assertEqual(recipients[0].readAt, now)
        self.assertIsNone(recipients[1].recipientUserId)

    def test_recipient_view_masks_every_visible_recipient_status(self):
        now = datetime.now(UTC)
        rows = [
            self.recipient("other@example.test", "to", "other-user", is_read=True, is_starred=True, read_at=now),
            self.recipient("self@example.test", "bcc", "recipient-self", is_read=True, is_starred=True, read_at=now),
        ]
        recipients = MailMessengerService()._fetch_mail_recipients(
            FakeCursor(rows), self.actor(), "mail-1", is_sender_view=False
        )
        for recipient in recipients:
            self.assertIsNone(recipient.isRead)
            self.assertIsNone(recipient.isStarred)
            self.assertIsNone(recipient.readAt)

    def test_detail_explicitly_allows_receipts_only_for_sender_view(self):
        service = MailMessengerService()
        recipient = MailRecipientView(
            recipientEmail="to@example.test",
            recipientUserId="to-user",
            recipientKind="to",
            isRead=False,
            isStarred=False,
        )
        sender_detail = service._to_mail_detail(self.message(sender_view=True), [recipient], [])
        recipient_detail = service._to_mail_detail(self.message(sender_view=False), [recipient], [])
        self.assertTrue(sender_detail.canViewReadReceipts)
        self.assertFalse(recipient_detail.canViewReadReceipts)

    def test_messenger_room_read_contract_remains_unchanged(self):
        now = datetime.now(UTC)
        cursor = FakeCursor([], fetchone=[{"id": "message-last"}])
        db = FakeDb(cursor)
        service = MailMessengerService()
        service.db = db
        service._fetch_accessible_room = Mock(return_value={"room_id": "room-1"})
        with patch.object(service, "_now", return_value=now), patch.object(service, "_new_id", return_value="read-id"):
            response = service.mark_room_read(self.actor(), "room-1")

        statements = "\n".join(sql for sql, _ in cursor.executions).upper()
        self.assertIn("INSERT INTO MESSENGER_MESSAGE_READS", statements)
        self.assertIn("UPDATE MESSENGER_ROOM_MEMBERS", statements)
        self.assertEqual(response.lastReadMessageId, "message-last")
        self.assertEqual(response.readAt, now)
        self.assertEqual(db.connection.commit_count, 1)


if __name__ == "__main__":
    unittest.main()
