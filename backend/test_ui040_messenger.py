from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui040MessengerTests(unittest.TestCase):
    @staticmethod
    def actor(user_id: str = "user-a", company_id: str = "company-a"):
        return SimpleNamespace(userId=user_id, companyId=company_id, userName="테스트", userEmail=f"{user_id}@example.test")

    def test_migration_042_is_additive_and_preserves_existing_messages(self) -> None:
        sql = (ROOT / "migrations" / "042_messenger_workspace.sql").read_text(encoding="utf-8")
        for token in (
            "ADD COLUMN IF NOT EXISTS is_favorite",
            "CREATE INDEX IF NOT EXISTS idx_messenger_room_members_favorite",
            "CREATE TABLE IF NOT EXISTS messenger_attachments",
            "upload_id TEXT NOT NULL UNIQUE",
            "message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE",
            "CREATE INDEX IF NOT EXISTS idx_messenger_attachments_message_created",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("DELETE FROM MESSENGER_MESSAGES", upper)

    def test_payloads_enforce_typed_attachment_and_participant_contracts(self) -> None:
        from app.schemas.mail_messenger import (
            MessengerAttachmentMeta,
            MessengerMessageSendRequest,
            MessengerRoomFavoriteRequest,
            MessengerRoomParticipantsRequest,
        )

        attachment = MessengerAttachmentMeta(uploadId="a" * 32, fileName="a.txt", contentType="text/plain", sizeBytes=3)
        message = MessengerMessageSendRequest(body="", messageType="file", attachments=[attachment])
        self.assertEqual(message.attachments[0].uploadId, "a" * 32)
        self.assertTrue(MessengerRoomFavoriteRequest(isFavorite=True).isFavorite)
        with self.assertRaises(ValidationError):
            MessengerMessageSendRequest(body="   ", attachments=[])
        with self.assertRaises(ValidationError):
            MessengerMessageSendRequest(body="x", messageType="html")
        with self.assertRaises(ValidationError):
            MessengerRoomParticipantsRequest(participantUserIds=["user-a"], expectedUpdatedAt="not-a-date")

    def test_attachment_storage_enforces_owner_integrity_reuse_and_size(self) -> None:
        from app.schemas.mail_messenger import MessengerAttachmentMeta
        from app.services.messenger_attachment_storage import MessengerAttachmentStorage

        with TemporaryDirectory() as directory:
            storage = MessengerAttachmentStorage(root=Path(directory), max_file_bytes=4)
            uploaded = storage.stage(self.actor(), "../safe.txt", "text/plain", b"data")
            self.assertEqual(uploaded.fileName, "safe.txt")
            meta = MessengerAttachmentMeta(
                uploadId=uploaded.uploadId,
                fileName=uploaded.fileName,
                contentType=uploaded.contentType,
                sizeBytes=uploaded.sizeBytes,
            )
            resolved = storage.resolve(self.actor(), meta)
            self.assertNotIn("storageKey", uploaded.model_dump())
            self.assertTrue(str(resolved["storage_key"]).startswith("messenger/uploads/"))
            storage.mark_attached(uploaded.uploadId)
            with self.assertRaisesRegex(ValueError, "이미 사용"):
                storage.resolve(self.actor(), meta)
            with self.assertRaises(PermissionError):
                other = storage.stage(self.actor("user-b"), "b.txt", "text/plain", b"b")
                storage.resolve(self.actor(), MessengerAttachmentMeta(uploadId=other.uploadId, fileName=other.fileName, contentType=other.contentType, sizeBytes=other.sizeBytes))
            with self.assertRaisesRegex(ValueError, "최대 크기"):
                storage.stage(self.actor(), "large.bin", "application/octet-stream", b"12345")

    def test_routes_expose_favorite_participants_pagination_and_real_attachments(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "messenger.py").read_text(encoding="utf-8")
        for token in (
            '@router.patch("/rooms/{room_id}/favorite"',
            '@router.patch("/rooms/{room_id}/participants"',
            '@router.post("/attachments"',
            '@router.get("/rooms/{room_id}/messages/{message_id}/attachments/{attachment_id}"',
            "UploadFile", "FileResponse", "limit: int", "before: datetime | None",
        ):
            self.assertIn(token, source)

    def test_service_fixes_authorization_transaction_read_counts_and_audit(self) -> None:
        source = (ROOT / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        for token in (
            "def update_room_favorite", "def update_room_participants", "FOR UPDATE",
            "created_by_user_id", "expectedUpdatedAt", "is_favorite",
            "def stage_messenger_attachment", "def download_messenger_attachment",
            "self.messenger_attachment_storage.resolve", "messenger_attachments",
            "recipient_count", "read_count", "unread_count", "ON CONFLICT (message_id, user_id) DO NOTHING",
            '"messenger.room.created"', '"messenger.room.favorite_changed"',
            '"messenger.room.participants_changed"', '"messenger.message.sent"', '"messenger.room.read"',
        ):
            self.assertIn(token, source)
        audit_section = source[source.index("def _write_messenger_audit"):source.index("def _save_mail")]
        self.assertNotIn("payload.body", audit_section)
        self.assertNotIn("file_name", audit_section)
        self.assertNotIn("user_email", audit_section)

    def test_message_schema_preserves_legacy_fields_and_adds_safe_counts(self) -> None:
        source = (ROOT / "app" / "schemas" / "mail_messenger.py").read_text(encoding="utf-8")
        section = source[source.index("class MessengerMessageView"):source.index("class ExternalDeliveryView")]
        for token in ("attachmentMeta", "attachments", "readBy", "recipientCount", "readCount", "unreadCount", "nextCursor"):
            self.assertIn(token, section)
        self.assertNotIn("storageKey", section)


if __name__ == "__main__":
    unittest.main()
