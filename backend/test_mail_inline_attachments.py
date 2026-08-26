from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageOps, PngImagePlugin
from pydantic import ValidationError

from app.api.dependencies import get_current_user
from app.api.routes import mail as mail_routes
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailAttachmentUploadResponse,
    MailAttachmentView,
    MailDraftRequest,
    MailScheduledUpdateRequest,
    MailSendRequest,
)
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_messenger_service import MailMessengerService


INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024


def actor(*, user_id: str = "user-a", company_id: str = "company-a") -> AuthUserSummary:
    return AuthUserSummary(
        userId=user_id,
        companyId=company_id,
        userName="Inline Image User",
        userEmail=f"{user_id}@example.invalid",
        roleId="role-user",
        roleName="사용자",
        userType="user",
        status="active",
        permissions=["mail:send", "mail:read"],
    )


def image_bytes(
    image_format: str,
    *,
    size: tuple[int, int] = (3, 2),
    metadata: bool = False,
    exif_orientation: int | None = None,
) -> bytes:
    mode = "RGBA" if image_format in {"PNG", "WEBP"} else "RGB"
    image = Image.new(mode, size, (220, 30, 40, 180) if mode == "RGBA" else (220, 30, 40))
    output = BytesIO()
    save_options: dict[str, object] = {}
    if image_format == "PNG" and metadata:
        png_info = PngImagePlugin.PngInfo()
        png_info.add_text("internal-note", "must-be-removed")
        save_options["pnginfo"] = png_info
    if image_format == "JPEG" and (metadata or exif_orientation is not None):
        exif = Image.Exif()
        if exif_orientation is not None:
            exif[274] = exif_orientation
        if metadata:
            exif[315] = "must-be-removed"
        save_options["exif"] = exif
        save_options["quality"] = 100
        save_options["subsampling"] = 0
    image.save(output, format=image_format, **save_options)
    return output.getvalue()


class PreviewCursor:
    def __init__(self, row: dict | None) -> None:
        self.row = row
        self.query = ""
        self.params: tuple[object, ...] = ()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.query = " ".join(query.split())
        self.params = tuple(params)

    def fetchone(self) -> dict | None:
        return self.row


class PreviewConnection:
    def __init__(self, cursor: PreviewCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self) -> PreviewCursor:
        return self._cursor


class PreviewDatabase:
    def __init__(self, row: dict | None) -> None:
        self.cursor = PreviewCursor(row)
        self.migration_checks = 0

    def ensure_migrations_applied(self) -> None:
        self.migration_checks += 1

    def connect(self) -> PreviewConnection:
        return PreviewConnection(self.cursor)


class PersistenceCursor:
    def __init__(
        self,
        *,
        existing_attachments: list[dict] | None = None,
        scheduled_message: dict | None = None,
    ) -> None:
        self.existing_attachments = existing_attachments or []
        self.scheduled_message = scheduled_message
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.attachment_inserts: list[tuple[str, tuple[object, ...]]] = []
        self._one: dict | None = None
        self._many: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        normalized = " ".join(query.split())
        lowered = normalized.lower()
        self.statements.append((normalized, tuple(params)))
        self._one = None
        self._many = []

        if "select domain from companies" in lowered:
            self._one = {"domain": "example.test"}
        elif "select lower(email) as email" in lowered and "from users" in lowered:
            self._many = []
        elif "select * from mail_provider_configs" in lowered:
            self._one = {
                "id": "provider-1",
                "company_id": "company-a",
                "provider_type": "smtp",
                "from_email": "sender@example.test",
                "from_name": "Sender",
                "reply_to": None,
                "smtp_host": "smtp.example.test",
                "smtp_port": 587,
                "smtp_security": "starttls",
                "username": "",
                "encrypted_password": "",
                "dkim_private_key_encrypted": "",
                "dkim_selector": "",
                "rate_limit_per_minute": 60,
                "max_retry_count": 3,
                "is_default": True,
                "is_active": True,
                "delivery_enabled": True,
                "last_test_status": "success",
            }
        elif "select * from mail_messages" in lowered and "for update" in lowered:
            self._one = self.scheduled_message
        elif "from mail_attachments" in lowered and lowered.startswith("select"):
            self._many = [dict(row) for row in self.existing_attachments]
        elif lowered.startswith("insert into mail_attachments"):
            self.attachment_inserts.append((normalized, tuple(params)))
        elif lowered.startswith("update mail_messages") and "returning" in lowered:
            self._one = {
                **(self.scheduled_message or {}),
                "id": (self.scheduled_message or {}).get("id", "mail-scheduled"),
                "status": "scheduled",
            }

    def fetchone(self) -> dict | None:
        return self._one

    def fetchall(self) -> list[dict]:
        return self._many


class PersistenceConnection:
    def __init__(self, cursor: PersistenceCursor, *, fail_commit: bool = False) -> None:
        self._cursor = cursor
        self.fail_commit = fail_commit
        self.commit_count = 0
        self.rollback_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self) -> PersistenceCursor:
        return self._cursor

    def commit(self) -> None:
        self.commit_count += 1
        if self.fail_commit:
            raise RuntimeError("commit failed")

    def rollback(self) -> None:
        self.rollback_count += 1


class PersistenceDatabase:
    def __init__(
        self,
        *,
        existing_attachments: list[dict] | None = None,
        scheduled_message: dict | None = None,
        fail_commit: bool = False,
    ) -> None:
        self.cursor = PersistenceCursor(
            existing_attachments=existing_attachments,
            scheduled_message=scheduled_message,
        )
        self.connection = PersistenceConnection(self.cursor, fail_commit=fail_commit)
        self.migration_checks = 0

    def ensure_migrations_applied(self) -> None:
        self.migration_checks += 1

    def connect(self) -> PersistenceConnection:
        return self.connection


class FailingMarkStorage(MailAttachmentStorage):
    def mark_attached(self, upload_id: str) -> None:
        raise OSError(f"cannot attach {upload_id}")


class DeliveryCursor:
    def __init__(self, job: dict, provider: dict, attachments: list[dict]) -> None:
        self.job = job
        self.provider = provider
        self.attachments = attachments
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self._one: dict | None = None
        self._many: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        normalized = " ".join(query.split())
        lowered = normalized.lower()
        self.statements.append((normalized, tuple(params)))
        self._one = None
        self._many = []
        if lowered.startswith("select q.id as queue_id"):
            self._one = dict(self.job)
        elif lowered.startswith("update mail_delivery_queue"):
            self._one = {"id": self.job["queue_id"]}
        elif lowered.startswith("select file_name") and "from mail_attachments" in lowered:
            self._many = [dict(row) for row in self.attachments]
        elif lowered.startswith("select * from mail_provider_configs"):
            self._one = dict(self.provider)

    def fetchone(self) -> dict | None:
        return self._one

    def fetchall(self) -> list[dict]:
        return self._many


class DeliveryConnection:
    def __init__(self, cursor: DeliveryCursor) -> None:
        self._cursor = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self) -> DeliveryCursor:
        return self._cursor

    def commit(self) -> None:
        self.commit_count += 1


class DeliveryDatabase:
    def __init__(self, job: dict, provider: dict, attachments: list[dict]) -> None:
        self.cursor = DeliveryCursor(job, provider, attachments)
        self.connection = DeliveryConnection(self.cursor)
        self.migration_checks = 0

    def ensure_migrations_applied(self) -> None:
        self.migration_checks += 1

    def connect(self) -> DeliveryConnection:
        return self.connection


class DownloadCursor:
    def __init__(self, row: dict) -> None:
        self.row = row
        self.query = ""
        self.params: tuple[object, ...] = ()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.query = " ".join(query.split()).lower()
        self.params = tuple(params)

    def fetchone(self) -> dict | None:
        if "content_disposition = 'attachment'" in self.query:
            return self.row if self.row.get("content_disposition") == "attachment" else None
        return self.row


class DownloadDatabase:
    def __init__(self, row: dict) -> None:
        self.cursor = DownloadCursor(row)

    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> PreviewConnection:
        return PreviewConnection(self.cursor)


class MailInlinePersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.owner = actor()
        self.now = datetime(2026, 8, 26, 3, 0, tzinfo=UTC)

    def service(
        self,
        storage: MailAttachmentStorage,
        database: PersistenceDatabase,
    ) -> MailMessengerService:
        service = object.__new__(MailMessengerService)
        service.db = database
        service.attachment_storage = storage
        counter = {"value": 0}

        def new_id(prefix: str) -> str:
            counter["value"] += 1
            return f"{prefix}-{counter['value']}"

        service._new_id = new_id
        service._now = lambda: self.now
        service._fetch_mail_account = lambda _cursor, _user_id: {
            "id": "account-1",
            "email": "sender@example.test",
            "provider_config_id": "provider-1",
        }
        service._ensure_basic_preferences = lambda _cursor, _actor: {
            "sender_display_name": "Sender",
            "reply_to_email": None,
            "message_encoding": "utf-8",
            "save_sent_copy": True,
            "read_receipt_enabled": False,
        }
        service._fetch_enabled_signature = lambda _cursor, _actor: None
        service._write_mail_delivery_audit = lambda *_args, **_kwargs: None
        service._write_mail_event_audit = lambda *_args, **_kwargs: None
        service._upsert_recent_recipients = lambda *_args, **_kwargs: None
        service.get_basic_preferences = lambda _actor: SimpleNamespace(confirmBeforeSend=False)
        service.get_mail = lambda _actor, mail_id, _mailbox: SimpleNamespace(mailId=mail_id)
        return service

    @staticmethod
    def attachment_meta(uploaded: MailAttachmentUploadResponse) -> MailAttachmentMeta:
        return MailAttachmentMeta(
            uploadId=uploaded.uploadId,
            fileName=uploaded.fileName,
            contentType=uploaded.contentType,
            sizeBytes=uploaded.sizeBytes,
            disposition="inline",
            contentId="forged-client-cid@invalid.example",
        )

    @staticmethod
    def metadata(storage: MailAttachmentStorage, upload_id: str) -> dict:
        return json.loads(storage._metadata_path(upload_id).read_text(encoding="utf-8"))

    def test_draft_send_and_schedule_persist_canonical_inline_metadata(self) -> None:
        """Dropping canonical disposition/CID from any compose persistence path must fail."""
        cases = ("draft", "sent", "scheduled")
        for status in cases:
            with self.subTest(status=status), TemporaryDirectory() as temp_dir:
                storage = MailAttachmentStorage(Path(temp_dir))
                uploaded = storage.stage_inline_image(
                    self.owner,
                    f"{status}.png",
                    "image/png",
                    image_bytes("PNG"),
                )
                payload_values = {
                    "subject": f"{status} subject",
                    "bodyText": "inline body",
                    "bodyHtml": f'<p>body<img src="cid:{uploaded.contentId}"></p>',
                    "attachments": [self.attachment_meta(uploaded)],
                }
                database = PersistenceDatabase()
                service = self.service(storage, database)

                if status == "draft":
                    result = service.save_draft(self.owner, MailDraftRequest(**payload_values))
                else:
                    payload_values["to"] = ["outside@example.net"]
                    if status == "scheduled":
                        payload_values["scheduledAt"] = self.now + timedelta(hours=1)
                    result = service.send_mail(self.owner, MailSendRequest(**payload_values))

                self.assertEqual(result.status, status)
                self.assertEqual(len(database.cursor.attachment_inserts), 1)
                query, params = database.cursor.attachment_inserts[0]
                self.assertIn("content_disposition, content_id", query.lower())
                self.assertEqual(params[-3:-1], ("inline", uploaded.contentId))
                self.assertTrue(self.metadata(storage, uploaded.uploadId)["attached"])

    def test_save_rolls_back_database_when_commit_fails(self) -> None:
        """A failed commit must explicitly roll back and leave the staged sidecar reusable."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            uploaded = storage.stage_inline_image(
                self.owner,
                "commit.png",
                "image/png",
                image_bytes("PNG"),
            )
            database = PersistenceDatabase(fail_commit=True)
            service = self.service(storage, database)
            payload = MailDraftRequest(
                subject="commit failure",
                bodyText="body",
                bodyHtml=f'<img src="cid:{uploaded.contentId}">',
                attachments=[self.attachment_meta(uploaded)],
            )

            with self.assertRaisesRegex(RuntimeError, "commit failed"):
                service.save_draft(self.owner, payload)

            self.assertEqual(database.connection.rollback_count, 1)
            self.assertFalse(self.metadata(storage, uploaded.uploadId)["attached"])

    def test_save_rolls_back_database_and_sidecar_when_mark_attached_fails(self) -> None:
        """A staging transition failure must not leave committed attachment rows behind."""
        with TemporaryDirectory() as temp_dir:
            storage = FailingMarkStorage(Path(temp_dir))
            uploaded = storage.stage_inline_image(
                self.owner,
                "mark.png",
                "image/png",
                image_bytes("PNG"),
            )
            database = PersistenceDatabase()
            service = self.service(storage, database)
            payload = MailDraftRequest(
                subject="mark failure",
                bodyText="body",
                bodyHtml=f'<img src="cid:{uploaded.contentId}">',
                attachments=[self.attachment_meta(uploaded)],
            )

            with self.assertRaisesRegex(OSError, "cannot attach"):
                service.save_draft(self.owner, payload)

            self.assertEqual(database.connection.commit_count, 0)
            self.assertEqual(database.connection.rollback_count, 1)
            self.assertFalse(self.metadata(storage, uploaded.uploadId)["attached"])

    def test_scheduled_update_keeps_persisted_inline_and_adds_new_inline_atomically(self) -> None:
        """Scheduled reopen must sanitize against the exact persisted plus newly staged CID set."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            persisted = storage.stage_inline_image(
                self.owner,
                "persisted.png",
                "image/png",
                image_bytes("PNG", size=(2, 2)),
            )
            storage.mark_attached(persisted.uploadId)
            persisted_metadata = self.metadata(storage, persisted.uploadId)
            existing_row = {
                "id": "attachment-persisted",
                "file_name": persisted.fileName,
                "content_type": persisted.contentType,
                "size_bytes": persisted.sizeBytes,
                "storage_key": persisted_metadata["storageKey"],
                "content_disposition": "inline",
                "content_id": persisted.contentId,
            }
            newly_staged = storage.stage_inline_image(
                self.owner,
                "new.png",
                "image/png",
                image_bytes("PNG", size=(4, 3)),
            )
            database = PersistenceDatabase(
                existing_attachments=[existing_row],
                scheduled_message={
                    "id": "mail-scheduled",
                    "status": "scheduled",
                    "attachment_count": 1,
                },
            )
            service = self.service(storage, database)
            payload = MailScheduledUpdateRequest(
                to=["outside@example.net"],
                subject="updated scheduled",
                bodyText="mixed inline body",
                bodyHtml=(
                    f'<img src="cid:{persisted.contentId}">'
                    f'<img src="cid:{newly_staged.contentId}">'
                ),
                scheduledAt=self.now + timedelta(hours=2),
                attachments=[self.attachment_meta(newly_staged)],
            )

            result = service.update_scheduled_mail(self.owner, "mail-scheduled", payload)

            self.assertEqual(result.mailId, "mail-scheduled")
            self.assertEqual(len(database.cursor.attachment_inserts), 1)
            query, params = database.cursor.attachment_inserts[0]
            self.assertIn("content_disposition, content_id", query.lower())
            self.assertEqual(params[-3:-1], ("inline", newly_staged.contentId))
            update_statements = [
                (query, params)
                for query, params in database.cursor.statements
                if query.lower().startswith("update mail_messages")
            ]
            self.assertEqual(len(update_statements), 1)
            self.assertIn("attachment_count", update_statements[0][0].lower())
            self.assertIn(2, update_statements[0][1])
            self.assertTrue(self.metadata(storage, persisted.uploadId)["attached"])
            self.assertTrue(self.metadata(storage, newly_staged.uploadId)["attached"])

    def test_scheduled_update_restores_new_sidecar_on_mark_or_commit_failure(self) -> None:
        """Scheduled attachment staging and DB changes must roll back together on either failure."""
        for failure in ("mark", "commit"):
            with self.subTest(failure=failure), TemporaryDirectory() as temp_dir:
                storage_class = FailingMarkStorage if failure == "mark" else MailAttachmentStorage
                storage = storage_class(Path(temp_dir))
                newly_staged = storage.stage_inline_image(
                    self.owner,
                    f"{failure}.png",
                    "image/png",
                    image_bytes("PNG", size=(3, 2)),
                )
                database = PersistenceDatabase(
                    scheduled_message={"id": "mail-scheduled", "status": "scheduled"},
                    fail_commit=failure == "commit",
                )
                service = self.service(storage, database)
                payload = MailScheduledUpdateRequest(
                    to=["outside@example.net"],
                    subject=f"scheduled {failure}",
                    bodyText="body",
                    bodyHtml=f'<img src="cid:{newly_staged.contentId}">',
                    scheduledAt=self.now + timedelta(hours=2),
                    attachments=[self.attachment_meta(newly_staged)],
                )
                expected_error = OSError if failure == "mark" else RuntimeError

                with self.assertRaises(expected_error):
                    service.update_scheduled_mail(self.owner, "mail-scheduled", payload)

                self.assertEqual(database.connection.rollback_count, 1)
                self.assertFalse(self.metadata(storage, newly_staged.uploadId)["attached"])

    def test_detail_projects_inline_preview_without_mixing_normal_downloads(self) -> None:
        """Detail serialization must preserve inline metadata and expose only relative preview paths."""
        rows = [
            {
                "id": "attachment-normal",
                "file_name": "note.txt",
                "content_type": "text/plain",
                "size_bytes": 5,
                "content_disposition": "attachment",
                "content_id": None,
            },
            {
                "id": "attachment-inline",
                "file_name": "body.png",
                "content_type": "image/png",
                "size_bytes": 7,
                "content_disposition": "inline",
                "content_id": "cid-body@moaworks.invalid",
            },
        ]
        database = PersistenceDatabase(existing_attachments=rows)
        service = object.__new__(MailMessengerService)
        attachments = service._fetch_mail_attachments(database.cursor, "mail-1")

        self.assertEqual(attachments[0].disposition, "attachment")
        self.assertIsNone(attachments[0].contentId)
        self.assertIsNone(attachments[0].previewPath)
        self.assertEqual(attachments[1].disposition, "inline")
        self.assertEqual(attachments[1].contentId, "cid-body@moaworks.invalid")
        self.assertEqual(
            attachments[1].previewPath,
            "/mail/mail-1/attachments/attachment-inline/preview",
        )

        detail = service._to_mail_detail(
            {
                "mail_id": "mail-1",
                "account_id": "account-1",
                "sender_user_id": "user-a",
                "sender_email": "sender@example.test",
                "sender_display_name": "Sender",
                "subject": "subject",
                "body_text": "body",
                "body_html": '<img src="cid:cid-body@moaworks.invalid">',
                "status": "sent",
                "sent_at": self.now,
                "scheduled_at": None,
                "created_at": self.now,
                "updated_at": self.now,
                "retention_expires_at": self.now + timedelta(days=30),
                "attachment_count": 2,
                "is_sender_view": True,
                "read_receipt_requested": False,
            },
            [],
            attachments,
        )
        inline = detail.attachments[1]
        self.assertEqual(inline.disposition, "inline")
        self.assertEqual(inline.contentId, "cid-body@moaworks.invalid")
        self.assertEqual(
            inline.previewPath,
            "/mail/mail-1/attachments/attachment-inline/preview",
        )
        self.assertNotIn("storage", str(inline.model_dump()).lower())

    def test_save_rejects_invalid_inline_lifecycle_before_database_mutation(self) -> None:
        """Unknown, unreferenced, duplicate, foreign, and reused inline uploads must fail pre-write."""
        invalid_cases = (
            "unknown",
            "unreferenced",
            "duplicate",
            "foreign",
            "reused",
            "attachment_cid",
        )
        for case in invalid_cases:
            with self.subTest(case=case), TemporaryDirectory() as temp_dir:
                storage = MailAttachmentStorage(Path(temp_dir))
                first = storage.stage_inline_image(
                    self.owner,
                    "first.png",
                    "image/png",
                    image_bytes("PNG", size=(2, 2)),
                )
                attachments = [self.attachment_meta(first)]
                body_html = f'<img src="cid:{first.contentId}">'
                request_actor = self.owner
                expected_error: type[Exception] = ValueError
                if case == "unknown":
                    body_html = '<img src="cid:unknown@moaworks.invalid">'
                elif case == "unreferenced":
                    body_html = "<p>no inline image</p>"
                elif case == "duplicate":
                    second = storage.stage_inline_image(
                        self.owner,
                        "second.png",
                        "image/png",
                        image_bytes("PNG", size=(3, 2)),
                    )
                    second_metadata = self.metadata(storage, second.uploadId)
                    second_metadata["content_id"] = first.contentId
                    storage._metadata_path(second.uploadId).write_text(
                        json.dumps(second_metadata, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    attachments.append(self.attachment_meta(second))
                elif case == "foreign":
                    request_actor = actor(user_id="user-b")
                    expected_error = PermissionError
                elif case == "reused":
                    storage.mark_attached(first.uploadId)
                elif case == "attachment_cid":
                    ordinary = storage.stage(
                        self.owner,
                        "ordinary.txt",
                        "text/plain",
                        b"ordinary",
                    )
                    ordinary_metadata = self.metadata(storage, ordinary.uploadId)
                    ordinary_metadata["content_id"] = "forbidden@moaworks.invalid"
                    storage._metadata_path(ordinary.uploadId).write_text(
                        json.dumps(ordinary_metadata, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    attachments = [
                        MailAttachmentMeta(
                            uploadId=ordinary.uploadId,
                            fileName=ordinary.fileName,
                            contentType=ordinary.contentType,
                            sizeBytes=ordinary.sizeBytes,
                        )
                    ]
                    body_html = "<p>ordinary attachment</p>"

                database = PersistenceDatabase()
                service = self.service(storage, database)
                payload = MailDraftRequest(
                    subject=f"invalid {case}",
                    bodyText="body",
                    bodyHtml=body_html,
                    attachments=attachments,
                )

                with self.assertRaises(expected_error):
                    service.save_draft(request_actor, payload)

                self.assertEqual(database.cursor.statements, [])

    def test_scheduled_update_rejects_persisted_inline_that_differs_from_sidecar(self) -> None:
        """A scheduled persisted row must never override its canonical inline sidecar metadata."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            persisted = storage.stage_inline_image(
                self.owner,
                "persisted.png",
                "image/png",
                image_bytes("PNG", size=(2, 2)),
            )
            storage.mark_attached(persisted.uploadId)
            persisted_metadata = self.metadata(storage, persisted.uploadId)
            forged_content_id = "forged-persisted@moaworks.invalid"
            database = PersistenceDatabase(
                existing_attachments=[
                    {
                        "id": "attachment-persisted",
                        "file_name": persisted.fileName,
                        "content_type": persisted.contentType,
                        "size_bytes": persisted.sizeBytes,
                        "storage_key": persisted_metadata["storageKey"],
                        "content_disposition": "inline",
                        "content_id": forged_content_id,
                    }
                ],
                scheduled_message={
                    "id": "mail-scheduled",
                    "status": "scheduled",
                    "attachment_count": 1,
                },
            )
            service = self.service(storage, database)
            payload = MailScheduledUpdateRequest(
                to=["outside@example.net"],
                subject="forged persisted inline",
                bodyText="body",
                bodyHtml=f'<img src="cid:{forged_content_id}">',
                scheduledAt=self.now + timedelta(hours=2),
            )

            with self.assertRaisesRegex(ValueError, "저장 상태"):
                service.update_scheduled_mail(self.owner, "mail-scheduled", payload)

            self.assertEqual(database.connection.rollback_count, 1)
            self.assertEqual(database.cursor.attachment_inserts, [])

    def test_scheduled_update_rejects_duplicate_cid_across_persisted_and_new_inline(self) -> None:
        """Persisted and newly staged inline sets must not contain the same canonical CID."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            persisted = storage.stage_inline_image(
                self.owner,
                "persisted.png",
                "image/png",
                image_bytes("PNG", size=(2, 2)),
            )
            storage.mark_attached(persisted.uploadId)
            persisted_metadata = self.metadata(storage, persisted.uploadId)
            newly_staged = storage.stage_inline_image(
                self.owner,
                "new.png",
                "image/png",
                image_bytes("PNG", size=(3, 2)),
            )
            new_metadata = self.metadata(storage, newly_staged.uploadId)
            new_metadata["content_id"] = persisted.contentId
            storage._metadata_path(newly_staged.uploadId).write_text(
                json.dumps(new_metadata, ensure_ascii=False),
                encoding="utf-8",
            )
            database = PersistenceDatabase(
                existing_attachments=[
                    {
                        "id": "attachment-persisted",
                        "file_name": persisted.fileName,
                        "content_type": persisted.contentType,
                        "size_bytes": persisted.sizeBytes,
                        "storage_key": persisted_metadata["storageKey"],
                        "content_disposition": "inline",
                        "content_id": persisted.contentId,
                    }
                ],
                scheduled_message={"id": "mail-scheduled", "status": "scheduled"},
            )
            service = self.service(storage, database)
            payload = MailScheduledUpdateRequest(
                to=["outside@example.net"],
                subject="duplicate mixed inline",
                bodyText="body",
                bodyHtml=f'<img src="cid:{persisted.contentId}">',
                scheduledAt=self.now + timedelta(hours=2),
                attachments=[self.attachment_meta(newly_staged)],
            )

            with self.assertRaisesRegex(ValueError, "중복"):
                service.update_scheduled_mail(self.owner, "mail-scheduled", payload)

            self.assertEqual(database.connection.rollback_count, 1)
            self.assertFalse(self.metadata(storage, newly_staged.uploadId)["attached"])
            self.assertEqual(database.cursor.attachment_inserts, [])

    def test_scheduled_update_rejects_inline_sidecar_disguised_as_ordinary_row(self) -> None:
        """Changing only the persisted disposition must not bypass canonical inline handling."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            persisted = storage.stage_inline_image(
                self.owner,
                "persisted.png",
                "image/png",
                image_bytes("PNG", size=(2, 2)),
            )
            storage.mark_attached(persisted.uploadId)
            persisted_metadata = self.metadata(storage, persisted.uploadId)
            database = PersistenceDatabase(
                existing_attachments=[
                    {
                        "id": "attachment-persisted",
                        "file_name": persisted.fileName,
                        "content_type": persisted.contentType,
                        "size_bytes": persisted.sizeBytes,
                        "storage_key": persisted_metadata["storageKey"],
                        "content_disposition": "attachment",
                        "content_id": None,
                    }
                ],
                scheduled_message={"id": "mail-scheduled", "status": "scheduled"},
            )
            service = self.service(storage, database)
            payload = MailScheduledUpdateRequest(
                to=["outside@example.net"],
                subject="disguised persisted inline",
                bodyText="body",
                bodyHtml="<p>no image</p>",
                scheduledAt=self.now + timedelta(hours=2),
            )

            with self.assertRaisesRegex(ValueError, "저장 상태"):
                service.update_scheduled_mail(self.owner, "mail-scheduled", payload)

            self.assertEqual(database.connection.rollback_count, 1)


class MailInlineQueueAndDownloadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.owner = actor()

    @staticmethod
    def database(attachment: dict) -> DeliveryDatabase:
        return DeliveryDatabase(
            {
                "queue_id": "queue-1",
                "attempt_count": 0,
                "company_id": "company-a",
                "provider_config_id": "provider-1",
                "mail_id": "mail-1",
                "recipient_id": "recipient-1",
            },
            {
                "id": "provider-1",
                "company_id": "company-a",
                "username": "",
                "encrypted_password": "",
                "encrypted_dkim_private_key": None,
            },
            [attachment],
        )

    @staticmethod
    def persisted_inline(
        storage: MailAttachmentStorage,
        owner: AuthUserSummary,
    ) -> tuple[MailAttachmentUploadResponse, dict, dict]:
        uploaded = storage.stage_inline_image(
            owner,
            "queue.png",
            "image/png",
            image_bytes("PNG", size=(4, 2)),
        )
        storage.mark_attached(uploaded.uploadId)
        metadata = json.loads(storage._metadata_path(uploaded.uploadId).read_text(encoding="utf-8"))
        return uploaded, metadata, {
            "file_name": uploaded.fileName,
            "content_type": uploaded.contentType,
            "size_bytes": uploaded.sizeBytes,
            "storage_key": metadata["storageKey"],
            "content_disposition": "inline",
            "content_id": uploaded.contentId,
        }

    def test_queue_claim_carries_verified_inline_metadata_and_sha256(self) -> None:
        """Queue envelope metadata must come from the canonical inline sidecar and verified bytes."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            uploaded, metadata, attachment = self.persisted_inline(storage, self.owner)
            database = self.database(attachment)
            operations = MailDeliveryOperations(db=database, storage=storage)

            claimed = operations.claim_next("worker-1")

            self.assertIsNotNone(claimed)
            job, _provider = claimed
            self.assertEqual(len(job["attachments"]), 1)
            envelope = job["attachments"][0]
            self.assertEqual(envelope["file_name"], uploaded.fileName)
            self.assertEqual(envelope["content_type"], uploaded.contentType)
            self.assertEqual(envelope["size_bytes"], uploaded.sizeBytes)
            self.assertEqual(envelope["content_disposition"], "inline")
            self.assertEqual(envelope["content_id"], uploaded.contentId)
            self.assertEqual(envelope["sha256"], metadata["sha256"])
            self.assertEqual(Path(envelope["path"]).read_bytes(), storage.stored_path(metadata["storageKey"]).read_bytes())
            self.assertNotIn("storage_key", envelope)

    def test_queue_claim_rejects_tampered_inline_binary(self) -> None:
        """A persisted inline binary whose SHA no longer matches its sidecar must never enter the queue."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            _uploaded, metadata, attachment = self.persisted_inline(storage, self.owner)
            path = storage.stored_path(metadata["storageKey"])
            path.write_bytes(path.read_bytes()[::-1])
            database = self.database(attachment)
            operations = MailDeliveryOperations(db=database, storage=storage)

            with self.assertRaisesRegex(ValueError, "저장 상태"):
                operations.claim_next("worker-1")

            self.assertEqual(database.connection.commit_count, 0)

    def test_queue_claim_rejects_inline_sidecar_disguised_as_ordinary_row(self) -> None:
        """A DB disposition change must not let an inline upload bypass sidecar verification."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            _uploaded, _metadata, attachment = self.persisted_inline(storage, self.owner)
            attachment["content_disposition"] = "attachment"
            attachment["content_id"] = None
            database = self.database(attachment)
            operations = MailDeliveryOperations(db=database, storage=storage)

            with self.assertRaisesRegex(ValueError, "저장 상태"):
                operations.claim_next("worker-1")

    def test_inline_attachment_is_not_available_from_normal_download(self) -> None:
        """Inline rows must be served only by preview and excluded from normal attachment download."""
        with TemporaryDirectory() as temp_dir:
            storage = MailAttachmentStorage(Path(temp_dir))
            _uploaded, _metadata, attachment = self.persisted_inline(storage, self.owner)
            attachment["id"] = "attachment-inline"
            service = object.__new__(MailMessengerService)
            service.db = DownloadDatabase(attachment)
            service.attachment_storage = storage
            service._fetch_accessible_mail = lambda _cursor, _actor, mail_id: {"mail_id": mail_id}

            with self.assertRaises(PermissionError):
                service.download_attachment(self.owner, "mail-1", "attachment-inline")


class MailInlineAttachmentContractTests(unittest.TestCase):
    def test_attachment_default_is_backward_compatible(self) -> None:
        """Removing the attachment default or adding a default CID must fail this test."""
        item = MailAttachmentMeta(
            uploadId="a" * 32,
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )

        self.assertEqual(item.disposition, "attachment")
        self.assertIsNone(item.contentId)

    def test_inline_requires_content_id(self) -> None:
        """Removing the inline/CID validation must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentMeta(
                uploadId="b" * 32,
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                disposition="inline",
            )

    def test_inline_rejects_empty_or_whitespace_content_id(self) -> None:
        """Accepting an empty CID after trimming must fail this test."""
        for content_id in ("", " \t\n "):
            with self.subTest(content_id=repr(content_id)), self.assertRaises(ValidationError):
                MailAttachmentMeta(
                    uploadId="b" * 32,
                    fileName="a.png",
                    contentType="image/png",
                    sizeBytes=1,
                    disposition="inline",
                    contentId=content_id,
                )

    def test_attachment_rejects_content_id(self) -> None:
        """Allowing a CID on a normal attachment must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentMeta(
                uploadId="c" * 32,
                fileName="a.txt",
                contentType="text/plain",
                sizeBytes=1,
                contentId="mw-1@moaworks.invalid",
            )

    def test_inline_accepts_content_id(self) -> None:
        """Rejecting a complete inline attachment contract must fail this test."""
        item = MailAttachmentMeta(
            uploadId="d" * 32,
            fileName="a.png",
            contentType="image/png",
            sizeBytes=1,
            disposition="inline",
            contentId="mw-1@moaworks.invalid",
        )

        self.assertEqual(item.disposition, "inline")
        self.assertEqual(item.contentId, "mw-1@moaworks.invalid")

    def test_meta_rejects_non_string_content_id_with_validation_error(self) -> None:
        """Leaking AttributeError for a JSON number CID must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentMeta(
                uploadId="d" * 32,
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                disposition="inline",
                contentId=123,
            )

    def test_upload_response_rejects_non_string_content_id_with_validation_error(self) -> None:
        """Leaking AttributeError for a response JSON number CID must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentUploadResponse(
                uploadId="e" * 32,
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                disposition="inline",
                contentId=123,
            )

    def test_view_rejects_non_string_content_id_with_validation_error(self) -> None:
        """Leaking AttributeError for a view JSON number CID must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentView(
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                disposition="inline",
                contentId=123,
            )

    def test_upload_and_view_keep_attachment_safe_defaults(self) -> None:
        """Removing API response defaults or exposing a default CID must fail this test."""
        uploaded = MailAttachmentUploadResponse(
            uploadId="e" * 32,
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )
        view = MailAttachmentView(
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )

        for item in (uploaded, view):
            self.assertEqual(item.disposition, "attachment")
            self.assertIsNone(item.contentId)
            self.assertIsNone(item.previewPath)

    def test_upload_and_view_enforce_inline_content_id_contract(self) -> None:
        """Allowing invalid response disposition/CID combinations must fail this test."""
        factories = (
            lambda **values: MailAttachmentUploadResponse(
                uploadId="e" * 32,
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                **values,
            ),
            lambda **values: MailAttachmentView(
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                **values,
            ),
        )

        for factory in factories:
            for content_id in (None, "", " \t "):
                with self.subTest(factory=factory, content_id=repr(content_id)), self.assertRaises(ValidationError):
                    factory(disposition="inline", contentId=content_id)
            with self.subTest(factory=factory), self.assertRaises(ValidationError):
                factory(disposition="attachment", contentId="mw-1@moaworks.invalid")

            item = factory(disposition="inline", contentId=" mw-1@moaworks.invalid ")
            self.assertEqual(item.contentId, "mw-1@moaworks.invalid")

    def test_meta_model_dump_excludes_internal_content_id(self) -> None:
        """Exposing a client-supplied CID in the request dump must fail this test."""
        item = MailAttachmentMeta(
            uploadId="f" * 32,
            fileName="a.png",
            contentType="image/png",
            sizeBytes=1,
            disposition="inline",
            contentId="mw-1@moaworks.invalid",
        )

        serialized = item.model_dump(mode="json")

        self.assertEqual(serialized["disposition"], "inline")
        self.assertNotIn("contentId", serialized)

    def test_migration_declares_inline_contract_without_checksum_column(self) -> None:
        """Dropping a DB guard/index or adding checksum storage must fail this static contract test."""
        migration = (Path(__file__).parent / "migrations" / "065_mail_inline_attachments.sql").read_text(
            encoding="utf-8"
        ).lower()
        normalized = "".join(migration.split())

        self.assertIn("addcolumnifnotexistscontent_dispositiontextnotnulldefault'attachment'", normalized)
        self.assertIn("addcolumnifnotexistscontent_idtextnull", normalized)
        self.assertEqual(normalized.count("dropconstraintifexists"), 2)
        self.assertEqual(normalized.count("addconstraintmail_attachments_"), 2)
        self.assertIn("dropconstraintifexistsmail_attachments_content_disposition_check", normalized)
        self.assertIn("addconstraintmail_attachments_content_disposition_check", normalized)
        self.assertIn("dropconstraintifexistsmail_attachments_inline_content_id_check", normalized)
        self.assertIn("addconstraintmail_attachments_inline_content_id_check", normalized)
        self.assertIn("content_dispositionin('attachment','inline')", normalized)
        self.assertIn(
            "content_disposition='inline'andcontent_idisnotnullandcontent_id~'[^[:space:]]'",
            normalized,
        )
        self.assertNotIn("btrim(content_id)", normalized)
        self.assertIn("content_disposition='attachment'andcontent_idisnull", normalized)
        self.assertIn(
            "createuniqueindexifnotexistsuq_mail_attachments_message_content_id"
            "onmail_attachments(message_id,content_id)wherecontent_idisnotnull",
            normalized,
        )
        self.assertNotIn("checksum", migration)


class MailInlineImageStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.storage = MailAttachmentStorage(
            Path(self.temp_dir.name),
            max_file_bytes=10 * 1024 * 1024,
        )
        self.owner = actor()

    def service(self, *, database: PreviewDatabase | None = None) -> MailMessengerService:
        service = object.__new__(MailMessengerService)
        service.attachment_storage = self.storage
        service.db = database or PreviewDatabase(None)
        return service

    def client(self, request_actor: AuthUserSummary, service: MailMessengerService) -> TestClient:
        app = FastAPI()
        app.include_router(mail_routes.router, prefix="/mail")
        app.dependency_overrides[get_current_user] = lambda: request_actor
        service_patch = patch.object(mail_routes, "_service", return_value=service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        client = TestClient(app)
        self.addCleanup(client.close)
        return client

    def metadata_for(self, upload_id: str) -> dict:
        return json.loads(
            (self.storage.upload_root / f"{upload_id}.json").read_text(encoding="utf-8")
        )

    def test_stage_inline_reencodes_and_generates_canonical_sidecar(self) -> None:
        """Missing canonical server CID, normalized metadata, or SHA-256 must fail this test."""
        original = image_bytes("PNG", metadata=True)

        uploaded = self.storage.stage_inline_image(
            self.owner,
            "receipt.png",
            "image/png",
            original,
        )

        self.assertEqual(uploaded.disposition, "inline")
        self.assertRegex(uploaded.contentId or "", r"^mw-[0-9a-f]{32}@moaworks\.invalid$")
        self.assertEqual(
            uploaded.previewPath,
            f"/mail/attachments/staged/{uploaded.uploadId}/preview",
        )
        data = (self.storage.upload_root / f"{uploaded.uploadId}.bin").read_bytes()
        metadata = self.metadata_for(uploaded.uploadId)
        self.assertEqual(metadata["content_disposition"], "inline")
        self.assertEqual(metadata["content_id"], uploaded.contentId)
        self.assertEqual(metadata["normalized_content_type"], "image/png")
        self.assertEqual(metadata["normalized_size_bytes"], len(data))
        self.assertEqual(metadata["sha256"], sha256(data).hexdigest())
        self.assertNotEqual(data, original)

        resolved = self.storage.resolve(
            self.owner,
            MailAttachmentMeta(
                uploadId=uploaded.uploadId,
                fileName=uploaded.fileName,
                contentType=uploaded.contentType,
                sizeBytes=uploaded.sizeBytes,
                disposition="inline",
                contentId="mw-client-value@moaworks.invalid",
            ),
        )
        self.assertEqual(resolved["content_disposition"], "inline")
        self.assertEqual(resolved["content_id"], uploaded.contentId)
        self.assertEqual(resolved["sha256"], metadata["sha256"])

    def test_stage_inline_accepts_only_matching_png_jpeg_and_webp(self) -> None:
        """Dropping any approved format or returning a mismatched normalized MIME must fail this test."""
        formats = (
            ("PNG", "image.png", "image/png"),
            ("JPEG", "image.jpeg", "image/jpeg"),
            ("WEBP", "image.webp", "image/webp"),
        )

        for image_format, file_name, content_type in formats:
            with self.subTest(image_format=image_format):
                uploaded = self.storage.stage_inline_image(
                    self.owner,
                    file_name,
                    content_type,
                    image_bytes(image_format),
                )
                preview = self.storage.open_staged_preview(self.owner, uploaded.uploadId)
                with Image.open(BytesIO(preview["content"])) as normalized:
                    self.assertEqual(normalized.format, image_format)
                self.assertEqual(uploaded.contentType, content_type)
                self.assertEqual(preview["contentType"], content_type)

    def test_stage_inline_rejects_extension_mime_magic_and_decode_mismatch(self) -> None:
        """Accepting any inconsistent file declaration or undecodable payload must fail this test."""
        png = image_bytes("PNG")
        gif = image_bytes("GIF")
        cases = (
            ("wrong.jpg", "image/png", png),
            ("wrong.png", "image/jpeg", png),
            ("wrong.png", "image/png", gif),
            ("broken.png", "image/png", b"\x89PNG\r\n\x1a\nnot-an-image"),
        )

        for file_name, content_type, content in cases:
            with self.subTest(file_name=file_name, content_type=content_type), self.assertRaises(ValueError):
                self.storage.stage_inline_image(self.owner, file_name, content_type, content)

    def test_stage_inline_rejects_svg_and_gif(self) -> None:
        """Allowing SVG or GIF through extension, MIME, magic, or decode checks must fail this test."""
        cases = (
            ("vector.svg", "image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg"/>'),
            ("animated.gif", "image/gif", image_bytes("GIF")),
        )

        for file_name, content_type, content in cases:
            with self.subTest(file_name=file_name), self.assertRaises(ValueError):
                self.storage.stage_inline_image(self.owner, file_name, content_type, content)

    def test_stage_inline_rejects_original_over_five_mib(self) -> None:
        """Reading or decoding an original above the exact 5 MiB boundary must fail this test."""
        oversized = b"\x89PNG\r\n\x1a\n" + b"x" * (INLINE_IMAGE_MAX_BYTES - 7)
        self.assertEqual(len(oversized), INLINE_IMAGE_MAX_BYTES + 1)

        with self.assertRaises(ValueError):
            self.storage.stage_inline_image(self.owner, "large.png", "image/png", oversized)

    def test_stage_inline_rejects_normalized_over_five_mib_before_write(self) -> None:
        """Allowing an oversized canonical re-encode or leaving sidecar/bin artifacts must fail this test."""
        source = image_bytes("PNG")
        oversized_normalized = b"x" * (INLINE_IMAGE_MAX_BYTES + 1)

        with patch.object(
            self.storage,
            "_normalize_inline_image",
            return_value=oversized_normalized,
        ), self.assertRaises(ValueError):
            self.storage.stage_inline_image(self.owner, "expanded.png", "image/png", source)

        self.assertEqual(list(self.storage.upload_root.glob("*.bin")), [])
        self.assertEqual(list(self.storage.upload_root.glob("*.json")), [])

    def test_stage_inline_enforces_4096_pixel_boundary(self) -> None:
        """Rejecting 4096 or accepting 4097 pixels in either dimension must fail this test."""
        accepted = self.storage.stage_inline_image(
            self.owner,
            "wide.png",
            "image/png",
            image_bytes("PNG", size=(4096, 1)),
        )
        self.assertEqual(accepted.disposition, "inline")

        with self.assertRaises(ValueError):
            self.storage.stage_inline_image(
                self.owner,
                "too-wide.png",
                "image/png",
                image_bytes("PNG", size=(4097, 1)),
            )

    def test_stage_inline_rejects_header_dimension_before_decode_load(self) -> None:
        """Calling Pillow load before rejecting a 4097-pixel header must fail this test."""
        content = image_bytes("PNG", size=(4097, 1))
        original_load = Image.Image.load
        load_calls: list[tuple[int, int]] = []

        def recording_load(image, *args, **kwargs):
            load_calls.append(image.size)
            return original_load(image, *args, **kwargs)

        with patch.object(Image.Image, "load", new=recording_load), self.assertRaises(ValueError):
            self.storage.stage_inline_image(self.owner, "too-wide.png", "image/png", content)

        self.assertEqual(load_calls, [])

    def test_stage_inline_rechecks_dimension_after_exif_transpose(self) -> None:
        """Dropping the final post-transpose dimension guard must fail this test."""
        content = image_bytes("JPEG", size=(3, 2))
        oversized_transposed = Image.new("RGB", (4097, 1), (1, 2, 3))
        self.addCleanup(oversized_transposed.close)

        with patch.object(ImageOps, "exif_transpose", return_value=oversized_transposed), self.assertRaises(ValueError):
            self.storage.stage_inline_image(self.owner, "rotated.jpg", "image/jpeg", content)

    def test_stage_inline_rejects_decompression_bomb_warning_or_error(self) -> None:
        """Ignoring Pillow decompression-bomb signals before pixel validation must fail this test."""
        content = image_bytes("PNG", size=(3, 3))

        with patch.object(Image, "MAX_IMAGE_PIXELS", 1), self.assertRaises(ValueError):
            self.storage.stage_inline_image(self.owner, "bomb.png", "image/png", content)

    def test_stage_inline_applies_exif_transpose_and_removes_metadata(self) -> None:
        """Keeping EXIF orientation or any source metadata after normalization must fail this test."""
        original = image_bytes(
            "JPEG",
            size=(3, 2),
            metadata=True,
            exif_orientation=6,
        )

        uploaded = self.storage.stage_inline_image(
            self.owner,
            "phone.jpg",
            "image/jpeg",
            original,
        )
        preview = self.storage.open_staged_preview(self.owner, uploaded.uploadId)

        with Image.open(BytesIO(preview["content"])) as normalized:
            self.assertEqual(normalized.size, (2, 3))
            self.assertEqual(dict(normalized.getexif()), {})
            for metadata_key in ("exif", "icc_profile", "xmp", "comment"):
                self.assertNotIn(metadata_key, normalized.info)

    def test_preview_staged_requires_matching_company_and_user(self) -> None:
        """Checking only company or only user ownership for a staged preview must fail this test."""
        uploaded = self.storage.stage_inline_image(
            self.owner,
            "owner.png",
            "image/png",
            image_bytes("PNG"),
        )

        preview = self.storage.open_staged_preview(self.owner, uploaded.uploadId)
        self.assertEqual(preview["contentType"], "image/png")
        self.assertNotIn("path", preview)
        self.assertNotIn("storageKey", preview)
        for other_actor in (
            actor(user_id="user-b", company_id=self.owner.companyId),
            actor(user_id=self.owner.userId, company_id="company-b"),
        ):
            with self.subTest(other_actor=other_actor), self.assertRaises(PermissionError):
                self.storage.open_staged_preview(other_actor, uploaded.uploadId)

    def test_preview_staged_rejects_binary_that_no_longer_matches_sidecar_sha256(self) -> None:
        """Serving a tampered staged binary without canonical size and SHA-256 checks must fail this test."""
        uploaded = self.storage.stage_inline_image(
            self.owner,
            "tamper.png",
            "image/png",
            image_bytes("PNG"),
        )
        data_path = self.storage.upload_root / f"{uploaded.uploadId}.bin"
        data_path.write_bytes(data_path.read_bytes() + b"tampered")

        with self.assertRaises(ValueError):
            self.storage.open_staged_preview(self.owner, uploaded.uploadId)

    def test_preview_persisted_checks_message_access_and_attachment_relationship(self) -> None:
        """Dropping company/user access or the attachment-message join from persisted preview must fail this test."""
        uploaded = self.storage.stage_inline_image(
            self.owner,
            "persisted.png",
            "image/png",
            image_bytes("PNG"),
        )
        metadata = self.metadata_for(uploaded.uploadId)
        database = PreviewDatabase(
            {
                "file_name": uploaded.fileName,
                "content_type": uploaded.contentType,
                "size_bytes": uploaded.sizeBytes,
                "storage_key": metadata["storageKey"],
            }
        )

        preview = self.storage.open_persisted_preview(
            self.owner,
            "mail-1",
            "attachment-1",
            database,
        )

        self.assertEqual(preview["contentType"], "image/png")
        self.assertNotIn("path", preview)
        self.assertEqual(database.migration_checks, 1)
        normalized_query = database.cursor.query.lower()
        expected_query = " ".join(
            """
            SELECT DISTINCT a.file_name, a.content_type, a.size_bytes, a.storage_key
            FROM mail_attachments a
            JOIN mail_messages m ON a.message_id = m.id
            LEFT JOIN mail_recipients r ON r.message_id = m.id
            WHERE a.id = %s
              AND a.message_id = %s
              AND m.company_id = %s
              AND a.content_disposition = 'inline'
              AND a.content_id IS NOT NULL
              AND (
                (m.sender_user_id = %s AND m.sender_purged_at IS NULL)
                OR (
                  (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                  AND r.purged_at IS NULL
                )
              )
            """.lower().split()
        )
        self.assertEqual(normalized_query, expected_query)
        self.assertEqual(normalized_query.count("%s"), 6)
        self.assertEqual(
            database.cursor.params,
            (
                "attachment-1",
                "mail-1",
                self.owner.companyId,
                self.owner.userId,
                self.owner.userId,
                self.owner.userEmail.lower(),
            ),
        )

    def test_preview_persisted_denies_missing_access_or_relationship(self) -> None:
        """Returning a persisted binary when the authorized join finds no row must fail this test."""
        database = PreviewDatabase(None)

        with self.assertRaises(PermissionError):
            self.storage.open_persisted_preview(
                self.owner,
                "mail-1",
                "attachment-other",
                database,
            )

    def test_stage_inline_upload_route_preserves_attachment_default(self) -> None:
        """Breaking legacy multipart uploads without a disposition or not routing inline explicitly must fail this test."""
        calls: list[tuple[str, str, str, bytes]] = []

        class CapturingService:
            def stage_attachment(self, _actor, file_name, content_type, content):
                calls.append(("attachment", file_name, content_type, content))
                return MailAttachmentUploadResponse(
                    uploadId="a" * 32,
                    fileName=file_name,
                    contentType=content_type,
                    sizeBytes=len(content),
                )

            def stage_inline_image(self, _actor, file_name, content_type, content):
                calls.append(("inline", file_name, content_type, content))
                return MailAttachmentUploadResponse(
                    uploadId="b" * 32,
                    fileName=file_name,
                    contentType=content_type,
                    sizeBytes=len(content),
                    disposition="inline",
                    contentId="mw-b@moaworks.invalid",
                    previewPath=f"/mail/attachments/staged/{'b' * 32}/preview",
                )

        client = self.client(self.owner, CapturingService())
        normal_response = client.post(
            "/mail/attachments",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        inline_response = client.post(
            "/mail/attachments",
            data={"disposition": "inline"},
            files={"file": ("photo.png", image_bytes("PNG"), "image/png")},
        )

        self.assertEqual(normal_response.status_code, 200)
        self.assertEqual(normal_response.json()["disposition"], "attachment")
        self.assertEqual(inline_response.status_code, 200)
        self.assertEqual(inline_response.json()["disposition"], "inline")
        self.assertEqual([call[0] for call in calls], ["attachment", "inline"])

    def test_preview_staged_route_is_owner_only_no_store_nosniff_and_hides_paths(self) -> None:
        """Missing preview security headers, owner checks, or path-safe errors must fail this test."""
        uploaded = self.storage.stage_inline_image(
            self.owner,
            "route.png",
            "image/png",
            image_bytes("PNG"),
        )
        service = self.service()
        owner_response = self.client(self.owner, service).get(
            f"/mail/attachments/staged/{uploaded.uploadId}/preview"
        )

        self.assertEqual(owner_response.status_code, 200)
        self.assertEqual(owner_response.headers["content-disposition"], "inline")
        self.assertEqual(owner_response.headers["cache-control"], "private, no-store")
        self.assertEqual(owner_response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(owner_response.headers["content-type"], "image/png")
        self.assertNotIn(str(Path(self.temp_dir.name).resolve()), owner_response.text)

        other_response = self.client(actor(user_id="user-b"), service).get(
            f"/mail/attachments/staged/{uploaded.uploadId}/preview"
        )
        self.assertEqual(other_response.status_code, 403)
        self.assertNotIn(str(Path(self.temp_dir.name).resolve()), other_response.text)

        (self.storage.upload_root / f"{uploaded.uploadId}.bin").unlink()
        missing_response = self.client(self.owner, service).get(
            f"/mail/attachments/staged/{uploaded.uploadId}/preview"
        )
        self.assertEqual(missing_response.status_code, 400)
        self.assertNotIn(str(Path(self.temp_dir.name).resolve()), missing_response.text)

    def test_preview_persisted_route_uses_no_store_nosniff_headers(self) -> None:
        """Serving persisted inline images without the approved response headers must fail this test."""
        uploaded = self.storage.stage_inline_image(
            self.owner,
            "persisted-route.png",
            "image/png",
            image_bytes("PNG"),
        )
        metadata = self.metadata_for(uploaded.uploadId)
        database = PreviewDatabase(
            {
                "file_name": uploaded.fileName,
                "content_type": uploaded.contentType,
                "size_bytes": uploaded.sizeBytes,
                "storage_key": metadata["storageKey"],
            }
        )
        response = self.client(self.owner, self.service(database=database)).get(
            "/mail/mail-1/attachments/attachment-1/preview"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-disposition"], "inline")
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["content-type"], "image/png")


if __name__ == "__main__":
    unittest.main()
