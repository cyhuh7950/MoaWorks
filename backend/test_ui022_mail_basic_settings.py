from __future__ import annotations

from email.message import EmailMessage
from pathlib import Path
import unittest

from pydantic import ValidationError

from app.schemas.mail_messenger import MailBasicPreferencesUpdateRequest, MailSendRequest
from app.services.mail_delivery_service import SmtpRelayAdapter


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


if __name__ == "__main__":
    unittest.main()
