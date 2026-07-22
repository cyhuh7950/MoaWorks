from __future__ import annotations

import unittest
from pathlib import Path

from pydantic import ValidationError

from app.schemas.mail_messenger import MailBulkRequest, MailFolderCreateRequest, MailTagCreateRequest


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
            {"action": "restore", "mailbox": "trash"}, {"action": "purge", "mailbox": "trash"},
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


if __name__ == "__main__":
    unittest.main()