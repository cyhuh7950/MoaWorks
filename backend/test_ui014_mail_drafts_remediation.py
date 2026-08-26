from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.api.routes.mail import router
from app.schemas import mail_messenger
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self) -> None:
        self.sql = ""
        self.params = ()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params) -> None:
        self.sql = " ".join(sql.split())
        self.params = params

    def fetchall(self):
        return []


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self) -> FakeCursor:
        return self._cursor


class FakeDb:
    def __init__(self) -> None:
        self.cursor_instance = FakeCursor()

    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> FakeConnection:
        return FakeConnection(self.cursor_instance)


class MailDraftsRemediationTest(unittest.TestCase):
    def actor(self):
        return SimpleNamespace(
            companyId="company-a",
            userId="user-a",
            userEmail="user@a.test",
        )

    def test_static_drafts_route_precedes_dynamic_mail_detail_route(self):
        route_paths = [route.path for route in router.routes]

        self.assertIn("/drafts", route_paths)
        self.assertLess(route_paths.index("/drafts"), route_paths.index("/{mail_id}"))

    def test_list_drafts_is_scoped_to_company_user_and_draft_status(self):
        service = MailMessengerService()
        service.db = FakeDb()

        response = service.list_drafts(self.actor())

        self.assertEqual(response.mails, [])
        sql = service.db.cursor_instance.sql.upper()
        self.assertIn("M.COMPANY_ID = %S", sql)
        self.assertIn("M.SENDER_USER_ID = %S", sql)
        self.assertIn("M.STATUS = 'DRAFT'", sql)
        self.assertEqual(
            service.db.cursor_instance.params,
            ("company-a", "user-a"),
        )

    def test_draft_update_route_and_contract_keep_persisted_attachment_ids_separate_from_staged_upload_ids(self):
        route_paths = [route.path for route in router.routes]
        request_type = getattr(mail_messenger, "MailDraftUpdateRequest", None)

        self.assertIn("/{mail_id}/draft", route_paths)
        self.assertIsNotNone(request_type)
        request = request_type(
            subject="updated",
            bodyText="rich body",
            bodyHtml='<p>rich body</p>',
            attachments=[{
                "uploadId": "a" * 32,
                "fileName": "new.txt",
                "contentType": "text/plain",
                "sizeBytes": 1,
            }],
            retainedAttachmentIds=["attachment-persisted"],
        )

        self.assertEqual(request.retainedAttachmentIds, ["attachment-persisted"])
        self.assertEqual(request.attachments[0].uploadId, "a" * 32)


if __name__ == "__main__":
    unittest.main()
