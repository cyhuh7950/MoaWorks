from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
import re
import unittest

from app.services.content_operations_service import ContentOperationsService


ROOT = Path(__file__).resolve().parent
MIGRATION = ROOT / "migrations" / "046_help_policy_documents_compatibility.sql"
CORE_FIELDS = ("id", "code", "title", "category", "audience", "content", "status", "version", "published_at", "updated_at")


def previous_schema_fixture() -> list[dict]:
    now = datetime(2026, 8, 1, tzinfo=UTC)
    return [
        {
            "id": f"help_{index}",
            "code": f"POLICY-{index}",
            "title": f"운영 정책 {index}",
            "category": "operations",
            "audience": "all",
            "content": f"기존 운영 내용 {index}",
            "status": "published" if index % 2 else "draft",
            "version": index,
            "published_at": now - timedelta(days=index) if index % 2 else None,
            "updated_at": now - timedelta(hours=index),
        }
        for index in range(1, 7)
    ]


def compatible_fixture(rows: list[dict]) -> list[dict]:
    migrated = deepcopy(rows)
    for row in migrated:
        row["is_system"] = False
        row["created_at"] = row["updated_at"]
    return migrated


class _FixtureCursor:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.executed: list[tuple[str, list]] = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), list(params)))

    def fetchall(self):
        return deepcopy(self.rows)


class _FixtureConnection:
    def __init__(self, rows: list[dict]) -> None:
        self.cursor_value = _FixtureCursor(rows)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self):
        return self.cursor_value


class _FixtureDb:
    def __init__(self, rows: list[dict]) -> None:
        self.connection = _FixtureConnection(rows)

    def connect(self):
        return self.connection


class AdminContentSchemaCompatibilityTest(unittest.TestCase):
    def test_forward_migration_is_idempotent_ordered_and_non_destructive(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        normalized = " ".join(sql.split())
        upper = normalized.upper()

        required_in_order = [
            "ADD COLUMN IF NOT EXISTS is_system BOOLEAN",
            "UPDATE help_policy_documents SET is_system = FALSE WHERE is_system IS NULL",
            "ALTER COLUMN is_system SET DEFAULT FALSE",
            "ALTER COLUMN is_system SET NOT NULL",
            "ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ",
            "UPDATE help_policy_documents SET created_at = COALESCE(created_at, updated_at, NOW()) WHERE created_at IS NULL",
            "ALTER COLUMN created_at SET DEFAULT NOW()",
            "ALTER COLUMN created_at SET NOT NULL",
        ]
        positions = [normalized.index(marker) for marker in required_in_order]
        self.assertEqual(positions, sorted(positions))
        for forbidden in ("DROP TABLE", "TRUNCATE", "DELETE FROM", "CREATE TABLE"):
            self.assertNotIn(forbidden, upper)

        updates = re.findall(r"UPDATE help_policy_documents SET (.*?) WHERE", normalized, flags=re.IGNORECASE)
        self.assertEqual(len(updates), 2)
        self.assertTrue(updates[0].strip().lower().startswith("is_system ="))
        self.assertTrue(updates[1].strip().lower().startswith("created_at ="))

    def test_previous_schema_fixture_preserves_rows_and_core_data(self) -> None:
        before = previous_schema_fixture()
        before_core = [{field: row[field] for field in CORE_FIELDS} for row in before]
        after = compatible_fixture(before)

        self.assertEqual(len(after), 6)
        self.assertEqual([{field: row[field] for field in CORE_FIELDS} for row in after], before_core)
        self.assertTrue(all(row["is_system"] is False for row in after))
        self.assertTrue(all(row["created_at"] == row["updated_at"] for row in after))

    def test_help_policy_service_lists_all_preserved_fixture_rows(self) -> None:
        rows = compatible_fixture(previous_schema_fixture())
        service = ContentOperationsService.__new__(ContentOperationsService)
        service.db = _FixtureDb(rows)

        result = service.help_list("admin-user", status="all")

        self.assertEqual(result["total"], 6)
        self.assertEqual([item["code"] for item in result["items"]], [row["code"] for row in rows])
        self.assertTrue(all(item["canDelete"] for item in result["items"]))
        self.assertTrue(all(item["canChangeStatus"] for item in result["items"]))


if __name__ == "__main__":
    unittest.main()
