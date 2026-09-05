import unittest

from app.services.mail_delivery_feedback import MailDeliveryFeedbackOperations, parse_delivery_feedback
from app.services.mail_delivery_service import MailDeliveryWorker
from app.services.mail_transports import (
    DkimPySigner,
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

    def mail(self, sender): self.from_addr=sender; return 250,b'ok'
    def rcpt(self, recipient): return 250,b'ok'
    def docmd(self, command): return 354,b'continue'
    def send(self, payload):
        from email.parser import BytesParser
        from email.policy import default
        import re
        self.message=BytesParser(policy=default).parsebytes(re.sub(br'(?m)^\.\.',b'.',payload[:-3]))
    def getreply(self): return 250,b'accepted'
    def quit(self): pass
    def close(self): pass


class FakeDkimSigner:
    def sign(self, message, config) -> None:
        message["DKIM-Signature"] = f"v=1; d={config.domain}; s={config.selector}; b=test"


class SuppressionGuardAdapter:
    def send(self, _envelope, _provider):
        raise AssertionError("suppressed recipient must not reach OCI adapter")


class FeedbackCursor:
    def __init__(self, *, duplicate=False) -> None:
        self.duplicate = duplicate
        self.row = None
        self.statements = []

    def execute(self, query, params=None) -> None:
        normalized = " ".join(query.split())
        self.statements.append((normalized, params))
        if normalized.startswith("INSERT INTO mail_delivery_feedback"):
            self.row = None if self.duplicate else {"id": "feedback-1"}
        elif normalized.startswith("UPDATE mail_delivery_queue"):
            self.row = {"company_id": "cmp-default"}
        else:
            self.row = None

    def fetchone(self):
        return self.row


class MailDeliveryFeedbackTest(unittest.TestCase):
    def test_production_dkim_signer_adds_signature_header(self) -> None:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from email.message import EmailMessage

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
        pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
        message = EmailMessage()
        message["From"] = "admin@moaworks.sinsan.kr"
        message["To"] = "person@example.net"
        message["Subject"] = "제목"
        message["Date"] = "Tue, 04 Aug 2026 12:00:00 +0000"
        message["Message-ID"] = "<mail-1@moaworks.sinsan.kr>"
        message.set_content("본문")

        DkimPySigner().sign(
            message,
            DkimSigningConfig("moaworks.sinsan.kr", "selector1", pem),
        )

        self.assertIn("d=moaworks.sinsan.kr", message["DKIM-Signature"])
        self.assertIn("s=selector1", message["DKIM-Signature"])

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

    def test_feedback_is_idempotent_and_updates_queue_with_audit(self) -> None:
        from datetime import UTC, datetime

        feedback = parse_delivery_feedback(
            envelope_recipient="bounce+delivery_abc@moaworks.sinsan.kr",
            raw_message=b"Action: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 user unknown\r\n",
        )
        cursor = FeedbackCursor()

        inserted = MailDeliveryFeedbackOperations.record(cursor, feedback, "mail/inbound/raw.eml", datetime.now(UTC))
        duplicate = MailDeliveryFeedbackOperations.record(
            FeedbackCursor(duplicate=True), feedback, "mail/inbound/raw.eml", datetime.now(UTC)
        )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertTrue(inserted)
        self.assertFalse(duplicate)
        self.assertIn("UPDATE mail_delivery_queue", statements)
        self.assertIn("INSERT INTO audit_logs", statements)

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

    def test_feedback_migration_keeps_dkim_key_encrypted_and_feedback_idempotent(self) -> None:
        from pathlib import Path

        sql = (Path(__file__).parent / "migrations" / "049_mail_delivery_feedback.sql").read_text(encoding="utf-8")
        self.assertIn("encrypted_dkim_private_key", sql)
        self.assertNotIn(" dkim_private_key TEXT", sql)
        self.assertIn("UNIQUE (queue_id, content_sha256)", sql)
        self.assertIn("mail_oci_suppressions", sql)


if __name__ == "__main__":
    unittest.main()
