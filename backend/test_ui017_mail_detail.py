from __future__ import annotations

import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.api.routes import mail as mail_routes
from app.schemas import mail_messenger as mail_schemas
from app.schemas.mail_messenger import MailAttachmentMeta, MailRecipientView
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, *, fetchone=None, fetchall=None):
        self.fetchone_results = list(fetchone or [])
        self.fetchall_results = list(fetchall or [])
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
        return self.fetchall_results.pop(0) if self.fetchall_results else []


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self.cursor_instance = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance


class FakeDb:
    def __init__(self, *, fetchone=None, fetchall=None):
        self.cursor_instance = FakeCursor(fetchone=fetchone, fetchall=fetchall)
        self.connection = FakeConnection(self.cursor_instance)
        self.ensure_count = 0

    def ensure_migrations_applied(self):
        self.ensure_count += 1

    def connect(self):
        return self.connection


class MailDetailTest(unittest.TestCase):
    @staticmethod
    def actor(user_id="user-a", email="user-a@example.test"):
        return SimpleNamespace(companyId="company-a", userId=user_id, userEmail=email, userName="사용자")

    @staticmethod
    def message(*, sender_view: bool) -> dict:
        now = datetime.now(UTC)
        return {
            "mail_id": "mail-1", "company_id": "company-a", "sender_user_id": "sender-a",
            "account_id": "account-a", "sender_email": "sender@example.test", "subject": "상세 검증",
            "body_text": "plain body", "body_html": "<b>not rendered</b>", "status": "sent",
            "sent_at": now, "created_at": now, "updated_at": now, "retention_expires_at": None,
            "attachment_count": 1, "is_sender_view": sender_view,
        }

    @staticmethod
    def recipient(email: str, kind: str, user_id: str | None = None) -> dict:
        return {
            "recipient_email": email, "recipient_user_id": user_id, "recipient_kind": kind,
            "is_read": False, "is_starred": False, "received_at": None, "read_at": None,
        }

    def test_access_query_scopes_sender_and_recipient_soft_delete_views(self):
        service = MailMessengerService()
        cursor = FakeCursor(fetchone=[self.message(sender_view=False)])
        service._fetch_accessible_mail(cursor, self.actor(), "mail-1")
        sql, params = cursor.executions[0]
        normalized = sql.upper()
        self.assertIn("M.SENDER_DELETED_AT IS NULL", normalized)
        self.assertIn("R.DELETED_AT IS NULL", normalized)
        self.assertNotIn("mail-1", sql)
        self.assertIn("mail-1", params)

    def test_recipient_visibility_keeps_to_cc_and_only_actor_bcc(self):
        service = MailMessengerService()
        actor = self.actor("bcc-self", "self@example.test")
        rows = [self.recipient("to@example.test", "to", "to-user"),
                self.recipient("cc@example.test", "cc", "cc-user"),
                self.recipient("self@example.test", "bcc", "bcc-self")]
        cursor = FakeCursor(fetchall=[rows])
        recipients = service._fetch_mail_recipients(cursor, actor, "mail-1", is_sender_view=False)
        self.assertEqual([item.recipientEmail for item in recipients],
                         ["to@example.test", "cc@example.test", "self@example.test"])
        sql, params = cursor.executions[0]
        self.assertIn("RECIPIENT_KIND <> 'BCC'", sql.upper())
        self.assertEqual(params, ("mail-1", False, "bcc-self", "self@example.test"))

    def test_sender_visibility_keeps_all_bcc(self):
        service = MailMessengerService()
        rows = [self.recipient("to@example.test", "to", "to-user"),
                self.recipient("hidden-a@example.test", "bcc", "bcc-a"),
                self.recipient("hidden-b@example.test", "bcc", "bcc-b")]
        cursor = FakeCursor(fetchall=[rows])
        recipients = service._fetch_mail_recipients(cursor, self.actor(), "mail-1", is_sender_view=True)
        self.assertEqual(len(recipients), 3)

    def test_attachment_response_view_never_serializes_storage_key(self):
        self.assertTrue(hasattr(mail_schemas, "MailAttachmentView"), "상세 응답 전용 첨부 view가 필요합니다.")
        view = mail_schemas.MailAttachmentView(fileName="report.pdf", contentType="application/pdf", sizeBytes=1234)
        self.assertEqual(view.model_dump(mode="json"), {
            "fileName": "report.pdf", "contentType": "application/pdf", "sizeBytes": 1234,
        })

    def test_attachment_query_does_not_select_or_return_storage_key(self):
        service = MailMessengerService()
        cursor = FakeCursor(fetchall=[[{
            "file_name": "report.pdf", "content_type": "application/pdf", "size_bytes": 1234,
        }]])
        attachments = service._fetch_mail_attachments(cursor, "mail-1")
        sql, _ = cursor.executions[0]
        self.assertNotIn("STORAGE_KEY", sql.upper())
        self.assertNotIn("storageKey", attachments[0].model_dump())

    def test_recipient_detail_hides_external_delivery_information(self):
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[self.message(sender_view=False)], fetchall=[
            [self.recipient("user-a@example.test", "to", "user-a")], [],
        ])
        delivery_service = Mock()
        delivery_service.list_mail_external_deliveries.return_value = [{
            "id": "queue-secret", "recipient_email": "outside@example.net",
            "provider_key": "private-provider", "status": "failed", "attempt_count": 2,
            "last_error": "private failure", "next_retry_at": None, "sent_at": None,
        }]
        with patch("app.services.mail_messenger_service.MailDeliveryService", return_value=delivery_service):
            detail = service.get_mail(self.actor(), "mail-1")
        self.assertEqual(detail.externalDeliveries, [])
        delivery_service.list_mail_external_deliveries.assert_not_called()

    def test_detail_serialization_drops_attachment_storage_key(self):
        service = MailMessengerService()
        detail = service._to_mail_detail(
            self.message(sender_view=True),
            [MailRecipientView(recipientEmail="to@example.test", recipientUserId="to-user",
                               recipientKind="to", isRead=False, isStarred=False)],
            [MailAttachmentMeta(fileName="report.pdf", contentType="application/pdf",
                                sizeBytes=1234, storageKey="private/object/key")],
            [],
        )
        self.assertNotIn("storageKey", detail.model_dump(mode="json")["attachments"][0])

    def test_external_smtp_detail_allows_missing_internal_sender_identity(self):
        service = MailMessengerService()
        message = self.message(sender_view=False)
        message["account_id"] = None
        message["sender_user_id"] = None

        detail = service._to_mail_detail(message, [], [])

        self.assertIsNone(detail.accountId)
        self.assertIsNone(detail.senderUserId)

    def test_route_keeps_mail_forbidden_403_contract(self):
        service = Mock()
        service.get_mail.side_effect = PermissionError("메일을 조회할 권한이 없습니다.")
        with patch.object(mail_routes, "_service", return_value=service):
            with self.assertRaises(HTTPException) as captured:
                mail_routes.get_mail("mail-deleted", self.actor())
        self.assertEqual(captured.exception.status_code, 403)
        self.assertEqual(captured.exception.detail["code"], "MAIL_FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
