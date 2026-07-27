from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


class Ui039CalendarTransitionRemediationTests(unittest.TestCase):
    def test_visibility_transition_matrix_preserves_active_or_promotes_pending(self) -> None:
        from app.services.calendar_rules import subscription_action_for_visibility_change

        self.assertEqual(subscription_action_for_visibility_change("approval_required", "public"), "activate_pending")
        self.assertEqual(subscription_action_for_visibility_change("public", "approval_required"), "none")
        self.assertEqual(subscription_action_for_visibility_change("public", "private"), "cancel_open")
        self.assertEqual(subscription_action_for_visibility_change("approval_required", "private"), "cancel_open")
        self.assertEqual(subscription_action_for_visibility_change("private", "public"), "none")
        self.assertEqual(subscription_action_for_visibility_change("public", "public"), "none")

    def test_decision_uses_owner_then_calendar_then_subscription_lock_order(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        section = source[source.index("def decide_calendar_subscription"):source.index("def cancel_calendar_subscription")]
        self.assertIn("_lock_calendar_owner", section)
        self.assertIn("FROM user_calendars", section)
        self.assertIn("FROM user_calendar_subscriptions", section)
        self.assertLess(section.index("_lock_calendar_owner"), section.index("FROM user_calendars"))
        self.assertLess(section.index("FROM user_calendars"), section.index("FROM user_calendar_subscriptions"))
        self.assertNotIn("JOIN user_calendars", section)

    def test_public_transition_activates_each_pending_subscription_with_audit_and_notification(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("def _activate_pending_calendar_subscriptions", source)
        helper = source[source.index("def _activate_pending_calendar_subscriptions"):source.index("def _cancel_calendar_subscriptions")]
        for token in (
            "status='pending'", "FOR UPDATE", "status='active'", "pending", "active",
            "workspace.calendar.subscription.accepted", "_audit(", "_notify_in_transaction(",
            'subscription["subscriber_user_id"]',
        ):
            self.assertIn(token, helper)

    def test_update_applies_transition_matrix_without_downgrading_active_subscriptions(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        section = source[source.index("def update_calendar"):source.index("def reorder_calendars")]
        self.assertIn("subscription_action_for_visibility_change", section)
        self.assertIn("_activate_pending_calendar_subscriptions", section)
        self.assertIn("_cancel_calendar_subscriptions", section)
        self.assertNotIn("SET status='pending'", section)


if __name__ == "__main__":
    unittest.main()
