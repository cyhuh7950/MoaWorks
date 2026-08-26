from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from pydantic import ValidationError

from app.api.dependencies import get_current_user
from app.api.routes import mail as mail_routes
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailAttachmentUploadResponse,
    MailAttachmentView,
)
from app.services.mail_attachment_storage import MailAttachmentStorage
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
        for required_sql in (
            "a.message_id = m.id",
            "a.id = %s",
            "a.message_id = %s",
            "m.company_id = %s",
            "a.content_disposition = 'inline'",
            "r.message_id = m.id",
        ):
            self.assertIn(required_sql, normalized_query)
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
