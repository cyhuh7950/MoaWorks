from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from pydantic import ValidationError

from app.schemas.mail_messenger import MailAttachmentMeta, MailDraftRequest, MailSendRequest
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.executions: list[tuple[str, tuple]] = []

    def execute(self, query: str, params: tuple):
        self.executions.append((query, params))

    def fetchall(self):
        return self.rows


class Ui019ReplyForwardTests(unittest.TestCase):
    @staticmethod
    def actor(user_id: str = "user-a", company_id: str = "company-a"):
        return SimpleNamespace(
            userId=user_id,
            companyId=company_id,
            userEmail="user-a@example.test",
            userName="사용자",
        )

    def test_compose_action_requires_valid_source_combination(self):
        reply = MailSendRequest(
            to=["sender@example.test"],
            subject="Re: 제목",
            bodyText="본문",
            composeAction="reply",
            sourceMailId="mailmsg_source",
        )
        self.assertEqual(reply.composeAction, "reply")
        self.assertEqual(reply.sourceMailId, "mailmsg_source")

        invalid_payloads = [
            dict(composeAction="reply"),
            dict(composeAction="new", sourceMailId="mailmsg_source"),
            dict(composeAction="reply", sourceMailId="mailmsg_source", copiedAttachmentIds=["attach_a"]),
            dict(composeAction="forward", copiedAttachmentIds=["attach_a"]),
        ]
        for extra in invalid_payloads:
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                MailSendRequest(to=["to@example.test"], subject="제목", bodyText="본문", **extra)

    def test_forward_attachment_ids_are_deduplicated_and_draft_keeps_context(self):
        draft = MailDraftRequest(
            subject="Fwd: 제목",
            bodyText="원문",
            composeAction="forward",
            sourceMailId="mailmsg_source",
            copiedAttachmentIds=["attach_a", "attach_a", "attach_b"],
        )
        self.assertEqual(draft.copiedAttachmentIds, ["attach_a", "attach_b"])
        self.assertEqual(draft.sourceMailId, "mailmsg_source")

    def test_storage_clone_creates_independent_object_with_same_content(self):
        actor = self.actor()
        with TemporaryDirectory() as directory:
            storage = MailAttachmentStorage(Path(directory))
            uploaded = storage.stage(actor, "report.txt", "text/plain", b"source-bytes")
            original = storage.resolve(
                actor,
                MailAttachmentMeta(
                    uploadId=uploaded.uploadId,
                    fileName=uploaded.fileName,
                    contentType=uploaded.contentType,
                    sizeBytes=uploaded.sizeBytes,
                ),
            )
            storage.mark_attached(original["upload_id"])
            cloned = storage.clone(
                actor,
                storage_key=original["storage_key"],
                file_name=original["file_name"],
                content_type=original["content_type"],
                size_bytes=original["size_bytes"],
            )
            self.assertNotEqual(cloned["storage_key"], original["storage_key"])
            self.assertEqual(storage.stored_path(cloned["storage_key"]).read_bytes(), b"source-bytes")
            self.assertEqual(storage.stored_path(original["storage_key"]).read_bytes(), b"source-bytes")

    def test_inbound_attachment_can_be_downloaded_and_cloned_safely(self):
        actor = self.actor()
        digest = "a" * 64
        with TemporaryDirectory() as directory:
            storage = MailAttachmentStorage(Path(directory))
            inbound_path = Path(directory) / "mail" / "inbound" / "aa" / digest / "attachment-0.bin"
            inbound_path.parent.mkdir(parents=True)
            inbound_path.write_bytes(b"inbound-bytes")
            storage_key = f"mail/inbound/aa/{digest}/attachment-0.bin"

            self.assertEqual(storage.stored_path(storage_key).read_bytes(), b"inbound-bytes")
            cloned = storage.clone(
                actor,
                storage_key=storage_key,
                file_name="received.txt",
                content_type="text/plain",
                size_bytes=len(b"inbound-bytes"),
            )
            self.assertEqual(storage.stored_path(cloned["storage_key"]).read_bytes(), b"inbound-bytes")

        with TemporaryDirectory() as directory:
            storage = MailAttachmentStorage(Path(directory))
            with self.assertRaises(ValueError):
                storage.stored_path("mail/inbound/aa/" + digest + "/../raw.eml")
    def test_source_attachment_query_rejects_partial_or_foreign_selection(self):
        service = MailMessengerService.__new__(MailMessengerService)
        service._fetch_accessible_mail = lambda cursor, actor, mail_id: {"mail_id": mail_id}
        valid_rows = [
            {
                "id": "attach_a",
                "file_name": "a.txt",
                "content_type": "text/plain",
                "size_bytes": 1,
                "storage_key": "mail/uploads/" + "a" * 32 + ".bin",
            },
            {
                "id": "attach_b",
                "file_name": "b.txt",
                "content_type": "text/plain",
                "size_bytes": 1,
                "storage_key": "mail/uploads/" + "b" * 32 + ".bin",
            },
        ]
        cursor = FakeCursor(valid_rows)
        rows = service._fetch_source_attachments(
            cursor,
            self.actor(),
            "mailmsg_source",
            ["attach_a", "attach_b"],
        )
        self.assertEqual([item["id"] for item in rows], ["attach_a", "attach_b"])
        self.assertIn("message_id = %s", cursor.executions[-1][0].lower())

        with self.assertRaises(PermissionError):
            service._fetch_source_attachments(
                FakeCursor(valid_rows[:1]),
                self.actor(),
                "mailmsg_source",
                ["attach_a", "attach_b"],
            )

    def test_migration_and_service_persist_source_relation_without_storage_reuse(self):
        root = Path(__file__).parent
        migration = (root / "migrations" / "023_mail_reply_forward.sql").read_text(encoding="utf-8").lower()
        service = (root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8").lower()
        self.assertIn("source_message_id", migration)
        self.assertIn("source_action", migration)
        self.assertIn("on delete set null", migration)
        self.assertIn("copiedattachmentids", service.replace("_", ""))
        self.assertIn("attachment_storage.clone", service)


if __name__ == "__main__":
    unittest.main()

