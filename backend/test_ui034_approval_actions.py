from __future__ import annotations

from pathlib import Path
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui034ApprovalActionContractTests(unittest.TestCase):
    def test_reason_schema_and_service_trim_contract(self) -> None:
        from app.schemas.directory import ApprovalLineActionRequest

        self.assertEqual(ApprovalLineActionRequest(reason="처리 의견").reason, "처리 의견")
        with self.assertRaises(ValidationError):
            ApprovalLineActionRequest(reason="")
        with self.assertRaises(ValidationError):
            ApprovalLineActionRequest(reason="가" * 501)

        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        decision = source.split("def _process_approval_decision", 1)[1].split("def _fetch_company_row", 1)[0]
        self.assertIn("normalized_reason = reason.strip()", decision)
        self.assertIn("if not normalized_reason:", decision)
        self.assertIn("reason=normalized_reason", decision)
        self.assertIn("comment = %s", decision)

    def test_action_routes_keep_existing_permission_boundaries(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        contracts = {
            'post("/{document_id}/submit"': 'permission_required("approval:submit")',
            'post("/{document_id}/approve"': 'permission_required("approval:act")',
            'post("/{document_id}/reject"': 'permission_required("approval:act")',
            'post("/{document_id}/withdraw"': 'permission_required("approval:withdraw")',
            'post("/{document_id}/redraft"': 'permission_required("approval:rework")',
        }
        for route, permission in contracts.items():
            with self.subTest(route=route):
                marker = f"@router.{route}"
                self.assertIn(marker, source)
                block = source[source.index(marker):]
                next_route = block.find("\n\n@", 1)
                if next_route >= 0:
                    block = block[:next_route]
                self.assertIn(permission, block)

    def test_submit_withdraw_redraft_lock_creator_status_and_audit(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        submit = source.split("def submit_approval_document", 1)[1].split("def approve_approval_document", 1)[0]
        withdraw = source.split("def withdraw_approval_document", 1)[1].split("def rework_approval_document", 1)[0]
        redraft = source.split("def rework_approval_document", 1)[1].split("def admin_force_approve", 1)[0]

        for block, allowed, event in (
            (submit, '{"draft"}', "approval.submitted"),
            (withdraw, '{"submitted"}', "approval.withdrawn"),
            (redraft, '{"rejected", "withdrawn"}', "approval.redrafted"),
        ):
            self.assertIn("for_update=True", block)
            self.assertIn("_assert_creator", block)
            self.assertIn(f"allowed={allowed}", block)
            self.assertIn(event, block)
            self.assertIn("connection.commit()", block)
        self.assertIn("if not lines:", submit)
        self.assertIn("SET status = 'pending'", redraft)
        self.assertIn("comment = NULL", redraft)
        self.assertIn("decided_at = NULL", redraft)

    def test_approve_reject_lock_current_approver_and_preserve_audit(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        decision = source.split("def _process_approval_decision", 1)[1].split("def _fetch_company_row", 1)[0]
        self.assertGreaterEqual(decision.count("for_update=True"), 2)
        self.assertIn('allowed={"submitted"}', decision)
        self.assertIn('target_line["approver_user_id"] != actor.userId', decision)
        self.assertIn('event_name = "approval.approved"', decision)
        self.assertIn('event_name = "approval.rejected"', decision)
        self.assertIn("remaining_pending", decision)
        self.assertIn('next_status = "approved" if not remaining_pending else "submitted"', decision)
        self.assertIn("_insert_audit", decision)
        self.assertIn("connection.commit()", decision)

    def test_action_methods_still_emit_post_commit_notifications(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        submit = source.split("def submit_approval_document", 1)[1].split("def approve_approval_document", 1)[0]
        withdraw = source.split("def withdraw_approval_document", 1)[1].split("def rework_approval_document", 1)[0]
        redraft = source.split("def rework_approval_document", 1)[1].split("def admin_force_approve", 1)[0]
        decision = source.split("def _process_approval_decision", 1)[1].split("def _fetch_company_row", 1)[0]
        self.assertIn("self._emit_approval_event", submit)
        self.assertIn("self._emit_approval_event", withdraw)
        self.assertIn("self._emit_approval_event", redraft)
        self.assertIn("self._emit_approval_status_event", decision)


if __name__ == "__main__":
    unittest.main()
