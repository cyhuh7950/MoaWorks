import smtplib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import dns.resolver

from app.services.mail_mime_builder import OutboundMessage
from app.services.mail_transports import (
    OciEmailDeliveryTransport,
    MailTransportFailure,
    RelaySmtpConfig,
    SelfHostedSmtpTransport,
    resolve_mx_hosts,
)


class FakeSmtp:
    def __init__(self, *, auth_error: bool = False, starttls_available: bool = True) -> None:
        self.auth_error = auth_error
        self.starttls_available = starttls_available
        self.calls: list[tuple[str, object]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def ehlo(self, name: str | None = None) -> None:
        self.calls.append(("ehlo", name))

    def has_extn(self, name: str) -> bool:
        return name.lower() == "starttls" and self.starttls_available

    def starttls(self, context=None) -> None:
        self.calls.append(("starttls", context is not None))

    def login(self, username: str, password: str) -> None:
        self.calls.append(("login", username))
        if self.auth_error:
            raise smtplib.SMTPAuthenticationError(535, b"secret rejected")

    def mail(self, sender): self.calls.append(('mail',sender)); return 250,b'ok'
    def rcpt(self, recipient): self.calls.append(('rcpt',recipient)); return 250,b'ok'
    def docmd(self, command): self.calls.append((command,None)); return 354,b'continue'
    def send(self, payload): self.calls.append(('data',payload))
    def getreply(self): return 250,b'accepted'
    def quit(self): pass
    def close(self): pass


def sample_message() -> OutboundMessage:
    return OutboundMessage(
        sender_email="admin@moaworks.sinsan.kr",
        recipient_email="person@example.net",
        subject="테스트",
        body_text="본문",
        body_html="<p>본문</p>",
        message_id="<mail-1@moaworks.sinsan.kr>",
    )


class MailTransportTest(unittest.TestCase):
    @patch("dns.resolver.resolve")
    def test_mx_resolver_orders_hosts_by_preference(self, resolver) -> None:
        resolver.return_value = [
            SimpleNamespace(preference=20, exchange="mx2.example.net."),
            SimpleNamespace(preference=10, exchange="mx1.example.net."),
        ]

        self.assertEqual(resolve_mx_hosts("Example.NET."), ["mx1.example.net", "mx2.example.net"])
        resolver.assert_called_once_with("example.net", "MX", lifetime=10)

    @patch("dns.resolver.resolve", side_effect=dns.resolver.NoAnswer)
    def test_mx_resolver_uses_implicit_mx_when_record_is_absent(self, _resolver) -> None:
        self.assertEqual(resolve_mx_hosts("example.net"), ["example.net"])

    @patch("dns.resolver.resolve", side_effect=dns.resolver.NXDOMAIN)
    def test_mx_resolver_rejects_nonexistent_domain(self, _resolver) -> None:
        self.assertEqual(resolve_mx_hosts("missing.example"), [])

    def test_self_hosted_resolves_mx_and_uses_opportunistic_starttls(self) -> None:
        smtp = FakeSmtp()
        calls: list[tuple[str, int, int]] = []

        def factory(*, host: str, port: int, timeout: int):
            calls.append((host, port, timeout))
            return smtp

        transport = SelfHostedSmtpTransport(
            mx_resolver=lambda domain: ["mx1.example.net"],
            smtp_factory=factory,
        )

        receipt = transport.send(sample_message(), helo_name="mail.moaworks.sinsan.kr", timeout_sec=15)

        self.assertEqual(calls, [("mx1.example.net", 25, 15)])
        self.assertIn(("starttls", True), smtp.calls)
        self.assertTrue(receipt.remote_smtp_accepted)
        self.assertEqual(receipt.provider_key, "self_hosted")

    def test_self_hosted_uses_configured_wsl_relay_instead_of_recipient_mx(self) -> None:
        smtp = FakeSmtp()
        calls: list[tuple[str, int, int]] = []

        def factory(*, host: str, port: int, timeout: int):
            calls.append((host, port, timeout))
            return smtp

        transport = SelfHostedSmtpTransport(
            mx_resolver=lambda _domain: self.fail("WSL relay 설정 시 수신자 MX를 조회하면 안 됩니다."),
            smtp_factory=factory,
        )

        receipt = transport.send(
            sample_message(),
            helo_name="mail.moaworks.sinsan.kr",
            timeout_sec=20,
            relay_host="mail.dev.moaworks.sinsan.kr",
            relay_port=2525,
            tls_mode="starttls",
            username="sinsan-submit",
            password="submission-secret",
        )

        self.assertEqual(calls, [("mail.dev.moaworks.sinsan.kr", 2525, 20)])
        self.assertIn(("starttls", True), smtp.calls)
        self.assertLess(smtp.calls.index(("starttls", True)), smtp.calls.index(("login", "sinsan-submit")))
        send_index = next(index for index, call in enumerate(smtp.calls) if call[0] == "data")
        self.assertLess(smtp.calls.index(("login", "sinsan-submit")), send_index)
        self.assertEqual(receipt.endpoint, "smtp://mail.dev.moaworks.sinsan.kr:2525")

    def test_self_hosted_authentication_error_does_not_expose_password(self) -> None:
        smtp = FakeSmtp(auth_error=True)
        transport = SelfHostedSmtpTransport(
            mx_resolver=lambda _domain: self.fail("인증 릴레이 설정 시 수신자 MX를 조회하면 안 됩니다."),
            smtp_factory=lambda **_: smtp,
        )

        with self.assertRaisesRegex(MailTransportFailure, "SMTP 명시 응답 거부") as raised:
            transport.send(
                sample_message(),
                helo_name="mail.moaworks.sinsan.kr",
                timeout_sec=20,
                relay_host="mail.dev.moaworks.sinsan.kr",
                relay_port=2525,
                tls_mode="starttls",
                username="sinsan-submit",
                password="submission-secret",
            )

        self.assertNotIn("submission-secret", str(raised.exception))
        self.assertFalse(raised.exception.transient)

    def test_oci_relay_requires_tls_and_authenticates(self) -> None:
        smtp = FakeSmtp()
        calls: list[tuple[str, int, int]] = []

        def factory(*, host: str, port: int, timeout: int):
            calls.append((host, port, timeout))
            return smtp

        transport = OciEmailDeliveryTransport(smtp_factory=factory)
        config = RelaySmtpConfig(
            host="smtp.email.ap-seoul-1.oci.oraclecloud.com",
            port=587,
            username="oci-user",
            password="top-secret",
            timeout_sec=20,
        )

        receipt = transport.send(sample_message(), config=config)

        self.assertEqual(calls, [(config.host, 587, 20)])
        self.assertIn(("starttls", True), smtp.calls)
        self.assertIn(("login", "oci-user"), smtp.calls)
        self.assertEqual(receipt.provider_key, "oci_email_delivery")

    def test_oci_authentication_error_does_not_expose_password(self) -> None:
        smtp = FakeSmtp(auth_error=True)
        transport = OciEmailDeliveryTransport(smtp_factory=lambda **_: smtp)
        config = RelaySmtpConfig(
            host="smtp.email.ap-seoul-1.oci.oraclecloud.com",
            port=587,
            username="oci-user",
            password="top-secret",
            timeout_sec=20,
        )

        with self.assertRaisesRegex(ValueError, "SMTP 명시 응답 거부") as raised:
            transport.send(sample_message(), config=config)

        self.assertNotIn("top-secret", str(raised.exception))

    def test_oci_requires_supported_tls_port(self) -> None:
        transport = OciEmailDeliveryTransport()
        config = RelaySmtpConfig(
            host="smtp.example.net", port=25, username="user", password="secret"
        )

        with self.assertRaises(MailTransportFailure) as raised:
            transport.send(sample_message(), config=config)

        self.assertFalse(raised.exception.transient)

    def test_oci_missing_starttls_is_permanent_failure(self) -> None:
        smtp = FakeSmtp(starttls_available=False)
        transport = OciEmailDeliveryTransport(smtp_factory=lambda **_: smtp)
        config = RelaySmtpConfig(
            host="smtp.example.net", port=587, username="user", password="secret"
        )

        with self.assertRaises(MailTransportFailure) as raised:
            transport.send(sample_message(), config=config)

        self.assertFalse(raised.exception.transient)


if __name__ == "__main__":
    unittest.main()
