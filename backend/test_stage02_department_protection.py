from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.services.directory_store import DirectoryStore


class _Cursor:
    def __init__(self, database: "_Database") -> None:
        self.database = database
        self._row: dict | None = None

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, _params: tuple | None = None) -> None:
        normalized = " ".join(query.split()).lower()
        if normalized.startswith("select id, company_id, name, parent_id"):
            self._row = dict(self.database.department)
            return
        if normalized.startswith("select 1 from departments where parent_id"):
            self._row = None
            return
        if normalized.startswith("select 1 from users where department_id"):
            self._row = None
            return
        if normalized.startswith("update departments set status = 'deleted'"):
            self.database.department["status"] = "deleted"
            self._row = dict(self.database.department)
            return
        if normalized.startswith("insert into audit_logs"):
            return
        raise AssertionError(f"unexpected query: {normalized}")

    def fetchone(self) -> dict | None:
        return self._row


class _Connection:
    def __init__(self, database: "_Database") -> None:
        self.database = database

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return _Cursor(self.database)

    def commit(self) -> None:
        return None


class _Database:
    def __init__(self, *, is_default: bool, name: str) -> None:
        self.department = {
            "id": "department-1",
            "company_id": "company-1",
            "name": name,
            "parent_id": None,
            "status": "active",
            "sort_order": 100,
            "is_default": is_default,
            "created_at": datetime.now(UTC),
        }

    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> _Connection:
        return _Connection(self)


def _store(database: _Database) -> DirectoryStore:
    store = DirectoryStore.__new__(DirectoryStore)
    store.db = database
    return store


class Stage02DepartmentProtectionTest(unittest.TestCase):
    def test_user_created_top_level_department_can_be_deleted(self) -> None:
        deleted = _store(_Database(is_default=False, name="신규 본부")).delete_department("department-1")

        self.assertEqual(deleted.status, "deleted")

    def test_default_department_remains_protected(self) -> None:
        with self.assertRaisesRegex(ValueError, "기본 부서"):
            _store(_Database(is_default=True, name="본사")).delete_department("department-1")


if __name__ == "__main__":
    unittest.main()
