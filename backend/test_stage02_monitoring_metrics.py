from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from app.schemas.notification_center import NotificationPreferences
from app.services.notification_center_service import NotificationCenterService
from app.services.observability_service import ObservabilityService


class _Cursor:
    def __init__(self) -> None:
        self._rows: list[dict] = []

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, _params: tuple | None = None) -> None:
        normalized = " ".join(query.split()).lower()
        if "from monitoring_events" in normalized:
            now = datetime.now(UTC)
            self._rows = [
                {
                    "event_type": "approval.submit",
                    "category": "approval",
                    "severity": "info",
                    "resource_type": "approvalDocument",
                    "resource_id": "doc-completed",
                    "occurred_at": now,
                    "payload": {},
                    "resolved": False,
                },
                {
                    "event_type": "approval.status.changed",
                    "category": "approval",
                    "severity": "info",
                    "resource_type": "approvalDocument",
                    "resource_id": "doc-approved",
                    "occurred_at": now,
                    "payload": {},
                    "resolved": False,
                },
                *[
                    {
                        "event_type": "mail.relay.test.result",
                        "category": "mail",
                        "severity": "info",
                        "resource_type": "mailProvider",
                        "resource_id": f"provider-success-{index}",
                        "occurred_at": now,
                        "payload": {},
                        "resolved": False,
                    }
                    for index in range(3)
                ],
                {
                    "event_type": "mail.relay.fail",
                    "category": "mail",
                    "severity": "error",
                    "resource_type": "mailProvider",
                    "resource_id": "provider-fail",
                    "occurred_at": now,
                    "payload": {},
                    "resolved": False,
                },
            ]
            return
        if "from approval_documents" in normalized:
            self._rows = [{"count": 1}]
            return
        raise AssertionError(f"unexpected query: {normalized}")

    def fetchall(self) -> list[dict]:
        return self._rows

    def fetchone(self) -> dict | None:
        return self._rows[0] if self._rows else None


class _Connection:
    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return _Cursor()


class _Database:
    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> _Connection:
        return _Connection()


class _PreferencesCursor:
    def __init__(self, database: "_PreferencesDatabase") -> None:
        self.database = database
        self._row: dict | None = None

    def __enter__(self) -> "_PreferencesCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, params: tuple | None = None) -> None:
        normalized = " ".join(query.split()).lower()
        if normalized.startswith("select * from notification_preferences"):
            self._row = dict(self.database.row)
            return
        if normalized.startswith("insert into notification_preferences"):
            self.database.saved_params = params
            return
        if normalized.startswith("insert into notification_action_audit"):
            return
        raise AssertionError(f"unexpected query: {normalized}")

    def fetchone(self) -> dict | None:
        return self._row


class _PreferencesConnection:
    def __init__(self, database: "_PreferencesDatabase") -> None:
        self.database = database

    def __enter__(self) -> "_PreferencesConnection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> _PreferencesCursor:
        return _PreferencesCursor(self.database)

    def commit(self) -> None:
        return None


class _PreferencesDatabase:
    def __init__(self) -> None:
        self.row = {
            "enabled": False,
            "quiet_hours_enabled": True,
            "quiet_hours_start": "23:00",
            "quiet_hours_end": "06:00",
            "categories": {"mail": {"enabled": False, "importantOnly": True}},
            "updated_at": datetime.now(UTC),
        }
        self.saved_params: tuple | None = None

    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> _PreferencesConnection:
        return _PreferencesConnection(self)


class Stage02MonitoringMetricsTest(unittest.TestCase):
    def test_approval_backlog_counts_current_submitted_documents(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-stage02-") as temp_dir:
            state_file = Path(temp_dir) / "observability-state.json"
            service = ObservabilityService(state_file=state_file, db_service=_Database())
            service._use_file_backend = False

            overview = service.get_monitoring_overview()

        self.assertEqual(overview.approvalBacklogCount, 1)

    def test_mail_failure_rate_is_percentage_of_mail_events(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-stage02-") as temp_dir:
            state_file = Path(temp_dir) / "observability-state.json"
            service = ObservabilityService(state_file=state_file, db_service=_Database())
            service._use_file_backend = False

            overview = service.get_monitoring_overview()

        self.assertEqual(overview.mailFailureRate24h, 25.0)

    def test_partial_notification_put_preserves_unsent_preferences(self) -> None:
        database = _PreferencesDatabase()
        service = NotificationCenterService(db_service=database)

        saved = service.save_preferences(
            user_id="user-1",
            preferences=NotificationPreferences(enabled=True),
        )

        self.assertTrue(saved.enabled)
        self.assertTrue(saved.quietHoursEnabled)
        self.assertEqual(saved.quietHoursStart, "23:00")
        self.assertEqual(saved.quietHoursEnd, "06:00")
        self.assertFalse(saved.categories["mail"].enabled)
        self.assertTrue(saved.categories["mail"].importantOnly)


if __name__ == "__main__":
    unittest.main()
