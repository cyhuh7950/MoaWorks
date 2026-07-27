from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


class Ui039CalendarSettingsRemediationTests(unittest.TestCase):
    def test_new_user_transaction_provisions_one_default_calendar(self) -> None:
        source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        create_user = source[source.index("def create_user"):source.index("def update_user")]
        self.assertIn("INSERT INTO user_calendars", create_user)
        self.assertIn("'내 일정'", create_user)
        self.assertIn("is_default", create_user)
        self.assertLess(create_user.index("INSERT INTO users"), create_user.index("INSERT INTO user_calendars"))
        self.assertLess(create_user.index("INSERT INTO user_calendars"), create_user.index("connection.commit()"))

    def test_lazy_default_repair_locks_user_and_is_idempotent(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("def _ensure_default_calendar", source)
        helper = source[source.index("def _ensure_default_calendar"):source.index("def _calendar_rows")]
        self.assertIn("FROM users", helper)
        self.assertIn("FOR UPDATE", helper)
        self.assertIn("WHERE owner_user_id=%s AND status='active' AND is_default=TRUE", helper)
        self.assertIn("ON CONFLICT DO NOTHING", helper)
        list_section = source[source.index("def list_calendars"):source.index("def discover_calendars")]
        resolve_section = source[source.index("def _resolve_owned_calendar"):source.index("def create_schedule")]
        self.assertIn("_ensure_default_calendar", list_section)
        self.assertIn("_ensure_default_calendar", resolve_section)

    def test_owner_incoming_contains_pending_and_active(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        list_section = source[source.index("def list_calendars"):source.index("def discover_calendars")]
        self.assertGreaterEqual(list_section.count("sub.status IN ('pending','active')"), 2)

    def test_forced_subscription_cancellation_is_per_row_audited_and_notified(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("def _cancel_calendar_subscriptions", source)
        helper = source[source.index("def _cancel_calendar_subscriptions"):source.index("def create_calendar")]
        for token in (
            "FOR UPDATE", "workspace.calendar.subscription.cancelled", "_audit(",
            "_notify_in_transaction(", 'subscription["subscriber_user_id"]',
        ):
            self.assertIn(token, helper)
        update = source[source.index("def update_calendar"):source.index("def reorder_calendars")]
        delete = source[source.index("def delete_calendar"):source.index("def create_calendar_subscription")]
        self.assertIn("_cancel_calendar_subscriptions", update)
        self.assertIn("_cancel_calendar_subscriptions", delete)

    def test_all_owned_calendar_mutations_use_same_user_lock_first(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("def _lock_calendar_owner", source)
        for method, next_method in (
            ("create_calendar", "update_calendar"),
            ("update_calendar", "reorder_calendars"),
            ("reorder_calendars", "delete_calendar"),
            ("delete_calendar", "create_calendar_subscription"),
        ):
            section = source[source.index(f"def {method}"):source.index(f"def {next_method}")]
            self.assertIn("_lock_calendar_owner", section, method)
            if "user_calendars" in section:
                self.assertLess(section.index("_lock_calendar_owner"), section.index("user_calendars"), method)


if __name__ == "__main__":
    unittest.main()
