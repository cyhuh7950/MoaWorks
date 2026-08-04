import unittest

from app.services.mail_delivery_service import MailDeliveryService
from app.services.mail_transports import DeliveryReceipt


class FakeSelfHostedTransport:
    def __init__(self) -> None:
        self.calls = []

    def send(self, message, *, helo_name: str, timeout_sec: int) -> DeliveryReceipt:
        self.calls.append((message, helo_name, timeout_sec))
        return DeliveryReceipt("self_hosted", "smtp://mx.example.net:25", True)


class FakeOciTransport:
    def __init__(self) -> None:
        self.calls = []

    def send(self, message, *, config) -> DeliveryReceipt:
        self.calls.append((message, config))
        return DeliveryReceipt("oci_email_delivery", "smtps://oci.example:587", True)


class FakeSecurity:
    def __init__(self) -> None:
        self.values = []

    def decrypt_secret(self, value: str) -> str:
        self.values.append(value)
        return "plain-secret"


def queue_row(provider_key: str) -> dict:
    return {
        "id": "queue-1",
        "mail_id": "mail-1",
        "provider_key": provider_key,
        "sender_email": "admin@moaworks.sinsan.kr",
        "recipient_email": "person@example.net",
        "subject": "제목",
        "body_text": "본문",
        "body_html": None,
        "helo_name": "mail.moaworks.sinsan.kr",
        "timeout_sec": 20,
        "smtp_host": "smtp.email.ap-seoul-1.oci.oraclecloud.com",
        "smtp_port": 587,
        "smtp_username": "oci-user",
        "encrypted_password": "cipher-text",
    }


class MailDeliveryRoutingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.self_transport = FakeSelfHostedTransport()
        self.oci_transport = FakeOciTransport()
        self.security = FakeSecurity()
        self.service = MailDeliveryService(
            self_hosted_transport=self.self_transport,
            oci_transport=self.oci_transport,
            security=self.security,
        )

    def test_self_hosted_queue_uses_self_hosted_transport(self) -> None:
        detail = self.service._send_via_provider(queue_row("self_hosted"))

        self.assertEqual(len(self.self_transport.calls), 1)
        self.assertEqual(len(self.oci_transport.calls), 0)
        self.assertIn("provider=self_hosted", detail)

    def test_legacy_self_hosted_key_remains_compatible(self) -> None:
        detail = self.service._send_via_provider(queue_row("self_hosted_smtp"))

        self.assertEqual(len(self.self_transport.calls), 1)
        self.assertIn("provider=self_hosted", detail)

    def test_oci_queue_decrypts_secret_only_at_send_time(self) -> None:
        detail = self.service._send_via_provider(queue_row("oci_email_delivery"))

        self.assertEqual(self.security.values, ["cipher-text"])
        self.assertEqual(len(self.oci_transport.calls), 1)
        _, config = self.oci_transport.calls[0]
        self.assertEqual(config.password, "plain-secret")
        self.assertNotIn("plain-secret", detail)
        self.assertNotIn("cipher-text", detail)

    def test_unknown_provider_is_rejected_without_fallback(self) -> None:
        with self.assertRaisesRegex(ValueError, "지원하지 않는 발신 Provider"):
            self.service._send_via_provider(queue_row("unknown"))

        self.assertEqual(len(self.self_transport.calls), 0)
        self.assertEqual(len(self.oci_transport.calls), 0)


if __name__ == "__main__":
    unittest.main()
