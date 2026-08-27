from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from app.services.mail_delivery_service import (
    MailDeliveryPolicy,
    MailDeliveryWorker,
    RelayDeliveryError,
    mask_delivery_error,
)
from app.services.mail_mime_builder import build_mail_message
from app.services.mail_transports import DeliveryReceipt, MailProviderRoutingAdapter


class CaptureTransport:
    def __init__(self, provider_key):
        self.provider_key, self.calls = provider_key, []

    def send(self, message, **kwargs):
        self.calls.append((build_mail_message(message), kwargs))
        return DeliveryReceipt(self.provider_key, "smtp://test.invalid:25", True)


class Adapter:
    def __init__(self, error=None):
        self.error, self.calls = error, []

    def send(self, envelope, provider):
        self.calls.append(envelope)
        if self.error:
            raise self.error
        return "accepted"


class Ui021Tests(unittest.TestCase):
    root = Path(__file__).parent

    def test_contract(self):
        sql = (
            (self.root / "migrations/025_mail_delivery_queue.sql")
            .read_text(encoding="utf-8")
            .lower()
        )
        for m in (
            "delivery_enabled boolean not null default false",
            "create table if not exists mail_delivery_queue",
            "create table if not exists mail_delivery_attempts",
            "create table if not exists mail_delivery_worker_heartbeats",
            "unique (mail_id, recipient_id)",
            "on delete cascade",
            "idx_mail_delivery_queue_claim",
        ):
            self.assertIn(m, sql)
        admin = (self.root / "app/api/routes/admin.py").read_text(encoding="utf-8")
        schema = (self.root / "app/schemas/mail_messenger.py").read_text(
            encoding="utf-8"
        )
        compose = (self.root.parent / "deploy/docker-compose.yml").read_text(
            encoding="utf-8"
        )
        api = (self.root.parent / "frontend/admin-web/src/api.ts").read_text(
            encoding="utf-8"
        )
        for m in (
            "/mail-delivery/status",
            "/mail-delivery/queue",
            "/mail-delivery/provider/test",
        ):
            self.assertIn(m, admin)
        self.assertIn("externalDeliveries", schema)
        self.assertIn("app.workers.mail_delivery_worker", compose)
        self.assertIn('const defaultApiBase = "/api/v1"', api)

    def test_policy_worker_and_masking(self):
        result = MailDeliveryPolicy().classify(
            "moaworks.test",
            {"inside@moaworks.test": "u1"},
            [("to", "inside@moaworks.test"), ("cc", "outside@example.invalid")],
        )
        self.assertEqual(len(result.internal), 1)
        self.assertEqual(len(result.external), 1)
        with self.assertRaises(ValueError):
            MailDeliveryPolicy().classify(
                "moaworks.test", {}, [("to", "missing@moaworks.test")]
            )
        job = {
            "queue_id": "q1",
            "attempt_count": 0,
            "recipient_email": "outside@example.invalid",
            "sender_email": "sender@moaworks.test",
            "subject": "s",
            "body_text": "b",
            "body_html": None,
        }
        adapter = Adapter()
        self.assertEqual(
            MailDeliveryWorker("w", adapter)
            .deliver_claimed(
                job, {"delivery_enabled": False, "last_test_status": "success"}
            )
            .status,
            "blocked",
        )
        self.assertEqual(adapter.calls, [])
        provider = {
            "delivery_enabled": True,
            "last_test_status": "success",
            "max_retry_count": 2,
            "retry_interval_sec": 10,
        }
        self.assertEqual(
            MailDeliveryWorker("w", Adapter()).deliver_claimed(job, provider).status,
            "sent",
        )
        retry = MailDeliveryWorker(
            "w", Adapter(RelayDeliveryError("token=secret", True))
        ).deliver_claimed(job, provider)
        self.assertEqual(retry.status, "retry_pending")
        self.assertNotIn("secret", retry.error_message or "")
        self.assertNotIn(
            "hunter2", mask_delivery_error("password=hunter2 user@example.com")
        )

    def test_queued_cid_job_reaches_worker_routing_and_mime_for_self_hosted_and_oci(
        self,
    ):
        """Break caught: a queued CID job loses attachment state before worker routing/MIME assembly."""
        with TemporaryDirectory() as directory:
            inline_path = Path(directory) / "inline.png"
            inline_path.write_bytes(b"png")
            file_path = Path(directory) / "report.txt"
            file_path.write_bytes(b"report")
            self_hosted = CaptureTransport("self_hosted")
            oci = CaptureTransport("oci_email_delivery")
            adapter = MailProviderRoutingAdapter(
                self_hosted_transport=self_hosted, oci_transport=oci
            )
            job = {
                "mail_id": "mail-1",
                "queue_id": "queue-1",
                "attempt_count": 0,
                "sender_email": "sender@moaworks.sinsan.kr",
                "recipient_email": "person@example.net",
                "subject": "CID",
                "body_text": "plain",
                "body_html": '<img src="cid:cid-1@moaworks.invalid">',
                "attachments": [
                    {
                        "path": str(inline_path),
                        "file_name": "inline.png",
                        "content_type": "image/png",
                        "size_bytes": 3,
                        "content_disposition": "inline",
                        "content_id": "cid-1@moaworks.invalid",
                    },
                    {
                        "path": str(file_path),
                        "file_name": "report.txt",
                        "content_type": "text/plain",
                        "size_bytes": 6,
                        "content_disposition": "attachment",
                        "content_id": None,
                    },
                ],
            }
            for provider_type in ("self_hosted", "oci_email_delivery"):
                provider = {
                    "provider_type": provider_type,
                    "from_address": "sender@moaworks.sinsan.kr",
                    "password": "test-only",
                    "relay_host": "smtp.test.invalid",
                    "relay_port": 587,
                    "delivery_enabled": True,
                    "last_test_status": "success",
                }
                self.assertEqual(
                    MailDeliveryWorker("worker-1", adapter)
                    .deliver_claimed(job, provider)
                    .status,
                    "sent",
                )
            for message, _kwargs in (self_hosted.calls[0], oci.calls[0]):
                self.assertEqual(message.get_content_type(), "multipart/mixed")
                self.assertTrue(
                    any(
                        part.get("Content-ID") == "<cid-1@moaworks.invalid>"
                        and part.get_content_disposition() == "inline"
                        for part in message.walk()
                    )
                )
                self.assertTrue(
                    any(
                        part.get_filename() == "report.txt"
                        and part.get_content_disposition() == "attachment"
                        for part in message.walk()
                    )
                )


if __name__ == "__main__":
    unittest.main()
