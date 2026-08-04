import unittest

from app.services.mail_delivery_service import MailDeliveryWorker
from app.services.mail_transports import MailTransportFailure, SelfHostedSmtpTransport


def job() -> dict:
    return {
        "attempt_count": 0,
        "delivery_kind": "direct",
        "sender_email": "admin@moaworks.sinsan.kr",
        "recipient_email": "person@example.net",
        "subject": "제목",
        "body_text": "본문",
        "body_html": None,
        "attachments": [],
    }


def provider() -> dict:
    return {
        "delivery_enabled": True,
        "last_test_status": "success",
        "max_retry_count": 3,
        "retry_interval_sec": 60,
    }


class FailingAdapter:
    def __init__(self, *, transient: bool) -> None:
        self.transient = transient

    def send(self, _envelope, _provider) -> str:
        raise MailTransportFailure("smtp failure", transient=self.transient)


class MailDeliveryFailureTest(unittest.TestCase):
    def test_transient_transport_failure_is_scheduled_for_retry(self) -> None:
        result = MailDeliveryWorker("worker-1", FailingAdapter(transient=True)).deliver_claimed(job(), provider())

        self.assertEqual(result.status, "retry_pending")
        self.assertIsNotNone(result.next_attempt_at)

    def test_permanent_transport_failure_is_not_cross_provider_retried(self) -> None:
        result = MailDeliveryWorker("worker-1", FailingAdapter(transient=False)).deliver_claimed(job(), provider())

        self.assertEqual(result.status, "failed")
        self.assertIsNone(result.next_attempt_at)

    def test_missing_mx_is_a_permanent_delivery_failure(self) -> None:
        transport = SelfHostedSmtpTransport(mx_resolver=lambda _domain: [])

        from app.services.mail_transports import OutboundMessage
        message = OutboundMessage(
            sender_email="admin@moaworks.sinsan.kr",
            recipient_email="person@example.net",
            subject="제목",
            body_text="본문",
            body_html=None,
            message_id="<mail-1@moaworks.sinsan.kr>",
        )
        with self.assertRaises(MailTransportFailure) as raised:
            transport.send(message, helo_name="mail.moaworks.sinsan.kr", timeout_sec=10)

        self.assertFalse(raised.exception.transient)


if __name__ == "__main__":
    unittest.main()
