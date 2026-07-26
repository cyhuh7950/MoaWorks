from __future__ import annotations

from datetime import date
from pathlib import Path
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui036ApprovalDelegationContractTests(unittest.TestCase):
    def test_migration_038_is_additive_and_preserves_original_approver(self) -> None:
        sql = (ROOT / "migrations" / "038_approval_delegations.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS approval_delegations", sql)
        for token in ("owner_user_id", "delegate_user_id", "start_date", "end_date", "deleted_at", "version"):
            self.assertIn(token, sql)
        self.assertIn("ADD COLUMN IF NOT EXISTS delegation_id", sql)
        self.assertNotIn("UPDATE approval_lines", sql)
        self.assertNotIn("DROP TABLE", sql.upper())
        self.assertNotIn("DELETE FROM", sql.upper())

    def test_schema_validates_period_reason_and_version(self) -> None:
        from app.schemas.directory import ApprovalDelegationCreateRequest, ApprovalDelegationUpdateRequest

        value = ApprovalDelegationCreateRequest(
            delegateUserId="user_2", startDate=date(2026, 7, 26), endDate=date(2026, 7, 27),
            reason="휴가", enabled=True,
        )
        self.assertEqual(value.reason, "휴가")
        with self.assertRaises(ValidationError):
            ApprovalDelegationCreateRequest(
                delegateUserId="user_2", startDate=date(2026, 7, 28), endDate=date(2026, 7, 27),
                reason="휴가", enabled=True,
            )
        with self.assertRaises(ValidationError):
            ApprovalDelegationUpdateRequest(
                delegateUserId="user_2", startDate=date(2026, 7, 26), endDate=date(2026, 7, 27),
                reason=" ", enabled=True, expectedVersion=0,
            )

    def test_status_is_inclusive_and_seoul_date_driven(self) -> None:
        from app.services.directory_store import DirectoryStore

        self.assertEqual(DirectoryStore._delegation_status(False, date(2026, 7, 26), date(2026, 7, 27), date(2026, 7, 26)), "disabled")
        self.assertEqual(DirectoryStore._delegation_status(True, date(2026, 7, 27), date(2026, 7, 28), date(2026, 7, 26)), "scheduled")
        self.assertEqual(DirectoryStore._delegation_status(True, date(2026, 7, 26), date(2026, 7, 27), date(2026, 7, 26)), "active")
        self.assertEqual(DirectoryStore._delegation_status(True, date(2026, 7, 25), date(2026, 7, 25), date(2026, 7, 26)), "expired")

    def test_static_routes_precede_document_route_and_keep_permissions(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        self.assertLess(source.index('@router.get("/settings/delegations"'), source.index('@router.get("/{document_id}"'))
        for method in ("get", "post", "patch", "delete"):
            self.assertIn(f"@router.{method}", source)
        section = source[source.index('@router.get("/settings/delegations"'):source.index('@router.get("/settings/signature"')]
        self.assertIn('permission_required("approval:read")', section)
        self.assertGreaterEqual(section.count('permission_required("approval:create")'), 3)
        for code in ("APPROVAL_DELEGATION_STALE", "APPROVAL_DELEGATION_OVERLAP", "APPROVAL_DELEGATE_INVALID", "APPROVAL_DELEGATION_PERIOD_INVALID"):
            self.assertIn(code, source)

    def test_crud_locks_owner_validates_delegate_overlap_and_soft_delete(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        block = source.split("def _lock_delegation_owner", 1)[1].split("def get_approval_line_signature", 1)[0]
        self.assertIn("FOR UPDATE", block)
        self.assertIn("u.company_id", block)
        self.assertIn("u.status = 'active'", block)
        self.assertIn("owner_user_id <> delegate_user_id", (ROOT / "migrations" / "038_approval_delegations.sql").read_text(encoding="utf-8"))
        self.assertIn("NOT (end_date < %s OR start_date > %s)", block)
        self.assertIn("deleted_at = %s", block)
        self.assertIn("expected_version", block)
        self.assertIn("approval.delegation.created", block)
        self.assertIn("approval.delegation.updated", block)
        self.assertIn("approval.delegation.deleted", block)

    def test_runtime_visibility_supports_active_and_historical_actor(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        visible = source.split("def _fetch_visible_approval_rows", 1)[1].split("def _assert_approval_visible", 1)[0]
        assertion = source.split("def _assert_approval_visible", 1)[1].split("def _to_approval_document_response", 1)[0]
        for block in (visible, assertion):
            self.assertIn("decided_by_user_id", block)
            self.assertIn("approval_delegations", block)
            self.assertIn("deleted_at IS NULL", block)
            self.assertIn("Asia/Seoul", block)

    def test_delegate_decision_preserves_owner_actor_delegation_and_signature(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        decision = source.split("def _process_approval_decision", 1)[1].split("def _fetch_user_view_row", 1)[0]
        self.assertIn("approval_delegations", decision)
        self.assertIn("FOR SHARE", decision)
        self.assertIn("delegation_id = %s", decision)
        self.assertIn('event_name = "approval.delegated_approved"', decision)
        self.assertIn('event_name = "approval.delegated_rejected"', decision)
        self.assertIn("approval_basic_preferences", decision)
        self.assertIn("actor.userId", decision)

    def test_redraft_clears_delegation_snapshot_and_schema_exposes_it(self) -> None:
        service = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        redraft = service.split("def rework_approval_document", 1)[1].split("def admin_force_approve", 1)[0]
        self.assertIn("delegation_id = NULL", redraft)
        schema = (ROOT / "app" / "schemas" / "directory.py").read_text(encoding="utf-8")
        self.assertIn("delegationId", schema)
        self.assertIn("decidedByUserName", schema)
        self.assertIn("decided.name AS decided_by_user_name", service)

    def test_overlap_helper_uses_inclusive_parameterized_ranges(self) -> None:
        from app.schemas.directory import AuthUserSummary
        from app.services.directory_store import ApprovalDelegationOverlapError, DirectoryStore

        class Cursor:
            def __init__(self) -> None:
                self.query = ""
                self.params = ()

            def execute(self, query, params) -> None:
                self.query, self.params = query, params

            @staticmethod
            def fetchone():
                return {"exists": 1}

        actor = AuthUserSummary(
            userId="owner", companyId="company", userName="Owner", userEmail="owner@example.com",
            roleId="role", roleName="User", userType="user", status="active", permissions=[],
        )
        cursor = Cursor()
        with self.assertRaises(ApprovalDelegationOverlapError):
            DirectoryStore._assert_no_delegation_overlap(
                cursor, actor, date(2026, 7, 26), date(2026, 7, 27), exclude_id="delegation_1",
            )
        self.assertIn("NOT (end_date < %s OR start_date > %s)", cursor.query)
        self.assertIn("id <> %s", cursor.query)
        self.assertEqual(cursor.params, ("company", "owner", date(2026, 7, 26), date(2026, 7, 27), "delegation_1"))

    def test_route_error_mapping_preserves_stale_overlap_and_invalid_codes(self) -> None:
        from fastapi import HTTPException
        from app.api.routes.approvals import _raise_delegation_error
        from app.services.directory_store import (
            ApprovalDelegateInvalidError, ApprovalDelegationConflictError,
            ApprovalDelegationNotFoundError, ApprovalDelegationOverlapError, ApprovalDelegationPeriodError,
        )

        cases = (
            (ApprovalDelegationConflictError("stale"), 409, "APPROVAL_DELEGATION_STALE"),
            (ApprovalDelegationOverlapError("overlap"), 409, "APPROVAL_DELEGATION_OVERLAP"),
            (ApprovalDelegateInvalidError("invalid"), 400, "APPROVAL_DELEGATE_INVALID"),
            (ApprovalDelegationPeriodError("period"), 400, "APPROVAL_DELEGATION_PERIOD_INVALID"),
            (ApprovalDelegationNotFoundError("missing"), 404, "APPROVAL_DELEGATION_NOT_FOUND"),
        )
        for error, status, code in cases:
            with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                _raise_delegation_error(error)
            self.assertEqual(raised.exception.status_code, status)
            self.assertEqual(raised.exception.detail["code"], code)


if __name__ == "__main__":
    unittest.main()
