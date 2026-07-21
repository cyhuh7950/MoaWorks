from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace

from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, row):
        self.row = row
        self.sql = ""
        self.params = ()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params):
        self.sql = " ".join(sql.split())
        self.params = params

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor


class FakeDb:
    def __init__(self, row):
        self.cursor = FakeCursor(row)

    def ensure_migrations_applied(self):
        return None

    def connect(self):
        return FakeConnection(self.cursor)


class MailStorageTest(unittest.TestCase):
    def actor(self):
        return SimpleNamespace(companyId="company-a", userId="user-a", userEmail="user@a.test")

    def test_storage_response_and_isolation_contract(self):
        service = MailMessengerService()
        service.db = FakeDb({"quota_mb": 2, "used_bytes": 524288})

        response = service.get_mail_storage(self.actor())

        self.assertEqual(response.usedBytes, 524288)
        self.assertEqual(response.quotaBytes, 2 * 1024 * 1024)
        self.assertEqual(response.usagePercent, 25.0)
        sql = service.db.cursor.sql.upper()
        self.assertIn("SELECT DISTINCT", sql)
        self.assertIn("M.COMPANY_ID = %S", sql)
        self.assertIn("U.COMPANY_ID = %S", sql)
        self.assertIn("OCTET_LENGTH", sql)
        self.assertIn("MAIL_ATTACHMENTS", sql)
        self.assertEqual(
            service.db.cursor.params,
            ("company-a", "user-a", "user-a", "user@a.test", "user-a", "company-a"),
        )

    def test_missing_active_mail_account_is_rejected(self):
        service = MailMessengerService()
        service.db = FakeDb(None)
        with self.assertRaisesRegex(ValueError, "활성 메일 계정"):
            service.get_mail_storage(self.actor())

    def test_static_storage_route_precedes_dynamic_detail_route(self):
        route_source = Path(__file__).parent / "app" / "api" / "routes" / "mail.py"
        source = route_source.read_text(encoding="utf-8")
        self.assertLess(source.index('@router.get("/storage"'), source.index('@router.get("/{mail_id}"'))


if __name__ == "__main__":
    unittest.main()
