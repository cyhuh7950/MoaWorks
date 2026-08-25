import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_transports import DeliveryReceipt, MailProviderRoutingAdapter, _build_message


class FakeSelfHostedTransport:
    def __init__(self) -> None:
        self.calls = []

    def send(
        self,
        message,
        *,
        helo_name: str,
        timeout_sec: int,
        dkim_config=None,
        relay_host: str = "",
        relay_port: int = 25,
        tls_mode: str = "opportunistic",
    ) -> DeliveryReceipt:
        self.calls.append((message, helo_name, timeout_sec, dkim_config, relay_host, relay_port, tls_mode))
        return DeliveryReceipt("self_hosted", f"smtp://{relay_host}:{relay_port}", True)


class FakeOciTransport:
    def __init__(self) -> None:
        self.calls = []

    def send(self, message, *, config) -> DeliveryReceipt:
        self.calls.append((message, config))
        return DeliveryReceipt("oci_email_delivery", "smtps://oci.example:587", True)


class FakeLegacyRelayAdapter:
    def __init__(self) -> None:
        self.calls = []

    def send(self, envelope, provider) -> str:
        self.calls.append((envelope, provider))
        return "relay accepted"


def envelope() -> dict:
    return {
        "queue_id": "queue-1",
        "sender_email": "admin@moaworks.sinsan.kr",
        "recipient_email": "person@example.net",
        "subject": "제목",
        "body_text": "본문",
        "body_html": None,
        "attachments": [],
        "message_id": "<mail-1@moaworks.sinsan.kr>",
    }


def provider(provider_type: str) -> dict:
    return {
        "provider_type": provider_type,
        "relay_host": "smtp.email.ap-seoul-1.oci.oraclecloud.com",
        "relay_port": 587,
        "username": "oci-user",
        "password": "plain-secret",
        "from_address": "admin@moaworks.sinsan.kr",
        "helo_name": "mail.moaworks.sinsan.kr",
        "timeout_sec": 20,
    }


class MailDeliveryRoutingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.self_transport = FakeSelfHostedTransport()
        self.oci_transport = FakeOciTransport()
        self.legacy_relay = FakeLegacyRelayAdapter()
        self.adapter = MailProviderRoutingAdapter(
            self_hosted_transport=self.self_transport,
            oci_transport=self.oci_transport,
            legacy_relay_adapter=self.legacy_relay,
        )

    def test_self_hosted_provider_passes_configured_relay_to_transport(self) -> None:
        detail = self.adapter.send(envelope(), provider("self_hosted"))

        self.assertEqual(len(self.self_transport.calls), 1)
        self.assertEqual(len(self.oci_transport.calls), 0)
        message, _, _, _, relay_host, relay_port, _ = self.self_transport.calls[0]
        self.assertEqual(message.envelope_from, "bounce+queue-1@moaworks.sinsan.kr")
        self.assertEqual(relay_host, "smtp.email.ap-seoul-1.oci.oraclecloud.com")
        self.assertEqual(relay_port, 587)
        self.assertIn("provider=self_hosted", detail)

    def test_legacy_self_hosted_key_remains_compatible(self) -> None:
        detail = self.adapter.send(envelope(), provider("self_hosted_smtp"))

        self.assertEqual(len(self.self_transport.calls), 1)
        self.assertIn("provider=self_hosted", detail)

    def test_oci_provider_uses_relay_without_exposing_password(self) -> None:
        detail = self.adapter.send(envelope(), provider("oci_email_delivery"))

        self.assertEqual(len(self.oci_transport.calls), 1)
        message, config = self.oci_transport.calls[0]
        self.assertEqual(message.envelope_from, "admin@moaworks.sinsan.kr")
        self.assertEqual(config.password, "plain-secret")
        self.assertNotIn("plain-secret", detail)

    def test_oci_provider_preserves_html_and_attachment_mime_parts(self) -> None:
        with TemporaryDirectory() as directory:
            attachment_path = Path(directory) / "report.txt"
            attachment_path.write_bytes(b"attachment-body")
            rich_envelope = {
                **envelope(),
                "body_html": "<p><strong>HTML body</strong></p>",
                "attachments": [{
                    "file_name": "report.txt",
                    "content_type": "text/plain",
                    "path": str(attachment_path),
                }],
            }

            self.adapter.send(rich_envelope, provider("oci_email_delivery"))

        message, _ = self.oci_transport.calls[0]
        self.assertEqual(message.body_html, "<p><strong>HTML body</strong></p>")
        self.assertEqual(len(message.attachments), 1)
        self.assertEqual(message.attachments[0].file_name, "report.txt")
        self.assertEqual(message.attachments[0].content, b"attachment-body")
        mime_message = _build_message(message)
        self.assertEqual(mime_message.get_body(preferencelist=("html",)).get_content().strip(), "<p><strong>HTML body</strong></p>")
        self.assertEqual([part.get_filename() for part in mime_message.iter_attachments()], ["report.txt"])
    def test_unknown_provider_is_rejected_without_fallback(self) -> None:
        with self.assertRaisesRegex(ValueError, "지원하지 않는 발신 Provider"):
            self.adapter.send(envelope(), provider("unknown"))

        self.assertEqual(len(self.self_transport.calls), 0)
        self.assertEqual(len(self.oci_transport.calls), 0)

    def test_existing_smtp_provider_remains_on_legacy_relay(self) -> None:
        detail = self.adapter.send(envelope(), provider("smtp"))

        self.assertEqual(detail, "relay accepted")
        self.assertEqual(len(self.legacy_relay.calls), 1)

    def test_delivery_worker_operations_use_provider_router_by_default(self) -> None:
        operations = MailDeliveryOperations()

        self.assertIsInstance(operations.adapter, MailProviderRoutingAdapter)


if __name__ == "__main__":
    unittest.main()
