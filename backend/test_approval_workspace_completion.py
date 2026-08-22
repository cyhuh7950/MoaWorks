from __future__ import annotations

from pathlib import Path
import re
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class ApprovalWorkspaceCompletionTests(unittest.TestCase):
    def test_additive_migration_defines_audiences_and_actor_scoped_deletion(self) -> None:
        source = (ROOT / "migrations" / "058_approval_workspace_completion.sql").read_text(encoding="utf-8").lower()
        self.assertIn("add column if not exists urgent boolean", source)
        self.assertIn("add column if not exists creator_department_id text", source)
        self.assertIn("create table if not exists approval_document_audiences", source)
        self.assertIn("audience_type in ('reference', 'viewer')", source)
        self.assertIn("read_at timestamptz", source)
        self.assertIn("create table if not exists approval_document_deletions", source)
        self.assertIn("permanently_deleted_at timestamptz", source)
        self.assertNotIn("delete from approval_documents", source)

    def test_requests_validate_unique_disjoint_audiences(self) -> None:
        from app.schemas.directory import ApprovalDocumentCreateRequest

        payload = ApprovalDocumentCreateRequest(
            title="장비 구매",
            content="본문",
            urgent=True,
            approverUserIds=["approver"],
            referenceUserIds=["reference"],
            viewerUserIds=["viewer"],
            shareWithDepartment=True,
        )
        self.assertTrue(payload.urgent)
        self.assertTrue(payload.shareWithDepartment)

        for kwargs in (
            {"referenceUserIds": ["u", "u"]},
            {"viewerUserIds": ["u", "u"]},
            {"approverUserIds": ["u"], "referenceUserIds": ["u"]},
            {"referenceUserIds": ["u"], "viewerUserIds": ["u"]},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                ApprovalDocumentCreateRequest(title="제목", content="본문", **kwargs)

    def test_response_exposes_actor_view_without_storage_or_secret_fields(self) -> None:
        from app.schemas.directory import ApprovalDocumentResponse

        fields = set(ApprovalDocumentResponse.model_fields)
        for name in {
            "urgent", "creatorDepartmentId", "creatorDepartmentName", "referenceUserIds",
            "viewerUserIds", "currentUserAudienceType", "currentUserReadAt",
            "sharedWithDepartment", "deletedForCurrentUser", "permanentlyDeletedForCurrentUser",
        }:
            self.assertIn(name, fields)
        self.assertNotIn("storageKey", fields)

    def test_routes_expose_read_and_trash_lifecycle_with_permission_guards(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        for method, route in (
            ("post", "/{document_id}/read"),
            ("delete", "/{document_id}"),
            ("post", "/{document_id}/restore"),
            ("delete", "/{document_id}/permanent"),
        ):
            self.assertRegex(
                source,
                rf'@router\.{method}\("{re.escape(route)}"(?:,|\))',
            )
        self.assertGreaterEqual(source.count('permission_required("approval:read")'), 4)

    def test_visibility_contract_includes_audience_department_and_actor_deletion(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        visible = source.split("def _fetch_visible_approval_rows", 1)[1].split("def _assert_approval_visible", 1)[0]
        guard = source.split("def _assert_approval_visible", 1)[1].split("def _can_actor_process_current_line", 1)[0]
        for token in ("approval_document_audiences", "creator_department_id", "approval_document_deletions"):
            self.assertIn(token, visible)
            self.assertIn(token, guard)
        for method in (
            "mark_approval_document_read", "delete_approval_document_for_actor",
            "restore_approval_document_for_actor", "permanently_delete_approval_document_for_actor",
        ):
            self.assertIn(f"def {method}", source)


if __name__ == "__main__":
    unittest.main()
