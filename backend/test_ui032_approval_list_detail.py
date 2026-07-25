from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent


class Ui032ApprovalBackendContractTests(unittest.TestCase):
    def test_additive_attachment_migration_contract(self) -> None:
        migration = ROOT / "migrations" / "035_approval_attachments.sql"
        self.assertTrue(migration.is_file(), "migration 035 must exist")
        source = migration.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists approval_attachments", source)
        self.assertIn("references approval_documents(id) on delete cascade", source)
        self.assertIn("check (size_bytes >= 0)", source)
        self.assertIn("storage_key", source)
        self.assertIn("unique", source)
        self.assertIn("create index if not exists", source)
        self.assertNotIn("update approval_documents", source)
        self.assertNotIn("delete from approval_documents", source)

    def test_detail_schema_has_allowlisted_attachments_without_expanding_list_item(self) -> None:
        from app.schemas.directory import (
            ApprovalAttachmentView,
            ApprovalDocumentDetailResponse,
            ApprovalDocumentResponse,
        )

        attachment_fields = set(ApprovalAttachmentView.model_fields)
        self.assertEqual(
            attachment_fields,
            {"attachmentId", "fileName", "contentType", "sizeBytes", "createdAt", "previewUrl"},
        )
        self.assertIn("attachments", ApprovalDocumentDetailResponse.model_fields)
        self.assertNotIn("attachments", ApprovalDocumentResponse.model_fields)

    def test_approval_attachment_storage_accepts_only_approval_key_below_root(self) -> None:
        from app.services.approval_attachment_storage import ApprovalAttachmentStorage

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data_root = root / "approval" / "attachments"
            data_root.mkdir(parents=True)
            attachment_id = "a" * 32
            expected = data_root / f"{attachment_id}.bin"
            expected.write_bytes(b"ui032")
            storage = ApprovalAttachmentStorage(root)
            self.assertEqual(
                storage.stored_path(f"approval/attachments/{attachment_id}.bin"),
                expected.resolve(),
            )
            for unsafe in (
                "../secret",
                f"mail/uploads/{attachment_id}.bin",
                "C:/secret.bin",
                f"approval/attachments/../{attachment_id}.bin",
            ):
                with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                    storage.stored_path(unsafe)

    def test_detail_mapping_fetches_attachments_only_for_selected_document(self) -> None:
        store_source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        list_block = store_source.split("def list_approval_documents", 1)[1].split("def get_audit_logs", 1)[0]
        detail_block = store_source.split("def get_approval_document", 1)[1].split("def create_approval_document", 1)[0]
        self.assertNotIn("approval_attachments", list_block)
        self.assertIn("_to_approval_document_detail_response", detail_block)
        self.assertIn("_fetch_approval_attachments", store_source)

    def test_download_route_requires_read_and_binds_document_and_attachment(self) -> None:
        route_source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        store_source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        self.assertIn('@router.get("/{document_id}/attachments/{attachment_id}")', route_source)
        self.assertIn('permission_required("approval:read")', route_source)
        self.assertIn("document_id = %s AND id = %s", store_source)
        self.assertIn("(document_id, attachment_id)", store_source)
        self.assertIn("self._assert_approval_visible", store_source)

    def test_cross_company_visibility_is_rejected_before_admin_bypass(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        block = source.split("def _assert_approval_visible", 1)[1].split("def _to_approval_document_response", 1)[0]
        company_guard = block.find('document["company_id"] != actor.companyId')
        admin_guard = block.find("self._can_view_all_approvals(actor)")
        self.assertGreaterEqual(company_guard, 0)
        self.assertGreater(admin_guard, company_guard)


if __name__ == "__main__":
    unittest.main()
