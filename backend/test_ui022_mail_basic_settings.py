from __future__ import annotations

from email.message import EmailMessage
from pathlib import Path
from datetime import UTC, datetime
from types import SimpleNamespace
import re
import unittest

from pydantic import ValidationError

from app.schemas.mail_messenger import MailBasicPreferencesUpdateRequest, MailSendRequest
from app.services.mail_delivery_service import SmtpRelayAdapter
from app.services.mail_messenger_service import MailMessengerService, MailPreferenceConflictError


def preference_row(version: int = 1) -> dict:
    return {
        "owner_user_id": "user-a", "company_id": "company-a", "sender_display_mode": "name_email",
        "block_remote_images": True, "disable_risky_tags": True, "show_route_country": False,
        "include_spam_trash_in_search": False, "show_list_preview": True, "recipient_input_mode": "autocomplete",
        "confirm_before_send": True, "save_sent_copy": True, "read_receipt_enabled": True,
        "editor_mode": "html", "compose_mode": "normal", "message_encoding": "utf-8",
        "draft_reminder_enabled": False, "sender_display_name": "", "reply_to_email": None,
        "vcard_enabled": False, "version": version, "created_at": datetime.now(UTC), "updated_at": datetime.now(UTC),
    }


class PreferenceCursor:
    def __init__(self, version: int = 1):
        self.row = preference_row(version)
        self.next_one = None
        self.executions: list[tuple[str, tuple]] = []
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append((normalized, tuple(params)))
        upper = normalized.upper()
        if upper.startswith("INSERT INTO USER_MAIL_BASIC_PREFERENCES"):
            if self.row is None: self.row = preference_row()
        elif upper.startswith("SELECT * FROM USER_MAIL_BASIC_PREFERENCES"):
            self.next_one = None if self.row is None else dict(self.row)
        elif upper.startswith("DELETE FROM USER_MAIL_BASIC_PREFERENCES"):
            self.row = None
        elif upper.startswith("UPDATE USER_MAIL_BASIC_PREFERENCES"):
            expected = params[-1] if "AND VERSION = %S" in upper else None
            if expected is not None and self.row and expected != self.row["version"]:
                self.next_one = None
                return
            if self.row:
                self.row["version"] += 1
                self.row["updated_at"] = datetime.now(UTC)
                self.next_one = dict(self.row)
    def fetchone(self):
        result, self.next_one = self.next_one, None
        return result


class PreferenceConnection:
    def __init__(self, cursor): self.cursor_value, self.commits = cursor, 0
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def cursor(self): return self.cursor_value
    def commit(self): self.commits += 1


class PreferenceDb:
    def __init__(self, version=1): self.cursor_value = PreferenceCursor(version); self.connection = PreferenceConnection(self.cursor_value)
    def ensure_migrations_applied(self): pass
    def connect(self): return self.connection


class Ui022MailBasicSettingsTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_026_is_idempotent_and_scoped(self):
        sql = (self.root / "migrations" / "026_mail_basic_preferences.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists user_mail_basic_preferences",
            "owner_user_id text primary key references users(id)",
            "company_id text not null references companies(id)",
            "version integer not null default 1",
            "add column if not exists sender_display_name",
            "add column if not exists reply_to_email",
            "add column if not exists message_encoding",
            "add column if not exists sender_copy_saved",
            "add column if not exists read_receipt_requested",
        ):
            self.assertIn(marker, sql)

    def test_preference_schema_defaults_and_header_injection(self):
        payload = MailBasicPreferencesUpdateRequest(expectedVersion=1)
        self.assertEqual(payload.messageEncoding, "utf-8")
        self.assertTrue(payload.confirmBeforeSend)
        self.assertTrue(payload.saveSentCopy)
        self.assertTrue(payload.readReceiptEnabled)
        self.assertEqual(payload.senderDisplayName, "")

        for field, value in (
            ("senderDisplayName", "safe\r\nBcc: victim@example.test"),
            ("replyToEmail", "safe@example.test\nCc: victim@example.test"),
            ("replyToEmail", "not-an-email"),
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                MailBasicPreferencesUpdateRequest(expectedVersion=1, **{field: value})

    def test_send_confirmation_is_part_of_request_contract(self):
        request = MailSendRequest(to=["to@example.test"], subject="제목", bodyText="본문")
        self.assertFalse(request.confirmed)
        confirmed = request.model_copy(update={"confirmed": True})
        self.assertTrue(confirmed.confirmed)

    def test_smtp_message_applies_snapshot_headers_and_charset_without_network(self):
        envelope = {
            "sender_email": "sender@example.test",
            "recipient_email": "to@example.invalid",
            "subject": "테스트",
            "body_text": "본문",
            "body_html": "<p>본문</p>",
            "sender_display_name": "홍길동",
            "reply_to_email": "reply@example.test",
            "message_encoding": "utf-8",
        }
        message = SmtpRelayAdapter().build_message(envelope, {})
        self.assertIsInstance(message, EmailMessage)
        self.assertIn("홍길동", str(message["From"]))
        self.assertEqual(str(message["Reply-To"]), "reply@example.test")
        self.assertEqual(message.get_body(preferencelist=("plain",)).get_content_charset(), "utf-8")
        self.assertEqual(message.get_body(preferencelist=("html",)).get_content_charset(), "utf-8")

    def test_api_service_and_ui_contract_are_present(self):
        route = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        service = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        ui = (self.root.parent / "frontend" / "user-web" / "src" / "App.tsx").read_text(encoding="utf-8")
        api = (self.root.parent / "frontend" / "user-web" / "src" / "api.ts").read_text(encoding="utf-8")

        for marker in ('@router.get("/preferences/basic"', '@router.put("/preferences/basic"', '@router.post("/preferences/basic/reset"'):
            self.assertIn(marker, route)
        for marker in ("expectedVersion", "company_id = %s", "owner_user_id = %s", "mail.preferences.basic.update"):
            self.assertIn(marker, service)
        for marker in ("기본환경", "서명", "메일함", "스팸", "자동분류", "자동전달", "부재중응답", "외부메일", "최근보낸메일"):
            self.assertIn(marker, ui)
        self.assertIn('/mail/preferences/basic', api)
        self.assertIn('const defaultApiBase = "/api/v1"', api)

    def test_reset_increments_version_and_stale_save_conflicts(self):
        service = MailMessengerService()
        service.db = PreferenceDb(version=1)
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자", userEmail="user@example.test")
        reset = service.reset_basic_preferences(actor)
        self.assertGreater(reset.version, 1)
        with self.assertRaises(MailPreferenceConflictError):
            service.update_basic_preferences(actor, MailBasicPreferencesUpdateRequest(expectedVersion=1))

    def test_every_summary_query_selects_sender_display_name(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        selected_names = re.findall(r"m\.sender_email\s*,\s*m\.sender_display_name", source)
        self.assertGreaterEqual(len(selected_names), 7)
        summary = MailMessengerService()._to_mail_summary({
            "mail_id": "m", "account_id": "a", "sender_email": "sender@example.test", "sender_display_name": "홍길동",
            "subject": "s", "status": "sent", "is_read": False, "is_starred": False, "sent_at": None,
            "received_at": None, "retention_expires_at": None, "attachment_count": 0,
        })
        self.assertEqual(summary.senderDisplayName, "홍길동")

    def test_recipient_input_modes_and_conflict_reload_are_operational_ui_contracts(self):
        ui = (self.root.parent / "frontend" / "user-web" / "src" / "App.tsx").read_text(encoding="utf-8")
        self.assertIn('recipientInputMode === "search"', ui)
        self.assertIn("조직·연락처 선택으로만", ui)
        self.assertIn("이름 또는 계정", ui)
        self.assertIn("reloadMailBasicSettings", ui)
        self.assertIn("서버 최신값 다시 불러오기", ui)


if __name__ == "__main__":
    unittest.main()
