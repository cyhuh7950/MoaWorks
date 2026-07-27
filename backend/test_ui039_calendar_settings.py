from __future__ import annotations

from pathlib import Path
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui039CalendarSettingsTests(unittest.TestCase):
    def test_migration_041_is_additive_idempotent_and_backfills_default_calendar(self) -> None:
        sql = (ROOT / "migrations" / "041_calendar_settings.sql").read_text(encoding="utf-8")
        for token in (
            "CREATE TABLE IF NOT EXISTS user_calendars",
            "CREATE TABLE IF NOT EXISTS user_calendar_subscriptions",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_calendars_default_active",
            "LOWER(name)",
            "ADD COLUMN IF NOT EXISTS calendar_id",
            "INSERT INTO user_calendars",
            "UPDATE user_schedule_events",
            "ALTER COLUMN calendar_id SET NOT NULL",
            "REFERENCES user_calendars(id)",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("DELETE FROM USER_SCHEDULE", upper)
        self.assertNotIn("USER_SCHEDULE_ATTENDEES SET", upper)
        self.assertNotIn("USER_SCHEDULE_NOTIFICATION_DELIVERIES SET", upper)

    def test_calendar_payloads_validate_name_palette_visibility_and_versions(self) -> None:
        from app.schemas.workspace import CalendarCreatePayload, CalendarOrderPayload, CalendarUpdatePayload

        created = CalendarCreatePayload(name="  업무  ", color="#0f766e")
        self.assertEqual(created.name, "업무")
        with self.assertRaises(ValidationError):
            CalendarCreatePayload(name="   ", color="#0f766e")
        with self.assertRaises(ValidationError):
            CalendarCreatePayload(name="업무", color="#ffffff")
        with self.assertRaises(ValidationError):
            CalendarUpdatePayload(expectedVersion=-1, visibility="public")
        with self.assertRaises(ValidationError):
            CalendarUpdatePayload(expectedVersion=0)
        with self.assertRaises(ValidationError):
            CalendarOrderPayload(items=[])

    def test_calendar_rules_fix_subscription_and_full_order_contract(self) -> None:
        from app.services.calendar_rules import subscription_status_for_visibility, validate_order_snapshot

        self.assertEqual(subscription_status_for_visibility("public"), "active")
        self.assertEqual(subscription_status_for_visibility("approval_required"), "pending")
        with self.assertRaises(ValueError):
            subscription_status_for_visibility("private")
        current = [{"id": "a", "version": 1}, {"id": "b", "version": 2}]
        requested = [{"calendarId": "b", "expectedVersion": 2}, {"calendarId": "a", "expectedVersion": 1}]
        self.assertEqual(validate_order_snapshot(current, requested), ["b", "a"])
        with self.assertRaises(ValueError):
            validate_order_snapshot(current, requested[:1])
        with self.assertRaises(ValueError):
            validate_order_snapshot(current, [{"calendarId": "a", "expectedVersion": 9}, {"calendarId": "b", "expectedVersion": 2}])

    def test_routes_expose_calendar_and_subscription_contract_before_schedules(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "workspace.py").read_text(encoding="utf-8")
        for route in (
            "@router.get('/calendars')", "@router.get('/calendars/discover')", "@router.post('/calendars')",
            "@router.patch('/calendars/{calendar_id}')", "@router.put('/calendars/order')", "@router.delete('/calendars/{calendar_id}'",
            "@router.post('/calendar-subscriptions')", "@router.delete('/calendar-subscriptions/{subscription_id}'",
            "@router.post('/calendar-subscriptions/{subscription_id}/accept')", "@router.post('/calendar-subscriptions/{subscription_id}/reject')",
        ):
            self.assertIn(route, source)
        self.assertLess(source.index("@router.get('/calendars')"), source.index("@router.get('/schedules'"))
        self.assertGreaterEqual(source.count('permission_required("profile:read")'), 14)

    def test_service_enforces_owner_company_version_soft_delete_and_transactional_events(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        for token in (
            "def list_calendars", "def discover_calendars", "def create_calendar", "def update_calendar",
            "def reorder_calendars", "def delete_calendar", "def create_calendar_subscription",
            "def decide_calendar_subscription", "def cancel_calendar_subscription",
            "FOR UPDATE", "expectedVersion", "CALENDAR_VERSION_CONFLICT", "CALENDAR_DEFAULT_DELETE_FORBIDDEN",
            "status='deleted'", "user_schedule_events SET status='deleted'", "status='cancelled'",
            "workspace.calendar.created", "workspace.calendar.updated", "workspace.calendar.reordered",
            "workspace.calendar.default_changed", "workspace.calendar.deleted",
            "workspace.calendar.subscription.requested", "workspace.calendar.subscription.accepted",
            "workspace.calendar.subscription.rejected", "workspace.calendar.subscription.cancelled",
            "_notify_in_transaction", "conn.commit()",
        ):
            self.assertIn(token, source)

    def test_schedule_contract_uses_default_or_owned_calendar_and_read_only_subscriptions(self) -> None:
        schema = (ROOT / "app" / "schemas" / "workspace.py").read_text(encoding="utf-8")
        service = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("calendarId: str | None = None", schema)
        for token in ("_resolve_owned_calendar", "user_calendar_subscriptions", "subscription.status='active'", ".visibility <> 'private'", '"canEdit"', '"calendarId"', "calendar_id"):
            self.assertIn(token, service)


if __name__ == "__main__":
    unittest.main()
