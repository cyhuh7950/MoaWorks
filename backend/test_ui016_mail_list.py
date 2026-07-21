from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from app.schemas.mail_messenger import MailBulkRequest, MailListQuery, MailSummary
from app.services.mail_messenger_service import MailMessengerService


class FakeCursor:
    def __init__(self, *, fetchone=None, fetchall=None):
        self.fetchone_results = list(fetchone or [])
        self.fetchall_results = list(fetchall or [])
        self.executions: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params=()):
        self.executions.append((" ".join(str(sql).split()), tuple(params)))

    def fetchone(self):
        return self.fetchone_results.pop(0) if self.fetchone_results else None

    def fetchall(self):
        return self.fetchall_results.pop(0) if self.fetchall_results else []


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self.cursor_instance = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1


class FakeDb:
    def __init__(self, *, fetchone=None, fetchall=None):
        self.cursor_instance = FakeCursor(fetchone=fetchone, fetchall=fetchall)
        self.connection = FakeConnection(self.cursor_instance)

    def ensure_migrations_applied(self):
        return None

    def connect(self):
        return self.connection


class MailListOperationsTest(unittest.TestCase):
    root = Path(__file__).parent

    @staticmethod
    def actor():
        return SimpleNamespace(
            companyId="company-a",
            userId="user-a",
            userEmail="User@A.Test",
            userName="관리자",
        )

    def test_list_query_normalizes_and_rejects_unbounded_values(self):
        query = MailListQuery(
            q="  분기 보고  ",
            read="READ",
            starred="starred",
            attachment="with",
            category="social",
            sort="sender_asc",
            limit=100,
            offset=4,
        )
        self.assertEqual(query.q, "분기 보고")
        self.assertEqual(query.read, "read")
        self.assertEqual(query.limit, 100)

        for invalid in (
            {"q": "x" * 201},
            {"read": "maybe"},
            {"starred": "maybe"},
            {"attachment": "maybe"},
            {"category": "spam"},
            {"sort": "subject desc; drop table mail_messages"},
            {"limit": 0},
            {"limit": 101},
            {"offset": -1},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                MailListQuery(**invalid)

    def test_bulk_schema_deduplicates_and_enforces_action_mailbox_contract(self):
        payload = MailBulkRequest(
            mailIds=[" mail-1 ", "mail-1", "mail-2"],
            action="MOVE",
            mailbox="INBOX",
            targetCategory="social",
        )
        self.assertEqual(payload.mailIds, ["mail-1", "mail-2"])
        self.assertEqual(payload.action, "move")
        self.assertEqual(payload.mailbox, "inbox")
        self.assertEqual(payload.targetCategory, "social")

        invalid_payloads = (
            {"mailIds": [" "], "action": "read", "mailbox": "inbox"},
            {"mailIds": [f"mail-{index}" for index in range(101)], "action": "read", "mailbox": "inbox"},
            {"mailIds": ["mail-1"], "action": "read", "mailbox": "sent"},
            {"mailIds": ["mail-1"], "action": "move", "mailbox": "inbox"},
            {"mailIds": ["mail-1"], "action": "move", "mailbox": "inbox", "targetCategory": "spam"},
        )
        for invalid in invalid_payloads:
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                MailBulkRequest(**invalid)

    def test_ui016_migration_separates_recipient_and_sender_deletion(self):
        migration = (self.root / "migrations" / "020_mail_list_operations.sql").read_text(encoding="utf-8")
        normalized = " ".join(migration.lower().split())
        self.assertIn("alter table mail_recipients", normalized)
        self.assertIn("add column if not exists deleted_at", normalized)
        self.assertIn("add column if not exists deleted_by_user_id", normalized)
        self.assertIn("alter table mail_messages", normalized)
        self.assertIn("add column if not exists sender_deleted_at", normalized)
        self.assertIn("add column if not exists sender_deleted_by_user_id", normalized)
        self.assertIn("create index if not exists", normalized)
        self.assertNotIn("mail_messages deleted_at", normalized)

    def test_inbox_query_uses_server_filters_whitelist_sort_and_metadata(self):
        row = {
            "mail_id": "mail-1",
            "account_id": "account-1",
            "sender_email": "sender@example.test",
            "subject": "분기 보고",
            "preview_text": "본문 미리보기",
            "status": "sent",
            "sent_at": None,
            "retention_expires_at": None,
            "attachment_count": 1,
            "is_read": False,
            "is_starred": True,
            "received_at": None,
            "category": "social",
        }
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[{"total": 3}], fetchall=[[row]])
        query = MailListQuery(
            q="분기",
            read="unread",
            starred="starred",
            attachment="with",
            category="social",
            sort="sender_asc",
            limit=1,
            offset=1,
        )

        response = service.list_inbox(self.actor(), query)

        self.assertEqual((response.total, response.limit, response.offset, response.hasMore), (3, 1, 1, True))
        self.assertEqual(response.mails[0].previewText, "본문 미리보기")
        self.assertEqual(len(service.db.cursor_instance.executions), 2)
        count_sql, count_params = service.db.cursor_instance.executions[0]
        page_sql, page_params = service.db.cursor_instance.executions[1]
        for sql in (count_sql.upper(), page_sql.upper()):
            self.assertIn("R.DELETED_AT IS NULL", sql)
            self.assertIn("ILIKE %S", sql)
            self.assertIn("R.IS_READ = %S", sql)
            self.assertIn("R.IS_STARRED = %S", sql)
            self.assertIn("M.ATTACHMENT_COUNT > 0", sql)
            self.assertIn("COALESCE(R.INBOX_CATEGORY, 'PRIMARY') = %S", sql)
        self.assertIn("ORDER BY LOWER(M.SENDER_EMAIL) ASC", page_sql.upper())
        self.assertNotIn("분기", page_sql)
        self.assertEqual(count_params[-4:], (False, True, "social", "%분기%"))
        self.assertEqual(page_params[-2:], (1, 1))

    def test_sent_and_draft_queries_exclude_only_sender_deleted_rows(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        sent = source[source.index("def list_sent"):source.index("def list_drafts")]
        draft = source[source.index("def list_drafts"):source.index("def _list_inbox_query")]
        self.assertIn("m.sender_deleted_at IS NULL", sent)
        self.assertIn("m.sender_deleted_at IS NULL", draft)
        self.assertNotIn("r.deleted_at", sent)
        self.assertNotIn("r.deleted_at", draft)

    def test_bulk_rejects_partial_access_before_any_update(self):
        service = MailMessengerService()
        service.db = FakeDb(
            fetchall=[[{
                "recipient_id": "recipient-1",
                "mail_id": "mail-1",
                "is_read": False,
                "is_starred": False,
                "category": "primary",
                "deleted_at": None,
            }]],
        )
        payload = MailBulkRequest(mailIds=["mail-1", "mail-other"], action="read", mailbox="inbox")

        with self.assertRaises(PermissionError):
            service.bulk_mail(self.actor(), payload)

        self.assertEqual(service.db.connection.commit_count, 0)
        self.assertEqual(len(service.db.cursor_instance.executions), 1)
        lock_sql, lock_params = service.db.cursor_instance.executions[0]
        self.assertIn("FOR UPDATE", lock_sql.upper())
        self.assertIn("M.COMPANY_ID = %S", lock_sql.upper())
        self.assertEqual(lock_params, (payload.mailIds, "company-a", "user-a", "user@a.test"))

    def test_bulk_move_counts_changes_and_writes_real_before_after_audit(self):
        service = MailMessengerService()
        service.db = FakeDb(
            fetchall=[[
                {
                    "recipient_id": "recipient-1",
                    "mail_id": "mail-1",
                    "is_read": False,
                    "is_starred": False,
                    "category": "primary",
                    "deleted_at": None,
                },
                {
                    "recipient_id": "recipient-2",
                    "mail_id": "mail-2",
                    "is_read": True,
                    "is_starred": True,
                    "category": "social",
                    "deleted_at": None,
                },
            ]],
        )
        payload = MailBulkRequest(
            mailIds=["mail-1", "mail-2"],
            action="move",
            mailbox="inbox",
            targetCategory="social",
        )

        response = service.bulk_mail(self.actor(), payload)

        self.assertEqual((response.requestedCount, response.changedCount, response.unchangedCount), (2, 1, 1))
        self.assertEqual(response.targetCategory, "social")
        self.assertEqual(service.db.connection.commit_count, 1)
        self.assertEqual(len(service.db.cursor_instance.executions), 3)
        update_sql, update_params = service.db.cursor_instance.executions[1]
        audit_sql, audit_params = service.db.cursor_instance.executions[2]
        self.assertIn("UPDATE MAIL_RECIPIENTS", update_sql.upper())
        self.assertIn("INBOX_CATEGORY", update_sql.upper())
        self.assertIn("recipient-1", update_params)
        self.assertIn("INSERT INTO AUDIT_LOGS", audit_sql.upper())
        self.assertIn("mail.bulk.move", audit_params)
        self.assertTrue(any('"category": "primary"' in str(value) for value in audit_params))
        self.assertTrue(any('"category": "social"' in str(value) for value in audit_params))

    def test_inbox_bulk_state_actions_update_only_locked_recipient_and_audit(self):
        cases = (
            ("read", False, False, "IS_READ"),
            ("unread", True, False, "IS_READ"),
            ("star", False, False, "IS_STARRED"),
            ("unstar", False, True, "IS_STARRED"),
            ("delete", False, False, "DELETED_AT"),
        )
        for action, is_read, is_starred, expected_column in cases:
            with self.subTest(action=action):
                service = MailMessengerService()
                service.db = FakeDb(fetchall=[[
                    {
                        "recipient_id": "recipient-1",
                        "mail_id": "mail-1",
                        "is_read": is_read,
                        "is_starred": is_starred,
                        "category": "primary",
                        "deleted_at": None,
                    },
                ]])
                response = service.bulk_mail(
                    self.actor(),
                    MailBulkRequest(mailIds=["mail-1"], action=action, mailbox="inbox"),
                )
                self.assertEqual((response.changedCount, response.unchangedCount), (1, 0))
                update_sql, update_params = service.db.cursor_instance.executions[1]
                audit_sql, audit_params = service.db.cursor_instance.executions[2]
                self.assertIn("UPDATE MAIL_RECIPIENTS", update_sql.upper())
                self.assertIn(expected_column, update_sql.upper())
                self.assertIn("recipient-1", update_params)
                self.assertIn(f"mail.bulk.{action}", audit_params)
                self.assertIn("STATUS_BEFORE", audit_sql.upper())
                self.assertIn("STATUS_AFTER", audit_sql.upper())

    def test_sender_delete_isolated_from_recipient_rows_for_sent_and_draft(self):
        for mailbox, status_value in (("sent", "sent"), ("draft", "draft")):
            with self.subTest(mailbox=mailbox):
                service = MailMessengerService()
                service.db = FakeDb(fetchall=[[
                    {"mail_id": "mail-1", "status": status_value, "sender_deleted_at": None},
                ]])
                response = service.bulk_mail(
                    self.actor(),
                    MailBulkRequest(mailIds=["mail-1"], action="delete", mailbox=mailbox),
                )
                self.assertEqual(response.changedCount, 1)
                lock_sql, lock_params = service.db.cursor_instance.executions[0]
                update_sql, _ = service.db.cursor_instance.executions[1]
                self.assertIn("M.SENDER_USER_ID = %S", lock_sql.upper())
                self.assertEqual(lock_params, (["mail-1"], "company-a", "user-a", status_value))
                self.assertIn("UPDATE MAIL_MESSAGES", update_sql.upper())
                self.assertIn("SENDER_DELETED_AT", update_sql.upper())
                self.assertNotIn("MAIL_RECIPIENTS", update_sql.upper())

    def test_bulk_route_precedes_dynamic_detail_and_passes_validated_payload(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        bulk_marker = '@router.post("/bulk"'
        self.assertLess(source.index(bulk_marker), source.index('@router.get("/{mail_id}"'))
        route = source[source.index(bulk_marker):source.index(bulk_marker) + 500]
        self.assertIn("bulk_mail(user, payload)", route)
        self.assertIn('permission_required("mail:read")', route)

    def test_mail_summary_preview_is_plain_bounded_field(self):
        summary = MailSummary(
            mailId="mail-1",
            accountId="account-1",
            senderEmail="sender@example.test",
            subject="subject",
            previewText="plain preview",
            status="sent",
            isRead=False,
            isStarred=False,
            attachmentCount=0,
        )
        self.assertEqual(summary.previewText, "plain preview")


if __name__ == "__main__":
    unittest.main()
