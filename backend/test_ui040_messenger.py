from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui040MessengerTests(unittest.TestCase):
    @staticmethod
    def actor(user_id: str = "user-a", company_id: str = "company-a"):
        return SimpleNamespace(userId=user_id, companyId=company_id, userName="테스트", userEmail=f"{user_id}@example.test")

    @staticmethod
    def attachment(upload_id: str):
        from app.schemas.mail_messenger import MessengerAttachmentMeta

        return MessengerAttachmentMeta(
            uploadId=upload_id,
            fileName=f"{upload_id[:4]}.txt",
            contentType="text/plain",
            sizeBytes=4,
        )

    @staticmethod
    def message_service(*, fail_mark: str | None = None, fail_commit: bool = False):
        from app.services.mail_messenger_service import MailMessengerService

        events: list[str] = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                events.append("cursor.exit")
                return False

            def execute(self, sql, params=()):
                events.append("sql")

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                events.append("connection.exit")
                return False

            def cursor(self):
                return Cursor()

            def commit(self):
                events.append("commit")
                if fail_commit:
                    raise RuntimeError("commit status unknown")

            def rollback(self):
                events.append("rollback")

        class Db:
            def ensure_migrations_applied(self):
                return None

            def connect(self):
                return Connection()

        class Storage:
            def resolve(self, actor, attachment):
                return {
                    "upload_id": attachment.uploadId,
                    "file_name": attachment.fileName,
                    "content_type": attachment.contentType,
                    "size_bytes": attachment.sizeBytes,
                    "storage_key": f"messenger/uploads/{attachment.uploadId}.bin",
                }

            def mark_attached(self, upload_id, message_id=None):
                events.append(f"mark:{upload_id}")
                if upload_id == fail_mark:
                    raise RuntimeError("metadata mark failed")

            def restore_unattached(self, upload_id, message_id):
                events.append(f"restore:{upload_id}")

        service = MailMessengerService()
        service.db = Db()
        service.messenger_attachment_storage = Storage()
        service._fetch_accessible_room = lambda cursor, actor, room_id: {"id": room_id}
        service._write_messenger_audit = lambda *args, **kwargs: events.append("audit")
        return service, events

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
        with self.assertRaises(ValidationError):
            MessengerRoomParticipantsRequest(
                participantUserIds=[f"user-{index}" for index in range(101)],
                expectedUpdatedAt=datetime.now(UTC),
            )

    def test_mark_failure_rolls_back_before_commit_and_restores_prior_metadata(self) -> None:
        from app.schemas.mail_messenger import MessengerMessageSendRequest

        first = "a" * 32
        second = "b" * 32
        service, events = self.message_service(fail_mark=second)
        payload = MessengerMessageSendRequest(
            body="",
            messageType="file",
            attachments=[self.attachment(first), self.attachment(second)],
        )

        with self.assertRaisesRegex(RuntimeError, "metadata mark failed"):
            service.send_message(self.actor(), "room-a", payload)

        self.assertNotIn("commit", events)
        self.assertLess(events.index(f"mark:{first}"), events.index(f"mark:{second}"))
        self.assertLess(events.index("rollback"), events.index(f"restore:{first}"))
        self.assertNotIn(f"restore:{second}", events)

    def test_commit_failure_keeps_metadata_attached_for_safe_recovery(self) -> None:
        from app.schemas.mail_messenger import MessengerMessageSendRequest

        upload_id = "c" * 32
        service, events = self.message_service(fail_commit=True)
        payload = MessengerMessageSendRequest(body="", messageType="file", attachments=[self.attachment(upload_id)])

        with self.assertRaisesRegex(RuntimeError, "commit status unknown"):
            service.send_message(self.actor(), "room-a", payload)

        self.assertLess(events.index(f"mark:{upload_id}"), events.index("commit"))
        self.assertNotIn(f"restore:{upload_id}", events)

    def test_commit_failure_metadata_survives_expired_cleanup(self) -> None:
        from app.schemas.mail_messenger import MessengerAttachmentMeta, MessengerMessageSendRequest
        from app.services.messenger_attachment_storage import MessengerAttachmentStorage

        with TemporaryDirectory() as directory:
            storage = MessengerAttachmentStorage(root=Path(directory))
            uploaded = storage.stage(self.actor(), "safe.txt", "text/plain", b"data")
            attachment = MessengerAttachmentMeta(**uploaded.model_dump())
            service, _events = self.message_service(fail_commit=True)
            service.messenger_attachment_storage = storage
            payload = MessengerMessageSendRequest(body="", messageType="file", attachments=[attachment])

            with self.assertRaisesRegex(RuntimeError, "commit status unknown"):
                service.send_message(self.actor(), "room-a", payload)

            self.assertEqual(storage.cleanup_expired(older_than=timedelta(seconds=-1)), 0)
            self.assertTrue(storage.stored_path(f"messenger/uploads/{uploaded.uploadId}.bin").is_file())

    def test_attachment_metadata_transition_is_atomic_and_reversible_before_commit(self) -> None:
        from app.schemas.mail_messenger import MessengerAttachmentMeta
        from app.services.messenger_attachment_storage import MessengerAttachmentStorage

        with TemporaryDirectory() as directory:
            storage = MessengerAttachmentStorage(root=Path(directory))
            uploaded = storage.stage(self.actor(), "safe.txt", "text/plain", b"data")
            attachment = MessengerAttachmentMeta(**uploaded.model_dump())

            storage.mark_attached(uploaded.uploadId, "message-a")
            with self.assertRaisesRegex(ValueError, "이미 사용"):
                storage.resolve(self.actor(), attachment)
            storage.restore_unattached(uploaded.uploadId, "message-a")

            self.assertEqual(storage.resolve(self.actor(), attachment)["upload_id"], uploaded.uploadId)
            self.assertEqual(list(storage.upload_root.glob("*.tmp")), [])

    def test_success_marks_all_metadata_before_commit(self) -> None:
        from app.schemas.mail_messenger import MessengerMessageSendRequest

        first = "d" * 32
        second = "e" * 32
        service, events = self.message_service()
        payload = MessengerMessageSendRequest(
            body="",
            messageType="file",
            attachments=[self.attachment(first), self.attachment(second)],
        )

        service.send_message(self.actor(), "room-a", payload)

        self.assertLess(events.index(f"mark:{first}"), events.index("commit"))
        self.assertLess(events.index(f"mark:{second}"), events.index("commit"))
        self.assertNotIn("rollback", events)

    def test_participant_noop_does_not_update_room_or_write_audit(self) -> None:
        from app.schemas.mail_messenger import MessengerRoomParticipantsRequest
        from app.services.mail_messenger_service import MailMessengerService

        updated_at = datetime.now(UTC)
        statements: list[str] = []
        audits: list[str] = []

        class Cursor:
            current_sql = ""

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, sql, params=()):
                self.current_sql = " ".join(sql.split())
                statements.append(self.current_sql)

            def fetchone(self):
                return {
                    "id": "room-a",
                    "company_id": "company-a",
                    "room_type": "group",
                    "created_by_user_id": "user-a",
                    "updated_at": updated_at,
                }

            def fetchall(self):
                return [{"user_id": "user-a"}, {"user_id": "user-b"}]

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def cursor(self):
                return Cursor()

            def commit(self):
                return None

        class Db:
            def ensure_migrations_applied(self):
                return None

            def connect(self):
                return Connection()

        service = MailMessengerService()
        service.db = Db()
        service._fetch_company_users = lambda cursor, company_id, user_ids, lock: {user_id: {} for user_id in user_ids}
        service._write_messenger_audit = lambda *args, **kwargs: audits.append("audit")
        service.get_room = lambda actor, room_id: "current-detail"
        payload = MessengerRoomParticipantsRequest(
            participantUserIds=["user-b", "user-a"],
            expectedUpdatedAt=updated_at,
        )

        result = service.update_room_participants(self.actor(), "room-a", payload)

        self.assertEqual(result, "current-detail")
        self.assertFalse(any(sql.startswith("UPDATE messenger_rooms") for sql in statements))
        self.assertEqual(audits, [])

    def test_service_enforces_participant_limit_before_and_after_deduplication(self) -> None:
        from app.schemas.mail_messenger import MessengerRoomCreateRequest, MessengerRoomParticipantsRequest
        from app.services.mail_messenger_service import MailMessengerService

        class NoConnectDb:
            def ensure_migrations_applied(self):
                return None

            def connect(self):
                raise AssertionError("participant limit must be rejected before DB access")

        service = MailMessengerService()
        service.db = NoConnectDb()
        raw_over_limit = MessengerRoomParticipantsRequest.model_construct(
            participantUserIds=["user-a", "user-b"] * 51,
            expectedUpdatedAt=datetime.now(UTC),
        )
        deduped_over_limit = MessengerRoomParticipantsRequest.model_construct(
            participantUserIds=[f"user-{index}" for index in range(101)],
            expectedUpdatedAt=datetime.now(UTC),
        )
        actor_added_over_limit = MessengerRoomCreateRequest.model_construct(
            roomName="대화방",
            roomType="group",
            participantUserIds=[f"member-{index}" for index in range(100)],
        )

        with self.assertRaisesRegex(ValueError, "최대 100명"):
            service.update_room_participants(self.actor(), "room-a", raw_over_limit)
        with self.assertRaisesRegex(ValueError, "최대 100명"):
            service.update_room_participants(self.actor(), "room-a", deduped_over_limit)
        with self.assertRaisesRegex(ValueError, "최대 100명"):
            service.create_room(self.actor(), actor_added_over_limit)

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
            storage.mark_attached(uploaded.uploadId, "message-a")
            with self.assertRaisesRegex(ValueError, "이미 사용"):
                storage.resolve(self.actor(), meta)
            with self.assertRaises(PermissionError):
                other = storage.stage(self.actor("user-b"), "b.txt", "text/plain", b"b")
                storage.resolve(self.actor(), MessengerAttachmentMeta(uploadId=other.uploadId, fileName=other.fileName, contentType=other.contentType, sizeBytes=other.sizeBytes))
            with self.assertRaisesRegex(ValueError, "최대 크기"):
                storage.stage(self.actor(), "large.bin", "application/octet-stream", b"12345")

    def test_room_translation_locale_contract_is_typed_and_additive(self) -> None:
        from app.schemas.mail_messenger import MessengerRoomCreateRequest, MessengerRoomTranslationRequest

        created = MessengerRoomCreateRequest(roomName="번역방", participantUserIds=["user-b"], translationLocale="EN")
        self.assertEqual(created.translationLocale, "en")
        updated = MessengerRoomTranslationRequest(translationLocale="ko", expectedUpdatedAt=datetime.now(UTC))
        self.assertEqual(updated.translationLocale, "ko")
        with self.assertRaises(ValidationError):
            MessengerRoomCreateRequest(roomName="번역방", participantUserIds=["user-b"], translationLocale="xx")

        sql = (ROOT / "migrations" / "060_messenger_room_translation_locale.sql").read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN IF NOT EXISTS translation_locale", sql)
        self.assertIn("DEFAULT 'ko'", sql)
        self.assertNotIn("DROP TABLE", sql.upper())
    def test_room_translation_locale_update_is_versioned_and_audited(self) -> None:
        from app.schemas.mail_messenger import MessengerRoomTranslationRequest
        from app.services.mail_messenger_service import MailMessengerService

        updated_at = datetime.now(UTC)
        statements: list[tuple[str, tuple]] = []
        audits: list[tuple] = []

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, exc_type, exc, traceback): return False
            def execute(self, sql, params=()): statements.append((" ".join(sql.split()), params))
            def fetchone(self):
                return {"id": "room-a", "created_by_user_id": "user-a", "updated_at": updated_at, "translation_locale": "ko"}

        class Connection:
            def __enter__(self): return self
            def __exit__(self, exc_type, exc, traceback): return False
            def cursor(self): return Cursor()
            def commit(self): statements.append(("COMMIT", ()))

        class Db:
            def ensure_migrations_applied(self): return None
            def connect(self): return Connection()

        service = MailMessengerService()
        service.db = Db()
        service._write_messenger_audit = lambda *args: audits.append(args)
        service.get_room = lambda actor, room_id: "updated-detail"
        payload = MessengerRoomTranslationRequest(translationLocale="en", expectedUpdatedAt=updated_at)

        self.assertEqual(service.update_room_translation(self.actor(), "room-a", payload), "updated-detail")
        self.assertTrue(any(sql.startswith("UPDATE messenger_rooms SET translation_locale") for sql, _ in statements))
        self.assertEqual(audits[0][3], "messenger.room.translation_locale_changed")
        self.assertIn(("COMMIT", ()), statements)
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

    def test_room_and_message_aggregates_only_count_active_members(self) -> None:
        source = (ROOT / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        room_list_sql = source[source.index("def list_rooms"):source.index("def create_room")]
        message_list_sql = source[source.index("def list_messages"):source.index("def stage_messenger_attachment")]
        room_detail_sql = source[
            source.index("def _room_row_to_summary_with_participants"):
            source.index("def _to_mail_summary")
        ]

        active_member_join = re.compile(
            r"JOIN\s+users\s+\w+\s+ON\s+\w+\.id\s*=\s*\w+\.user_id\s+AND\s+\w+\.status\s*=\s*'active'",
            re.IGNORECASE,
        )
        self.assertRegex(room_list_sql, active_member_join)
        self.assertRegex(room_detail_sql, active_member_join)
        self.assertGreaterEqual(len(active_member_join.findall(message_list_sql)), 2)
        self.assertRegex(
            message_list_sql,
            re.compile(r"member\.user_id\s*<>\s*msg\.sender_user_id", re.IGNORECASE),
        )
        self.assertNotIn("participant_count,1)-1", message_list_sql.replace(" ", ""))

    def test_message_schema_preserves_legacy_fields_and_adds_safe_counts(self) -> None:
        source = (ROOT / "app" / "schemas" / "mail_messenger.py").read_text(encoding="utf-8")
        section = source[source.index("class MessengerMessageView"):source.index("class ExternalDeliveryView")]
        for token in ("attachmentMeta", "attachments", "readBy", "recipientCount", "readCount", "unreadCount", "nextCursor"):
            self.assertIn(token, section)
        self.assertNotIn("storageKey", section)

    def test_message_list_exposes_sender_configured_locale(self) -> None:
        source = (ROOT / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        message_list_sql = source[source.index("def list_messages"):source.index("def stage_messenger_attachment")]
        self.assertIn("user_workspace_preferences", message_list_sql)
        self.assertIn("sender_locale", message_list_sql)
        self.assertIn("senderLocale", source[source.index("def _to_message_view"):])
        schema = (ROOT / "app" / "schemas" / "mail_messenger.py").read_text(encoding="utf-8")
        message_schema = schema[schema.index("class MessengerMessageView"):schema.index("class MessengerMessageListResponse")]
        self.assertIn("senderLocale", message_schema)


if __name__ == "__main__":
    unittest.main()
