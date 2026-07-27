from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui037CalendarShellContractTests(unittest.TestCase):
    def test_migration_039_creates_only_schedule_table_additively(self) -> None:
        sql = (ROOT / "migrations" / "039_calendar_shell.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS user_schedule_events", sql)
        for token in (
            "company_id TEXT NOT NULL REFERENCES companies(id)",
            "owner_user_id TEXT NOT NULL REFERENCES users(id)",
            "starts_at TIMESTAMPTZ NOT NULL",
            "ends_at TIMESTAMPTZ NOT NULL",
            "description TEXT NOT NULL DEFAULT ''",
            "status TEXT NOT NULL DEFAULT 'active'",
            "CHECK (ends_at > starts_at)",
            "CREATE INDEX IF NOT EXISTS",
            "(owner_user_id, status, starts_at)",
        ):
            self.assertIn(token, sql)
        for forbidden in ("personal_contacts", "workspace_files", "user_workspace_preferences"):
            self.assertNotIn(forbidden, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("DELETE FROM", upper)
        self.assertNotIn("UPDATE USER_SCHEDULE_EVENTS", upper)

    def test_schedule_payload_rejects_equal_or_reversed_range(self) -> None:
        from app.schemas.workspace import SchedulePayload

        start = datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)
        valid = SchedulePayload(title="회의", startsAt=start, endsAt=datetime(2026, 7, 27, 2, 0, tzinfo=timezone.utc))
        self.assertEqual(valid.title, "회의")
        for end in (start, datetime(2026, 7, 27, 0, 59, tzinfo=timezone.utc)):
            with self.subTest(end=end), self.assertRaises(ValidationError):
                SchedulePayload(title="회의", startsAt=start, endsAt=end)

    def test_list_schedules_is_owner_only_active_and_ordered(self) -> None:
        from app.schemas.directory import AuthUserSummary
        from app.services.workspace_service import WorkspaceService

        actor = AuthUserSummary(
            userId="owner_1", companyId="company_1", userName="Owner", userEmail="owner@example.com",
            roleId="role_1", roleName="User", userType="user", status="active", permissions=["profile:read"],
        )

        class Cursor:
            query = ""
            params: tuple[object, ...] = ()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, query, params):
                self.query, self.params = query, params

            @staticmethod
            def fetchall():
                return []

        class Connection:
            def __init__(self, cursor):
                self._cursor = cursor

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def cursor(self):
                return self._cursor

        cursor = Cursor()
        service = object.__new__(WorkspaceService)
        service.db = type("Db", (), {"connect": lambda _self: Connection(cursor)})()
        self.assertEqual(service.list_schedules(actor), {"items": []})
        normalized = " ".join(cursor.query.split())
        self.assertIn("owner_user_id=%s", normalized)
        self.assertIn("status='active'", normalized)
        self.assertIn("user_calendar_subscriptions", normalized)
        self.assertIn("ORDER BY starts_at", normalized)
        self.assertEqual(cursor.params, ("owner_1", "owner_1", "company_1", "owner_1"))

    def test_workspace_routes_keep_profile_permission_and_existing_crud(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "workspace.py").read_text(encoding="utf-8")
        schedule_section = source[source.index("@router.get('/schedules'"):source.index("@router.get('/contacts'")]
        for method in ("get", "post", "patch", "delete"):
            self.assertIn(f"@router.{method}", schedule_section)
        self.assertEqual(schedule_section.count('permission_required("profile:read")'), 4)


if __name__ == "__main__":
    unittest.main()
