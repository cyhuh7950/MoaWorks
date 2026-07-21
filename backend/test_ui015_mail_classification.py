from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from app.schemas.mail_messenger import MailCategoryRequest, MailSummary
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params):
        self.executions.append((" ".join(sql.split()), tuple(params)))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        return []


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commit_count += 1


class FakeDb:
    def __init__(self, rows=None):
        self.cursor_instance = FakeCursor(rows)
        self.connection = FakeConnection(self.cursor_instance)

    def ensure_migrations_applied(self):
        return None

    def connect(self):
        return self.connection


class MailClassificationTest(unittest.TestCase):
    root = Path(__file__).parent

    def actor(self):
        return SimpleNamespace(companyId="company-a", userId="user-a", userEmail="User@A.Test", userName="관리자")

    def test_category_schema_normalizes_five_values_and_rejects_others(self):
        for category in ("primary", "promotions", "social", "updates", "forums"):
            self.assertEqual(MailCategoryRequest(category=f" {category.upper()} ").category, category)
        with self.assertRaises(ValidationError):
            MailCategoryRequest(category="spam")

    def test_mail_summary_defaults_missing_category_to_primary(self):
        summary = MailSummary(mailId="mail-1", accountId="account-1", senderEmail="sender@example.test", subject="subject", status="sent", isRead=False, isStarred=False, attachmentCount=0)
        self.assertEqual(summary.category, "primary")

    def test_ui015_migration_is_idempotent_scoped_and_indexed(self):
        migration = (self.root / "migrations" / "019_mail_inbox_classification.sql").read_text(encoding="utf-8")
        normalized = " ".join(migration.lower().split())
        self.assertIn("add column if not exists inbox_category text not null default 'primary'", normalized)
        self.assertIn("do $$", normalized)
        self.assertIn("check (inbox_category in ('primary', 'promotions', 'social', 'updates', 'forums'))", normalized)
        self.assertIn("create index if not exists", normalized)
        self.assertIn("(recipient_user_id, inbox_category)", normalized)
        for forbidden in ("deleted_at", "deleted_by_user_id", "smtp", "bulk"):
            self.assertNotIn(forbidden, normalized)

    def test_inbox_query_is_company_and_recipient_scoped_with_primary_compatibility(self):
        service = MailMessengerService()
        service.db = FakeDb()
        self.assertEqual(service.list_inbox(self.actor()).mails, [])
        sql, params = service.db.cursor_instance.executions[0]
        normalized = sql.upper()
        self.assertIn("M.COMPANY_ID = %S", normalized)
        self.assertIn("R.RECIPIENT_USER_ID = %S", normalized)
        self.assertIn("LOWER(R.RECIPIENT_EMAIL) = %S", normalized)
        self.assertIn("COALESCE(R.INBOX_CATEGORY, 'PRIMARY') AS CATEGORY", normalized)
        self.assertEqual(params, ("company-a", "user-a", "user@a.test"))

    def test_category_change_locks_scoped_recipient_updates_and_audits_in_one_transaction(self):
        service = MailMessengerService()
        service.db = FakeDb([{"category": "primary", "is_read": False, "is_starred": True}, {"is_read": False, "is_starred": True}])
        response = service.set_mail_category(self.actor(), "mail-1", MailCategoryRequest(category="social"))
        self.assertEqual((response.mailId, response.status), ("mail-1", "social"))
        self.assertEqual(response.category, "social")
        self.assertEqual(service.db.connection.commit_count, 1)
        self.assertEqual(len(service.db.cursor_instance.executions), 3)
        select_sql, select_params = service.db.cursor_instance.executions[0]
        update_sql, update_params = service.db.cursor_instance.executions[1]
        audit_sql, audit_params = service.db.cursor_instance.executions[2]
        self.assertIn("FOR UPDATE", select_sql.upper())
        self.assertIn("M.COMPANY_ID = %S", select_sql.upper())
        self.assertEqual(select_params, ("mail-1", "company-a", "user-a", "user@a.test"))
        self.assertIn("UPDATE MAIL_RECIPIENTS AS R", update_sql.upper())
        self.assertIn("FROM MAIL_MESSAGES AS M", update_sql.upper())
        self.assertIn("M.COMPANY_ID = %S", update_sql.upper())
        self.assertEqual(update_params, ("social", "mail-1", "company-a", "user-a", "user@a.test"))
        self.assertIn("INSERT INTO AUDIT_LOGS", audit_sql.upper())
        self.assertIn("mail.category.changed", audit_params)
        self.assertIn("primary", audit_params)
        self.assertIn("social", audit_params)

    def test_category_change_rejects_non_recipient_without_commit(self):
        service = MailMessengerService()
        service.db = FakeDb([None])
        with self.assertRaisesRegex(PermissionError, "받은 메일의 분류"):
            service.set_mail_category(self.actor(), "mail-other", MailCategoryRequest(category="forums"))
        self.assertEqual(service.db.connection.commit_count, 0)
        self.assertEqual(len(service.db.cursor_instance.executions), 1)

    def test_category_route_uses_mail_read_and_precedes_detail_route(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        category_marker = '@router.post("/{mail_id}/category"'
        self.assertIn(category_marker, source)
        self.assertLess(source.index(category_marker), source.index('@router.get("/{mail_id}"'))
        route_section = source[source.index(category_marker):source.index(category_marker) + 500]
        self.assertIn('permission_required("mail:read")', route_section)


if __name__ == "__main__":
    unittest.main()
