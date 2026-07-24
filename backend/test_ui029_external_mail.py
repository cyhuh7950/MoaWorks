import unittest
from email.message import EmailMessage

from app.services.mail_external_service import (
    ExternalMailInvalidEndpointError,
    ExternalMailRateLimitedError,
    ExternalMailSecretRequiredError,
    MailExternalEndpointValidator,
    MailExternalPop3Client,
    MailExternalService,
    parse_external_message,
)


class _Security:
    def encrypt_secret(self, value): return "encrypted:" + value
    def decrypt_secret(self, value): return value.removeprefix("encrypted:")


class _Pop3:
    def __init__(self): self.calls = []
    def user(self, value): self.calls.append(("USER", value))
    def pass_(self, value): self.calls.append(("PASS", "***"))
    def uidl(self): self.calls.append(("UIDL",)); return "+OK", [b"1 uid-1"], 10
    def quit(self): self.calls.append(("QUIT",)); return b"+OK"


class Ui029ExternalMailTests(unittest.TestCase):
    def test_endpoint_rejects_url_ip_local_and_private_dns(self):
        for host in ("https://mail.example.com", "127.0.0.1", "localhost", "mail.local"):
            with self.subTest(host=host), self.assertRaises(ExternalMailInvalidEndpointError):
                MailExternalEndpointValidator(lambda _: ["203.0.113.10"]).validate(host, 995, "ssl")
        with self.assertRaises(ExternalMailInvalidEndpointError):
            MailExternalEndpointValidator(lambda _: ["10.0.0.2"]).validate("mail.example.com", 995, "ssl")

    def test_endpoint_allows_only_tls_port_pairs_and_all_public_dns(self):
        validator = MailExternalEndpointValidator(lambda _: ["8.8.8.8", "1.1.1.1"])
        self.assertEqual(validator.validate("POP.Example.COM.", 995, "ssl"), "pop.example.com")
        with self.assertRaises(ExternalMailInvalidEndpointError): validator.validate("mail.example.com", 110, "ssl")
        with self.assertRaises(ExternalMailInvalidEndpointError): validator.validate("mail.example.com", 995, "starttls")
        with self.assertRaises(ExternalMailInvalidEndpointError): validator.validate("mail.example.com", 143, "starttls")

    def test_connection_test_authenticates_and_uidl_without_retr_or_dele(self):
        fake = _Pop3()
        result = MailExternalPop3Client(lambda *_: fake).test("mail.example.com", 995, "ssl", "owner", "secret")
        self.assertEqual(result, "success")
        self.assertEqual([call[0] for call in fake.calls], ["USER", "PASS", "UIDL", "QUIT"])

    def test_secret_is_required_and_response_is_write_only(self):
        service = MailExternalService(security=_Security())
        with self.assertRaises(ExternalMailSecretRequiredError): service.prepare_secret(None, None)
        encrypted = service.prepare_secret("secret", None)
        self.assertEqual(encrypted, "encrypted:secret")
        self.assertEqual(service.prepare_secret("", encrypted), encrypted)
        view = service.account_view({"encrypted_password": encrypted, "id": "external_1"})
        self.assertNotIn("encrypted_password", view)
        self.assertNotIn("password", view)
        self.assertTrue(view["passwordConfigured"])

    def test_connection_change_resets_test_and_enabled(self):
        service = MailExternalService(security=_Security())
        old = {"host": "mail.example.com", "port": 995, "tls_mode": "ssl", "username": "a", "encrypted_password": "encrypted:one"}
        reset = service.connection_state(old, {**old, "host": "pop.example.com"}, password_changed=False)
        self.assertEqual(reset, {"connection_status": "untested", "enabled": False})
        self.assertEqual(service.connection_state(old, dict(old), password_changed=False), {})

    def test_test_rate_limit_uses_account_timestamp(self):
        from datetime import UTC, datetime, timedelta
        service = MailExternalService(security=_Security())
        now = datetime.now(UTC)
        with self.assertRaises(ExternalMailRateLimitedError): service.enforce_test_rate(now - timedelta(seconds=29), now)
        service.enforce_test_rate(now - timedelta(seconds=30), now)

    def test_mime_parser_prefers_plain_and_normalizes_attachment_name(self):
        msg = EmailMessage(); msg["Subject"] = "외부 제목"; msg["From"] = "Sender <sender@example.net>"; msg["To"] = "owner@example.com"
        msg.set_content("plain body"); msg.add_alternative("<p>html body</p>", subtype="html")
        msg.add_attachment(b"data", maintype="application", subtype="octet-stream", filename="../unsafe.txt")
        parsed = parse_external_message(msg.as_bytes())
        self.assertEqual(parsed.subject, "외부 제목")
        self.assertEqual(parsed.body_text.strip(), "plain body")
        self.assertEqual(parsed.attachments[0].filename, "unsafe.txt")
        self.assertFalse(parsed.read_receipt_requested)
        self.assertFalse(parsed.sender_copy_saved)

    def test_local_commit_happens_before_remote_delete(self):
        calls = []
        service = MailExternalService(security=_Security())
        service.persist_then_delete(lambda: calls.append("local_commit"), lambda: calls.append("DELE"), True)
        self.assertEqual(calls, ["local_commit", "DELE"])
        calls.clear(); service.persist_then_delete(lambda: calls.append("local_commit"), lambda: calls.append("DELE"), False)
        self.assertEqual(calls, ["local_commit"])


if __name__ == "__main__": unittest.main()
