from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui035ApprovalBasicSettingsContractTests(unittest.TestCase):
    def test_migration_037_is_additive_and_keeps_history_snapshot(self) -> None:
        sql = (ROOT / "migrations" / "037_approval_basic_preferences.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS approval_basic_preferences", sql)
        for column in ("writing_method", "attachment_image_display", "signature_storage_key", "version"):
            self.assertIn(column, sql)
        for column in ("signature_storage_key", "signature_file_name", "signature_content_type", "signature_size_bytes"):
            self.assertIn(f"ADD COLUMN IF NOT EXISTS {column}", sql)
        self.assertNotIn("DROP TABLE", sql.upper())
        self.assertNotIn("DELETE FROM", sql.upper())

    def test_schema_accepts_only_confirmed_policy_values(self) -> None:
        from app.schemas.directory import ApprovalBasicPreferenceResponse

        value = ApprovalBasicPreferenceResponse(
            writingMethod="general",
            attachmentImageDisplay="thumbnail",
            version=0,
            hasSignature=False,
        )
        self.assertEqual(value.writingMethod, "general")
        with self.assertRaises(ValidationError):
            ApprovalBasicPreferenceResponse(
                writingMethod="template",
                attachmentImageDisplay="thumbnail",
                version=0,
                hasSignature=False,
            )

    def test_signature_storage_accepts_real_png_jpeg_and_webp(self) -> None:
        from app.services.approval_signature_storage import ApprovalSignatureStorage

        samples = (
            ("sign.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 16),
            ("sign.jpg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"x" * 16),
            ("sign.webp", "image/webp", b"RIFF\x0c\x00\x00\x00WEBP" + b"x" * 8),
        )
        with TemporaryDirectory() as directory:
            storage = ApprovalSignatureStorage(Path(directory))
            for name, mime, content in samples:
                with self.subTest(name=name):
                    staged = storage.stage(name, mime, content)
                    self.assertTrue(storage.stored_path(str(staged["storage_key"])).is_file())

    def test_signature_storage_rejects_spoof_oversize_and_traversal(self) -> None:
        from app.services.approval_signature_storage import ApprovalSignatureStorage

        with TemporaryDirectory() as directory:
            storage = ApprovalSignatureStorage(Path(directory), max_file_bytes=32)
            for name, mime, content in (
                ("sign.png", "image/png", b"not-an-image"),
                ("sign.jpg", "image/png", b"\x89PNG\r\n\x1a\n"),
                ("sign.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 40),
            ):
                with self.subTest(name=name, mime=mime):
                    with self.assertRaises(ValueError):
                        storage.stage(name, mime, content)
            with self.assertRaises(ValueError):
                storage.stored_path("approval/signatures/../../secret.png")

    def test_signature_storage_sanitizes_file_name_and_randomizes_key(self) -> None:
        from app.services.approval_signature_storage import ApprovalSignatureStorage

        with TemporaryDirectory() as directory:
            storage = ApprovalSignatureStorage(Path(directory))
            first = storage.stage("../folder/si\x00gn.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 8)
            second = storage.stage("sign.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 8)
            self.assertEqual(first["file_name"], "sign.png")
            self.assertNotEqual(first["storage_key"], second["storage_key"])
            self.assertNotIn("..", str(first["storage_key"]))

    def test_settings_routes_precede_dynamic_document_route_and_keep_permissions(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        self.assertLess(source.index('@router.get("/settings/basic"'), source.index('@router.get("/{document_id}"'))
        self.assertIn('permission_required("approval:read")', source[source.index('@router.get("/settings/basic"'):source.index('@router.put("/settings/basic"')])
        self.assertIn('permission_required("approval:create")', source[source.index('@router.put("/settings/basic"'):source.index('@router.get("/settings/signature"')])
        self.assertIn('Form(...)', source)
        self.assertIn('File(default=None)', source)

    def test_inline_routes_bind_document_and_child_and_set_safe_headers(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        for marker in (
            '@router.get("/settings/signature")',
            '@router.get("/{document_id}/lines/{line_id}/signature")',
            '@router.get("/{document_id}/attachments/{attachment_id}/preview")',
        ):
            self.assertIn(marker, source)
        self.assertIn('headers={"X-Content-Type-Options": "nosniff"}', source)
        self.assertIn("get_approval_line_signature(user.userId, document_id, line_id)", source)
        self.assertIn("get_approval_attachment_preview(user.userId, document_id, attachment_id)", source)

    def test_virtual_default_optimistic_lock_audit_and_rollback_contract(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        block = source.split("def get_approval_basic_preferences", 1)[1].split("def get_approval_signature", 1)[0]
        self.assertIn('writingMethod="general"', block)
        self.assertIn('attachmentImageDisplay="thumbnail"', block)
        self.assertIn("version=0", block)
        update = source.split("def update_approval_basic_preferences", 1)[1].split("def get_approval_line_signature", 1)[0]
        for token in ("FOR UPDATE", "expected_version", "ApprovalPreferenceConflictError", "approval.settings.updated", "connection.commit()"):
            self.assertIn(token, update)
        self.assertIn("storage.delete", update)
        self.assertIn("approval_lines", update)

    def test_approve_snapshots_signature_but_reject_does_not(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        decision = source.split("def _process_approval_decision", 1)[1].split("def _fetch_user_view_row", 1)[0]
        self.assertIn("signature_storage_key", decision)
        self.assertIn("if accepted", decision)
        self.assertIn("approval_basic_preferences", decision)
        self.assertIn("target_line", decision)

    def test_redraft_clears_signature_snapshot_and_detail_exposes_safe_urls(self) -> None:
        service = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        redraft = service.split("def rework_approval_document", 1)[1].split("def admin_force_approve", 1)[0]
        for column in ("signature_storage_key", "signature_file_name", "signature_content_type", "signature_size_bytes"):
            self.assertIn(f"{column} = NULL", redraft)
        schema = (ROOT / "app" / "schemas" / "directory.py").read_text(encoding="utf-8")
        self.assertIn("hasSignature", schema)
        self.assertIn("signatureUrl", schema)
        self.assertIn("previewUrl", schema)


if __name__ == "__main__":
    unittest.main()
