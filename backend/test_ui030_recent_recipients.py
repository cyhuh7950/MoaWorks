from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError


class Ui030RecentRecipientsTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_owner_scope_unique_indexes_and_bounded_sent_backfill(self):
        sql = (self.root / "migrations" / "034_recent_mail_recipients.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists user_recent_mail_recipients",
            "company_id text not null references companies",
            "owner_user_id text not null references users",
            "unique index",
            "lower(recipient_email)",
            "idx_recent_mail_recipients_owner_latest",
            "delivery_source = 'direct'",
            "m.status = 'sent'",
            "m.sender_deleted_at is null",
            "row_number() over",
            "recent_rank <= 200",
            "on conflict",
        ):
            self.assertIn(marker, sql)
        self.assertNotIn("recipient_kind", sql.split("create table if not exists user_recent_mail_recipients", 1)[1].split(");", 1)[0])

    def test_bulk_request_requires_exactly_one_non_duplicate_selector(self):
        from app.schemas.mail_messenger import MailRecentRecipientBulkDeleteRequest

        self.assertEqual(MailRecentRecipientBulkDeleteRequest(recipientIds=["r1"]).recipientIds, ["r1"])
        self.assertTrue(MailRecentRecipientBulkDeleteRequest(deleteAll=True).deleteAll)
        for payload in ({}, {"recipientIds": []}, {"recipientIds": [" "]}, {"recipientIds": ["r1", "r1"]}, {"recipientIds": ["r1"], "deleteAll": True}, {"recipientIds": [f"r{i}" for i in range(201)]}):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                MailRecentRecipientBulkDeleteRequest(**payload)

    def test_service_uses_deduplicated_sent_only_upsert_and_dedicated_compose_source(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        self.assertIn("def _upsert_recent_recipients", source)
        helper = source[source.index("def _upsert_recent_recipients"):source.index("def ", source.index("def _upsert_recent_recipients") + 5)]
        self.assertIn("ON CONFLICT", helper)
        self.assertIn("use_count = user_recent_mail_recipients.use_count + 1", helper)
        self.assertIn("LOWER(recipient_email)", helper)
        self.assertNotIn("mail_messages", helper)
        recent = source[source.index("def list_recent_recipients"):source.index("def ", source.index("def list_recent_recipients") + 5)]
        self.assertIn("user_recent_mail_recipients", recent)
        self.assertNotIn("FROM mail_recipients", recent)
        self.assertNotIn("scheduled", recent)

    def test_immediate_and_scheduled_sent_paths_call_upsert_but_draft_does_not(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save = source[source.index("def _save_mail"):source.index("def ", source.index("def _save_mail") + 5)]
        dispatch = source[source.index("def dispatch_scheduled_mail"):source.index("def mark_mail_read")]
        self.assertIn('if status_value == "sent":', save)
        self.assertIn("self._upsert_recent_recipients", save)
        self.assertIn("self._upsert_recent_recipients", dispatch)
        self.assertLess(dispatch.index("SET status = 'sent'"), dispatch.index("self._upsert_recent_recipients"))

    def test_management_service_preflights_owner_scoped_bulk_and_metadata_only_audit(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        for method in ("list_recent_recipient_settings", "delete_recent_recipient", "bulk_delete_recent_recipients"):
            self.assertIn(f"def {method}", source)
        bulk = source[source.index("def bulk_delete_recent_recipients"):source.index("def ", source.index("def bulk_delete_recent_recipients") + 5)]
        for marker in ("company_id = %s", "owner_user_id = %s", "FOR UPDATE", "connection.commit()"):
            self.assertIn(marker, bulk)
        self.assertLess(bulk.index("FOR UPDATE"), bulk.index("DELETE FROM user_recent_mail_recipients"))
        self.assertNotIn("recipient_email", bulk)
        audit = source[source.index("def _write_recent_recipient_audit"):source.index("def ", source.index("def _write_recent_recipient_audit") + 5)]
        self.assertIn('"count"', audit)
        self.assertNotIn("email", audit.lower())

    def test_routes_permissions_and_response_contract_are_declared(self):
        routes = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        schemas = (self.root / "app" / "schemas" / "mail_messenger.py").read_text(encoding="utf-8")
        self.assertIn('@router.get("/settings/recent-recipients"', routes)
        self.assertIn('@router.delete("/settings/recent-recipients/{recipient_id}"', routes)
        self.assertIn('@router.post("/settings/recent-recipients/bulk-delete"', routes)
        settings_routes = routes[routes.index('@router.get("/settings/recent-recipients"'):routes.index('@router.get("/storage"')]
        self.assertIn('permission_required("mail:read")', settings_routes)
        self.assertGreaterEqual(settings_routes.count('permission_required("mail:send")'), 2)
        for marker in ("class MailRecentRecipientSettingsResponse", "class MailRecentRecipientBulkDeleteRequest", "class MailRecentRecipientDeleteResponse"):
            self.assertIn(marker, schemas)

    def test_bulk_audit_reason_contains_count_not_addresses(self):
        from app.services.mail_messenger_service import MailMessengerService

        calls: list[tuple[str, tuple]] = []
        cursor = SimpleNamespace(execute=lambda sql, params: calls.append((sql, params)))
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="Owner")
        MailMessengerService()._write_recent_recipient_audit(
            cursor,
            actor,
            "mail.recent_recipients.deleted",
            2,
            datetime(2026, 7, 24, tzinfo=UTC),
        )
        reason = json.loads(calls[0][1][-2])
        self.assertEqual(reason, {"count": 2})
        self.assertNotIn("email", calls[0][0].lower() + json.dumps(calls[0][1], default=str).lower())

    def test_upsert_normalizes_and_deduplicates_addresses_before_bounded_write(self):
        from app.services.mail_messenger_service import MailMessengerService

        class Cursor:
            def __init__(self): self.calls = []; self._rows = []
            def execute(self, sql, params):
                self.calls.append((sql, params))
                self._rows = [{"email": "one@example.com", "name": "One", "department_name": "개발"}] if "FROM users u" in sql else []
            def fetchall(self): return self._rows

        cursor = Cursor()
        MailMessengerService()._upsert_recent_recipients(
            cursor,
            company_id="company-a",
            owner_user_id="owner-a",
            recipient_emails=[" One@Example.com ", "one@example.com", "TWO@example.com"],
            now=datetime(2026, 7, 24, tzinfo=UTC),
        )
        inserts = [(sql, params) for sql, params in cursor.calls if "INSERT INTO user_recent_mail_recipients" in sql]
        self.assertEqual([params[3] for _, params in inserts], ["one@example.com", "two@example.com"])
        self.assertTrue(all("ON CONFLICT" in sql for sql, _ in inserts))
        self.assertIn("OFFSET 200", cursor.calls[-1][0])

    def test_mixed_owner_bulk_fails_before_delete_and_commit(self):
        from app.schemas.mail_messenger import MailRecentRecipientBulkDeleteRequest
        from app.services.mail_messenger_service import MailMessengerService

        class Cursor:
            rowcount = 0
            def __init__(self): self.calls = []; self._rows = []
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def execute(self, sql, params):
                self.calls.append((sql, params))
                self._rows = [{"id": "owned"}] if "SELECT id FROM user_recent_mail_recipients" in sql else []
            def fetchall(self): return self._rows
        class Connection:
            def __init__(self, cursor): self._cursor = cursor; self.committed = False
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def cursor(self): return self._cursor
            def commit(self): self.committed = True
        class Db:
            def __init__(self): self.cursor_value = Cursor(); self.connection = Connection(self.cursor_value)
            def ensure_migrations_applied(self): pass
            def connect(self): return self.connection

        service = MailMessengerService()
        service.db = Db()
        actor = SimpleNamespace(companyId="company-a", userId="owner-a", userName="Owner")
        with self.assertRaises(PermissionError):
            service.bulk_delete_recent_recipients(
                actor,
                MailRecentRecipientBulkDeleteRequest(recipientIds=["owned", "foreign"]),
            )
        sql = "\n".join(item[0] for item in service.db.cursor_value.calls)
        self.assertNotIn("DELETE FROM user_recent_mail_recipients", sql)
        self.assertFalse(service.db.connection.committed)


if __name__ == "__main__":
    unittest.main()
