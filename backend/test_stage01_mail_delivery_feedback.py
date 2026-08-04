import unittest

from app.services.mail_delivery_feedback import parse_delivery_feedback
from app.services.mail_delivery_service import MailDeliveryWorker
from app.services.mail_transports import (
    DkimSigningConfig,
    OutboundMessage,
    SelfHostedSmtpTransport,
)


class FakeSmtp:
    def __init__(self) -> None:
        self.from_addr = None
        self.message = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def ehlo(self, _name=None):
        return None

    def has_extn(self, _name):
        return False

    def send_message(self, message, *, from_addr, to_addrs):
        self.from_addr = from_addr
        self.message = message
        return {}


class FakeDkimSigner:
    def sign(self, message, config) -> None:
        message["DKIM-Signature"] = f"v=1; d={config.domain}; s={config.selector}; b=test"


class SuppressionGuardAdapter:
    def send(self, _envelope, _provider):
        raise AssertionError("suppressed recipient must not reach OCI adapter")


class MailDeliveryFeedbackTest(unittest.TestCase):
    def test_self_hosted_uses_verp_envelope_from_and_dkim_without_changing_from_header(self) -> None:
        smtp = FakeSmtp()
        transport = SelfHostedSmtpTransport(
            mx_resolver=lambda _domain: ["mx.example.net"],
            smtp_factory=lambda **_: smtp,
            dkim_signer=FakeDkimSigner(),
        )
        message = OutboundMessage(
            sender_email="admin@moaworks.sinsan.kr",
            recipient_email="person@example.net",
            subject="제목",
            body_text="본문",
            body_html=None,
            message_id="<mail-1@moaworks.sinsan.kr>",
            envelope_from="bounce+delivery_abc@moaworks.sinsan.kr",
        )

        transport.send(
            message,
            helo_name="mail.moaworks.sinsan.kr",
            timeout_sec=10,
            dkim_config=DkimSigningConfig(
                domain="moaworks.sinsan.kr", selector="selector1", private_key=b"private-key"
            ),
        )

        self.assertEqual(smtp.from_addr, "bounce+delivery_abc@moaworks.sinsan.kr")
        self.assertEqual(smtp.message["From"], "admin@moaworks.sinsan.kr")
        self.assertIn("d=moaworks.sinsan.kr", smtp.message["DKIM-Signature"])

    def test_dsn_feedback_correlates_verp_queue_and_status(self) -> None:
        feedback = parse_delivery_feedback(
            envelope_recipient="bounce+delivery_abc@moaworks.sinsan.kr",
            raw_message=(
                b"Content-Type: multipart/report; report-type=delivery-status\r\n"
                b"Subject: Delivery Status Notification\r\n\r\n"
                b"Final-Recipient: rfc822; person@example.net\r\n"
                b"Action: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 user unknown\r\n"
            ),
        )

        self.assertEqual(feedback.queue_id, "delivery_abc")
        self.assertEqual(feedback.action, "failed")
        self.assertEqual(feedback.status_code, "5.1.1")
        self.assertNotIn("person@example.net", feedback.diagnostic)

    def test_oci_suppressed_recipient_is_blocked_before_adapter(self) -> None:
        job = {
            "attempt_count": 0,
            "recipient_email": "person@example.net",
            "recipient_suppressed": True,
            "delivery_kind": "direct",
            "sender_email": "admin@moaworks.sinsan.kr",
            "subject": "제목",
            "body_text": "본문",
            "body_html": None,
            "attachments": [],
        }
        provider = {
            "provider_type": "oci_email_delivery",
            "delivery_enabled": True,
            "last_test_status": "success",
        }

        result = MailDeliveryWorker("worker-1", SuppressionGuardAdapter()).deliver_claimed(job, provider)

        self.assertEqual(result.status, "blocked")
        self.assertIn("suppression", result.error_message.lower())


if __name__ == "__main__":
    unittest.main()
