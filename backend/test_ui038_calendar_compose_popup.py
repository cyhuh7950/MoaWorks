from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui038CalendarComposeContractTests(unittest.TestCase):
    def test_migration_040_extends_schedule_and_adds_attendee_delivery_tables(self) -> None:
        sql = (ROOT / "migrations" / "040_calendar_compose_popup.sql").read_text(encoding="utf-8")
        for token in (
            "ADD COLUMN IF NOT EXISTS location",
            "ADD COLUMN IF NOT EXISTS repeat_type",
            "ADD COLUMN IF NOT EXISTS repeat_until",
            "ADD COLUMN IF NOT EXISTS alert_minutes",
            "ADD COLUMN IF NOT EXISTS timezone",
            "CREATE TABLE IF NOT EXISTS user_schedule_attendees",
            "CREATE TABLE IF NOT EXISTS user_schedule_notification_deliveries",
            "UNIQUE (schedule_id, occurrence_at, alert_minutes, recipient_user_id)",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("DELETE FROM", upper)

    def test_payload_defaults_preserve_existing_clients(self) -> None:
        from app.schemas.workspace import SchedulePayload

        payload = SchedulePayload(
            title="기존 일정",
            startsAt=datetime(2026, 7, 27, 1, tzinfo=UTC),
            endsAt=datetime(2026, 7, 27, 2, tzinfo=UTC),
        )
        self.assertEqual(payload.location, "")
        self.assertEqual(payload.attendeeUserIds, [])
        self.assertEqual(payload.repeatType, "none")
        self.assertIsNone(payload.repeatUntil)
        self.assertEqual(payload.alertMinutes, [])
        self.assertEqual(payload.timezone, "Asia/Seoul")

    def test_payload_rejects_timezone_attendees_alerts_and_repeat_period(self) -> None:
        from app.schemas.workspace import SchedulePayload

        base = {
            "title": "확장 일정",
            "startsAt": datetime(2026, 7, 27, 1, tzinfo=UTC),
            "endsAt": datetime(2026, 7, 27, 2, tzinfo=UTC),
        }
        invalid = (
            {"timezone": "Mars/Olympus"},
            {"attendeeUserIds": ["same", "same"]},
            {"attendeeUserIds": [f"user_{index}" for index in range(51)]},
            {"alertMinutes": [5]},
            {"alertMinutes": [10, 10]},
            {"alertMinutes": [0, 10, 30, 60]},
            {"repeatType": "weekly"},
            {"repeatType": "daily", "repeatUntil": date(2026, 7, 26)},
        )
        for addition in invalid:
            with self.subTest(addition=addition), self.assertRaises(ValidationError):
                SchedulePayload(**base, **addition)

    def test_occurrences_cover_none_daily_weekly_monthly_and_month_end(self) -> None:
        from app.services.schedule_notification_service import schedule_occurrences

        start = datetime(2026, 1, 31, 1, 30, tzinfo=UTC)
        end = datetime(2026, 5, 2, tzinfo=UTC)
        self.assertEqual(schedule_occurrences(start, "none", None, start, end), [start])
        self.assertEqual(len(schedule_occurrences(start, "daily", date(2026, 2, 2), start, end)), 3)
        self.assertEqual(len(schedule_occurrences(start, "weekly", date(2026, 2, 14), start, end)), 3)
        monthly = schedule_occurrences(start, "monthly", date(2026, 4, 30), start, end)
        self.assertEqual([item.day for item in monthly], [31, 28, 31, 30])

    def test_workspace_service_validates_company_active_attendees_in_transaction(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        for token in (
            "_validate_schedule_attendees",
            "company_id=%s",
            "status='active'",
            "user_schedule_attendees",
            "workspace.schedule.created",
            "workspace.schedule.updated",
            "conn.commit()",
        ):
            self.assertIn(token, source)
        self.assertIn("WHERE a.schedule_id = ANY(%s)", source)

    def test_notification_worker_uses_permanent_dedup_and_existing_center(self) -> None:
        source = (ROOT / "app" / "services" / "schedule_notification_service.py").read_text(encoding="utf-8")
        self.assertIn("ON CONFLICT (schedule_id, occurrence_at, alert_minutes, recipient_user_id)", source)
        self.assertIn("status = 'failed'", source)
        self.assertIn("ObservabilityService", source)
        self.assertIn("MonitoringCategory.SCHEDULE", source)
        self.assertIn("targets=[recipient_user_id]", source)
        self.assertIn("s.status = 'active'", source)

    def test_main_lifespan_runs_schedule_notification_loop(self) -> None:
        source = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
        self.assertIn("schedule_notification_loop", source)
        self.assertIn("ScheduleNotificationService().dispatch_due_notifications", source)
        self.assertIn("schedule_notification_interval_seconds", source)


if __name__ == "__main__":
    unittest.main()
