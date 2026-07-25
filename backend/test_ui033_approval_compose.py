from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import tempfile
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui033ApprovalComposeContractTests(unittest.TestCase):
    def test_additive_upload_staging_migration_contract(self) -> None:
        migration = ROOT / "migrations" / "036_approval_attachment_uploads.sql"
        self.assertTrue(migration.is_file(), "migration 036 must exist")
        source = migration.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists approval_attachment_uploads", source)
        self.assertIn("company_id", source)
        self.assertIn("owner_user_id", source)
        self.assertIn("storage_key", source)
        self.assertIn("expires_at", source)
        self.assertIn("check (size_bytes > 0)", source)
        self.assertIn("create index if not exists", source)
        self.assertNotIn("update approval_documents", source)
        self.assertNotIn("delete from approval_documents", source)

    def test_upload_response_allowlist_and_request_validation(self) -> None:
        from app.schemas.directory import (
            ApprovalAttachmentMeta,
            ApprovalAttachmentUploadResponse,
            ApprovalDocumentCreateRequest,
            ApprovalDocumentUpdateRequest,
        )

        response = ApprovalAttachmentUploadResponse(
            uploadId="a" * 32,
            fileName="plan.txt",
            contentType="text/plain",
            sizeBytes=5,
            storageKey="must-not-leak",
            ownerUserId="must-not-leak",
        )
        self.assertEqual(
            response.model_dump(),
            {
                "uploadId": "a" * 32,
                "fileName": "plan.txt",
                "contentType": "text/plain",
                "sizeBytes": 5,
            },
        )

        upload = ApprovalAttachmentMeta(
            uploadId="a" * 32,
            fileName="plan.txt",
            contentType="text/plain",
            sizeBytes=5,
        )
        draft = ApprovalDocumentCreateRequest(
            title="draft",
            content="body",
            approverUserIds=[],
            attachments=[upload],
        )
        self.assertEqual(draft.approverUserIds, [])
        self.assertEqual(len(draft.attachments), 1)

        with self.assertRaises(ValidationError):
            ApprovalDocumentCreateRequest(
                title="draft",
                content="body",
                approverUserIds=["u1", "u1"],
            )
        with self.assertRaises(ValidationError):
            ApprovalDocumentCreateRequest(title=" ", content="body")
        with self.assertRaises(ValidationError):
            ApprovalDocumentCreateRequest(title="draft", content=" ")
        with self.assertRaises(ValidationError):
            ApprovalDocumentUpdateRequest(
                title="draft",
                content="body",
                approverUserIds=[],
                retainedAttachmentIds=["att-1", "att-1"],
            )

    def test_approval_storage_stages_safe_bounded_files(self) -> None:
        from app.services.approval_attachment_storage import ApprovalAttachmentStorage

        with tempfile.TemporaryDirectory() as directory:
            storage = ApprovalAttachmentStorage(Path(directory), max_file_bytes=5)
            staged = storage.stage("..\\unsafe\r\nname.txt", "text/plain", b"hello")
            self.assertEqual(staged["file_name"], "name.txt")
            self.assertEqual(staged["size_bytes"], 5)
            self.assertRegex(staged["upload_id"], r"^[0-9a-f]{32}$")
            self.assertRegex(staged["storage_key"], r"^approval/attachments/[0-9a-f]{32}\.bin$")
            self.assertTrue(storage.stored_path(staged["storage_key"]).is_file())
            storage.delete(staged["storage_key"])
            self.assertFalse((Path(directory) / staged["storage_key"]).exists())

            with self.assertRaises(ValueError):
                storage.stage("empty.txt", "text/plain", b"")
            with self.assertRaises(ValueError):
                storage.stage("large.txt", "text/plain", b"123456")
            with self.assertRaises(ValueError):
                storage.delete("../secret")

    def test_upload_route_is_static_permissioned_and_reads_only_limit_plus_one(self) -> None:
        route = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        upload_marker = '@router.post("/attachments", response_model=ApprovalAttachmentUploadResponse)'
        detail_marker = '@router.get("/{document_id}",'
        self.assertIn(upload_marker, route)
        self.assertLess(route.index(upload_marker), route.index(detail_marker))
        block = route[route.index(upload_marker):route.index(detail_marker)]
        self.assertIn('permission_required("approval:create")', block)
        self.assertIn("await file.read(APPROVAL_ATTACHMENT_MAX_FILE_BYTES + 1)", block)
        self.assertIn("stage_approval_attachment", block)

    def test_store_revalidates_upload_and_approver_boundaries_in_transactions(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        create = source.split("def create_approval_document", 1)[1].split("def update_approval_document", 1)[0]
        update = source.split("def update_approval_document", 1)[1].split("def submit_approval_document", 1)[0]

        for block in (create, update):
            self.assertIn("_validate_approval_approvers", block)
            self.assertIn("_consume_approval_uploads", block)
            self.assertIn("connection.commit()", block)
        self.assertIn("for_update=True", update)
        self.assertIn("_assert_creator", update)
        self.assertIn('"draft"', update)
        self.assertIn("approval.updated", update)
        self.assertIn("DELETE FROM approval_lines", update)
        self.assertIn("DELETE FROM approval_attachments", update)

        consume = source.split("def _consume_approval_uploads", 1)[1].split("def _validate_approval_approvers", 1)[0]
        self.assertIn("FOR UPDATE", consume)
        self.assertIn("owner_user_id = %s", consume)
        self.assertIn("company_id = %s", consume)
        self.assertIn("expires_at > %s", consume)
        self.assertIn("DELETE FROM approval_attachment_uploads", consume)

        approvers = source.split("def _validate_approval_approvers", 1)[1].split("def _consume_approval_uploads", 1)[0]
        self.assertIn("u.company_id = %s", approvers)
        self.assertIn("u.status = 'active'", approvers)
        self.assertIn("r.status = 'active'", approvers)

    def test_submit_still_requires_at_least_one_approver(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        block = source.split("def submit_approval_document", 1)[1].split("def approve_approval_document", 1)[0]
        self.assertIn("if not lines:", block)
        self.assertIn("최소 1명", block)


if __name__ == "__main__":
    unittest.main()
