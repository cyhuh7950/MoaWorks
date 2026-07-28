from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import unittest

from app.schemas import mail_messenger
from app.services.mail_delivery_operations import MailDeliveryOperations


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


class MailLiveCoreTest(unittest.TestCase):
    root = Path(__file__).parent

    @staticmethod
    def actor():
        return SimpleNamespace(companyId="company-a", userId="user-a", userName="User A")

    def test_user_delivery_projection_and_company_scope(self):
        self.assertTrue(hasattr(MailDeliveryOperations, "get_user_status"))
        db = FakeDb({"delivery_enabled": True, "last_test_status": "success"})
        response = MailDeliveryOperations(db=db).get_user_status(self.actor())
        self.assertEqual(response, {"provider": {"enabled": True, "lastTestStatus": "success"}})
        sql = db.cursor.sql.upper()
        self.assertIn("SELECT DELIVERY_ENABLED,LAST_TEST_STATUS", sql)
        self.assertIn("FROM MAIL_PROVIDER_CONFIGS", sql)
        self.assertIn("WHERE COMPANY_ID=%S", sql)
        self.assertNotIn("SELECT *", sql)
        for forbidden in ("RELAY_HOST", "RELAY_PORT", "FROM_ADDRESS", "USERNAME", "PASSWORD", "ERROR", "WORKER", "QUEUE"):
            self.assertNotIn(forbidden, sql)
        self.assertEqual(db.cursor.params, ("company-a",))

    def test_user_delivery_schema_is_exact_and_minimal(self):
        schema = getattr(mail_messenger, "MailUserDeliveryStatusResponse", None)
        self.assertIsNotNone(schema)
        result = schema(provider={"enabled": False, "lastTestStatus": "untested"}).model_dump()
        self.assertEqual(result, {"provider": {"enabled": False, "lastTestStatus": "untested"}})
        serialized = repr(result).lower()
        for forbidden in ("relay", "host", "port", "from", "username", "password", "error", "worker", "queue", "summary"):
            self.assertNotIn(forbidden, serialized)

    def test_user_route_uses_mail_send_and_precedes_dynamic_detail(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        marker = '@router.get("/delivery/status", response_model=MailUserDeliveryStatusResponse)'
        self.assertIn(marker, source)
        route_at = source.index(marker)
        detail_at = source.index('@router.get("/{mail_id}", response_model=MailDetailResponse)')
        self.assertLess(route_at, detail_at)
        route_source = source[route_at:detail_at]
        self.assertIn('Depends(permission_required("mail:send"))', route_source)
        self.assertIn("get_user_status(user)", route_source)
        self.assertNotIn("get_status(user)", route_source)
        self.assertNotIn("admin", route_source.lower())

    def test_admin_delivery_contract_remains_unchanged(self):
        admin = (self.root / "app" / "api" / "routes" / "admin.py").read_text(encoding="utf-8")
        self.assertIn('@router.get("/mail-delivery/status", response_model=MailDeliveryStatusResponse)', admin)
        self.assertIn("_delivery_service().get_status(user)", admin)
        self.assertIn("Depends(require_admin)", admin)


if __name__ == "__main__":
    unittest.main()
