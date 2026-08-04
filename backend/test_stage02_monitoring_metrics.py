from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

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


class Stage02MonitoringMetricsTest(unittest.TestCase):
    def test_approval_backlog_counts_current_submitted_documents(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-stage02-") as temp_dir:
            state_file = Path(temp_dir) / "observability-state.json"
            service = ObservabilityService(state_file=state_file, db_service=_Database())
            service._use_file_backend = False

            overview = service.get_monitoring_overview()

        self.assertEqual(overview.approvalBacklogCount, 1)


if __name__ == "__main__":
    unittest.main()
