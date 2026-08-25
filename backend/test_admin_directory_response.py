from __future__ import annotations

import unittest
import inspect
from datetime import datetime, timezone

from app.schemas.directory import UserUpdateRequest
from app.services.directory_store import DirectoryStore


class _RecordingCursor:
    def __init__(self) -> None:
        self.executions: list[tuple[str, tuple | None]] = []
        self.fetchone_results: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def execute(self, statement: str, parameters: tuple | None = None) -> None:
        self.executions.append((statement, parameters))

    def fetchone(self):
        return self.fetchone_results.pop(0)


class _RecordingConnection:
    def __init__(self, cursor: _RecordingCursor) -> None:
        self.recording_cursor = cursor
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def cursor(self) -> _RecordingCursor:
        return self.recording_cursor

    def commit(self) -> None:
        self.committed = True


class _RecordingDatabase:
    def __init__(self, connection: _RecordingConnection) -> None:
        self.connection = connection

    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self) -> _RecordingConnection:
        return self.connection


class AdminDirectoryResponseTest(unittest.TestCase):
    def test_directory_overview_selects_department_head_flag(self) -> None:
        source = inspect.getsource(DirectoryStore.get_overview)

        self.assertIn("u.is_department_head", source)

    def test_user_view_includes_department_head_flag(self) -> None:
        store = DirectoryStore.__new__(DirectoryStore)
        row = {
            "user_id": "user-1",
            "company_id": "company-1",
            "user_name": "관리자",
            "user_email": "admin@example.com",
            "department_id": "department-1",
            "department_name": "본사",
            "role_id": "role-1",
            "role_name": "관리자",
            "role_status": "active",
            "user_status": "active",
            "user_type": "admin",
            "is_department_head": True,
            "mail_account_email": "admin@example.com",
            "mail_account_status": "active",
            "permissions": ["admin"],
        }

        view = store._row_to_user_view(row)

        self.assertTrue(view.isDepartmentHead)

    def test_update_user_sql_binds_department_head_and_password_policy_once(self) -> None:
        cursor = _RecordingCursor()
        connection = _RecordingConnection(cursor)
        store = DirectoryStore.__new__(DirectoryStore)
        store.db = _RecordingDatabase(connection)
        store._now = lambda: datetime(2026, 8, 24, tzinfo=timezone.utc)
        store._fetch_user_access_row = lambda *args: {
            "user_id": "user-1",
            "company_id": "company-1",
            "user_name": "기존 사용자",
            "department_id": "department-1",
            "role_id": "role-1",
            "user_status": "active",
            "user_type": "user",
            "is_department_head": False,
            "password_hash": "stored-password-hash",
            "must_change_password": True,
        }
        store._fetch_required_department = lambda *args: {"status": "active"}
        store._fetch_required_role = lambda *args: {"status": "active"}
        store._insert_audit = lambda **kwargs: None
        store._fetch_user_view_row = lambda *args: {"user_id": "user-1"}
        store._row_to_user_view = lambda row: row

        result = store.update_user(
            "user-1",
            UserUpdateRequest(
                name="수정 사용자",
                departmentId="department-2",
                roleId="role-2",
                status="inactive",
                userType="admin",
                isDepartmentHead=False,
            ),
        )

        statement, parameters = next(
            item for item in cursor.executions
            if "UPDATE users" in item[0] and "SET name = %s" in item[0]
        )
        self.assertEqual(statement.count("user_type = %s"), 1)
        self.assertEqual(statement.count("is_department_head = %s"), 1)
        self.assertIn("must_change_password = %s", statement)
        self.assertEqual(statement.count("%s"), len(parameters or ()))
        self.assertEqual(
            parameters,
            (
                "수정 사용자",
                "stored-password-hash",
                "department-2",
                "role-2",
                False,
                "inactive",
                "admin",
                True,
                datetime(2026, 8, 24, tzinfo=timezone.utc),
                "user-1",
            ),
        )
        self.assertTrue(connection.committed)
        self.assertEqual(result, {"user_id": "user-1"})

    def test_update_user_cannot_demote_last_admin(self) -> None:
        cursor = _RecordingCursor()
        cursor.fetchone_results.append({"count": 1})
        connection = _RecordingConnection(cursor)
        store = DirectoryStore.__new__(DirectoryStore)
        store.db = _RecordingDatabase(connection)
        store._fetch_user_access_row = lambda *args: {
            "user_id": "admin-1",
            "company_id": "company-1",
            "user_name": "관리자",
            "department_id": "department-1",
            "role_id": "role-1",
            "user_status": "active",
            "user_type": "admin",
            "is_department_head": False,
            "password_hash": "stored-password-hash",
            "must_change_password": False,
        }
        store._fetch_required_department = lambda *args: {"status": "active"}
        store._fetch_required_role = lambda *args: {"status": "active"}

        with self.assertRaisesRegex(ValueError, "마지막 관리자"):
            store.update_user("admin-1", UserUpdateRequest(userType="user"))

        self.assertFalse(connection.committed)


if __name__ == "__main__":
    unittest.main()
