from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest

from pydantic import ValidationError

from app.schemas.mail_messenger import MailAttachmentMeta, MailDraftRequest, MailSendRequest
from app.services.mail_attachment_storage import MailAttachmentStorage


class Ui018MailComposeTests(unittest.TestCase):
    @staticmethod
    def actor(user_id: str = "user-a", company_id: str = "company-a"):
        return SimpleNamespace(userId=user_id, companyId=company_id, userEmail="user-a@example.test", userName="사용자")

    def test_draft_allows_no_recipient_but_rejects_fully_empty_content(self):
        draft = MailDraftRequest(subject="초안", bodyText="", to=[], cc=[], bcc=[])
        self.assertEqual(draft.subject, "초안")
        with self.assertRaises(ValidationError):
            MailDraftRequest(subject="", bodyText="", to=[], cc=[], bcc=[], attachments=[])

    def test_send_schedule_requires_aware_future_window(self):
        now = datetime.now(UTC)
        payload = MailSendRequest(to=["to@example.test"], subject="예약", bodyText="본문", scheduledAt=now + timedelta(minutes=5))
        self.assertIsNotNone(payload.scheduledAt)
        for invalid in (now - timedelta(minutes=1), now + timedelta(days=366), datetime.now()):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                MailSendRequest(to=["to@example.test"], subject="예약", bodyText="본문", scheduledAt=invalid)

    def test_attachment_storage_sanitizes_filename_and_enforces_owner(self):
        with TemporaryDirectory() as directory:
            storage = MailAttachmentStorage(Path(directory))
            uploaded = storage.stage(self.actor(), "../../report.txt", "text/plain", b"evidence")
            self.assertEqual(uploaded.fileName, "report.txt")
            resolved = storage.resolve(self.actor(), MailAttachmentMeta(uploadId=uploaded.uploadId, fileName="report.txt", contentType="text/plain", sizeBytes=8))
            self.assertEqual(resolved["size_bytes"], 8)
            with self.assertRaises(PermissionError):
                storage.resolve(self.actor(user_id="user-b"), MailAttachmentMeta(uploadId=uploaded.uploadId, fileName="report.txt", contentType="text/plain", sizeBytes=8))
            self.assertNotIn(str(Path(directory).resolve()), uploaded.model_dump_json())

    def test_attachment_storage_rejects_empty_and_oversize(self):
        with TemporaryDirectory() as directory:
            storage = MailAttachmentStorage(Path(directory), max_file_bytes=4)
            with self.assertRaises(ValueError):
                storage.stage(self.actor(), "empty.txt", "text/plain", b"")
            with self.assertRaises(ValueError):
                storage.stage(self.actor(), "large.txt", "text/plain", b"12345")

    def test_migration_and_routes_cover_schedule_upload_download_and_recent(self):
        root = Path(__file__).parent
        migration = (root / "migrations" / "021_mail_compose.sql").read_text(encoding="utf-8").lower()
        route = (root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        service = (root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8").lower()
        main = (root / "app" / "main.py").read_text(encoding="utf-8")
        self.assertIn("scheduled_at", migration)
        self.assertIn("where status = 'scheduled'", migration)
        self.assertIn('@router.post("/attachments"', route)
        self.assertIn('@router.get("/recent-recipients"', route)
        self.assertIn('attachments/{attachment_id}', route)
        self.assertIn("for update skip locked", service)
        self.assertIn("dispatch_scheduled_mail", service)
        self.assertIn("mail_scheduler_loop", main)

    def test_request_attachment_uses_upload_id_and_hides_storage_key(self):
        attachment = MailAttachmentMeta(uploadId="a" * 32, fileName="report.txt", contentType="text/plain", sizeBytes=8)
        serialized = attachment.model_dump(mode="json")
        self.assertEqual(serialized["uploadId"], "a" * 32)
        self.assertNotIn("storageKey", serialized)


if __name__ == "__main__":
    unittest.main()
