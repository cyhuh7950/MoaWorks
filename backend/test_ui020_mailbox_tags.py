from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from app.schemas.mail_messenger import MailBulkRequest, MailFolderCreateRequest, MailTagCreateRequest, MailTrashSelection
from app.services.mail_messenger_service import MailMessengerService
from test_ui016_mail_list import FakeDb


class MailboxTagsContractTest(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_defines_owned_resources_state_and_indexes(self):
        sql = (self.root / "migrations" / "024_mailbox_tags.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists mail_user_folders", "create table if not exists mail_tags",
            "create table if not exists mail_recipient_tags", "add column if not exists folder_id",
            "add column if not exists is_spam", "add column if not exists purged_at",
            "add column if not exists sender_purged_at", "create unique index if not exists",
            "lower(name)", "create index if not exists",
        ):
            self.assertIn(marker, sql)

    def test_folder_and_tag_validation(self):
        self.assertEqual(MailFolderCreateRequest(name="  업무  ").name, "업무")
        self.assertEqual(MailTagCreateRequest(name=" 중요 ", color="BLUE").color, "blue")
        for payload in ({"name": " "}, {"name": "x" * 41}):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                MailFolderCreateRequest(**payload)
        for payload in ({"name": "x" * 31, "color": "blue"}, {"name": "업무", "color": "#fff"}):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                MailTagCreateRequest(**payload)

    def test_bulk_contract_preserves_legacy_and_adds_ui020_actions(self):
        legacy = MailBulkRequest(mailIds=["mail-1"], action="read", mailbox="inbox")
        legacy.validate_contract()
        cases = (
            {"action": "move_folder", "mailbox": "inbox", "targetFolderId": "folder-1"},
            {"action": "add_tag", "mailbox": "folder", "targetTagId": "tag-1"},
            {"action": "remove_tag", "mailbox": "tag", "targetTagId": "tag-1"},
            {"action": "spam", "mailbox": "inbox"}, {"action": "not_spam", "mailbox": "spam"},
            {"action": "restore", "mailbox": "trash", "trashViews": [{"mailId": "mail-1", "sourceMailbox": "inbox"}]}, {"action": "purge", "mailbox": "trash", "trashViews": [{"mailId": "mail-1", "sourceMailbox": "inbox"}]},
        )
        for fields in cases:
            with self.subTest(fields=fields):
                request = MailBulkRequest(mailIds=["mail-1"], **fields)
                request.validate_contract()

    def test_routes_and_service_include_owned_crud_lists_and_transaction_audit(self):
        route = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        service = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        for marker in ('@router.get("/folders"', '@router.post("/folders"', '@router.patch("/folders/{folder_id}"',
            '@router.delete("/folders/{folder_id}"', '@router.get("/tags"', '@router.post("/tags"',
            '@router.patch("/tags/{tag_id}"', '@router.delete("/tags/{tag_id}"',
            '@router.get("/folders/{folder_id}/messages"', '@router.get("/tags/{tag_id}/messages"',
            '@router.get("/spam"', '@router.get("/trash"'):
            self.assertIn(marker, route)
        self.assertIn("FOR UPDATE", service)
        self.assertIn("requestId", service)
        self.assertIn("purged_at", service)
        self.assertIn("sender_purged_at", service)


    @staticmethod
    def actor():
        return SimpleNamespace(companyId="company-a", userId="user-a", userEmail="User@A.Test", userName="관리자")

    def test_mixed_owner_ids_rollback_before_any_update(self):
        service = MailMessengerService()
        service.db = FakeDb(
            fetchone=[{"id": "folder-1", "name": "업무", "sort_order": 0}],
            fetchall=[[{"recipient_id": "recipient-1", "mail_id": "mail-1", "folder_id": None,
                        "is_spam": False, "deleted_at": None, "purged_at": None,
                        "is_read": False, "is_starred": False}]],
        )
        payload = MailBulkRequest(mailIds=["mail-1", "mail-other"], action="move_folder",
                                  mailbox="inbox", targetFolderId="folder-1")
        with self.assertRaises(PermissionError):
            service.bulk_mail(self.actor(), payload)
        self.assertEqual(service.db.connection.commit_count, 0)
        sql = [statement.upper() for statement, _ in service.db.cursor_instance.executions]
        self.assertFalse(any(statement.startswith("UPDATE MAIL_RECIPIENTS") for statement in sql))

    def test_sender_purge_is_logical_and_audited(self):
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[{"mail_id": "mail-1", "status": "sent",
                                      "sender_deleted_at": object(), "sender_purged_at": None}])
        response = service.bulk_mail(
            self.actor(), MailBulkRequest(
                mailIds=["mail-1"], action="purge", mailbox="trash",
                trashViews=[{"mailId": "mail-1", "sourceMailbox": "sent"}],
            )
        )
        self.assertEqual(response.changedCount, 1)
        executions = service.db.cursor_instance.executions
        self.assertTrue(any("SENDER_PURGED_AT" in sql.upper() for sql, _ in executions))
        self.assertTrue(any("INSERT INTO AUDIT_LOGS" in sql.upper() for sql, _ in executions))
        self.assertTrue(any('"deleted": true' in str(value) for _, params in executions for value in params))
        self.assertFalse(any(sql.strip().upper().startswith("DELETE FROM MAIL_MESSAGES") for sql, _ in executions))

    def test_ui020_audit_reason_contains_only_context_and_request_id(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        start = source.index("    def _write_mail_bulk_audit")
        end = source.index("    def create_room", start)
        audit = source[start:end]
        self.assertIn('"requestId": request_id', audit)
        for forbidden in ("recipient_email", "body_text", "token", "cookie"):
            self.assertNotIn(forbidden, audit.lower())

    def test_trash_selection_requires_source_mailbox_and_allows_same_mail_views(self):
        request = MailBulkRequest(
            mailIds=["self-mail"],
            action="restore",
            mailbox="trash",
            trashViews=[
                MailTrashSelection(mailId="self-mail", sourceMailbox="inbox"),
                MailTrashSelection(mailId="self-mail", sourceMailbox="sent"),
            ],
        )
        request.validate_contract()
        self.assertEqual(len(request.trashViews or []), 2)

        invalid_requests = (
            {"mailIds": ["self-mail"], "action": "restore", "mailbox": "trash"},
            {"mailIds": ["self-mail"], "action": "restore", "mailbox": "trash",
             "trashViews": [{"mailId": "self-mail", "sourceMailbox": "spam"}]},
            {"mailIds": ["self-mail"], "action": "restore", "mailbox": "trash",
             "trashViews": [{"mailId": "other-mail", "sourceMailbox": "inbox"}]},
        )
        for payload in invalid_requests:
            with self.subTest(payload=payload), self.assertRaises((ValidationError, ValueError)):
                request = MailBulkRequest(**payload)
                request.validate_contract()

    def test_self_mail_trash_views_are_locked_and_restored_independently(self):
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[
            {"recipient_id": "recipient-self", "mail_id": "self-mail", "folder_id": None,
             "is_spam": False, "deleted_at": object(), "purged_at": None,
             "is_read": True, "is_starred": False},
            {"mail_id": "self-mail", "status": "sent", "sender_deleted_at": object(),
             "sender_purged_at": None},
        ])
        response = service.bulk_mail(
            self.actor(),
            MailBulkRequest(
                mailIds=["self-mail"], action="restore", mailbox="trash",
                trashViews=[
                    {"mailId": "self-mail", "sourceMailbox": "inbox"},
                    {"mailId": "self-mail", "sourceMailbox": "sent"},
                ],
            ),
        )
        self.assertEqual((response.requestedCount, response.changedCount), (2, 2))
        sql = [statement.upper() for statement, _ in service.db.cursor_instance.executions]
        self.assertTrue(any("UPDATE MAIL_RECIPIENTS" in statement for statement in sql))
        self.assertTrue(any("UPDATE MAIL_MESSAGES" in statement for statement in sql))

    def test_trash_mixed_missing_view_rolls_back_before_updates(self):
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[
            {"recipient_id": "recipient-self", "mail_id": "self-mail", "folder_id": None,
             "is_spam": False, "deleted_at": object(), "purged_at": None,
             "is_read": True, "is_starred": False},
            None,
        ])
        request = MailBulkRequest(
            mailIds=["self-mail"], action="restore", mailbox="trash",
            trashViews=[
                {"mailId": "self-mail", "sourceMailbox": "inbox"},
                {"mailId": "self-mail", "sourceMailbox": "sent"},
            ],
        )
        with self.assertRaises(PermissionError):
            service.bulk_mail(self.actor(), request)
        self.assertEqual(service.db.connection.commit_count, 0)
        self.assertFalse(any(sql.strip().upper().startswith("UPDATE ") for sql, _ in service.db.cursor_instance.executions))

    def test_recipient_purge_does_not_change_sender_view(self):
        service = MailMessengerService()
        service.db = FakeDb(fetchone=[
            {"recipient_id": "recipient-self", "mail_id": "self-mail", "folder_id": None,
             "is_spam": False, "deleted_at": object(), "purged_at": None,
             "is_read": True, "is_starred": False},
        ])
        response = service.bulk_mail(
            self.actor(),
            MailBulkRequest(
                mailIds=["self-mail"], action="purge", mailbox="trash",
                trashViews=[{"mailId": "self-mail", "sourceMailbox": "inbox"}],
            ),
        )
        self.assertEqual((response.requestedCount, response.changedCount), (1, 1))
        sql = [statement.upper() for statement, _ in service.db.cursor_instance.executions]
        self.assertTrue(any("UPDATE MAIL_RECIPIENTS" in statement and "PURGED_AT" in statement for statement in sql))
        self.assertFalse(any("UPDATE MAIL_MESSAGES" in statement for statement in sql))

if __name__ == "__main__":
    unittest.main()