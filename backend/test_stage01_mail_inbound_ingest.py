import tempfile
import unittest
from pathlib import Path

from app.services.mail_inbound_operations import MailInboundStorage, verify_ingest_token


class MailInboundIngestTest(unittest.TestCase):
    def test_internal_token_is_required_and_compared_exactly(self) -> None:
        verify_ingest_token("configured-token", "configured-token")

        for supplied in ("", "configured", "configured-token-extra"):
            with self.subTest(supplied=supplied):
                with self.assertRaises(PermissionError):
                    verify_ingest_token(supplied, "configured-token")

    def test_raw_and_attachments_are_written_under_content_addressed_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            storage = MailInboundStorage(Path(temporary))

            raw_key = storage.store_raw("a" * 64, b"raw-message")
            same_key = storage.store_raw("a" * 64, b"raw-message")
            attachment_key = storage.store_attachment("a" * 64, 0, b"payload")

            self.assertEqual(raw_key, same_key)
            self.assertEqual(Path(temporary, raw_key).read_bytes(), b"raw-message")
            self.assertEqual(Path(temporary, attachment_key).read_bytes(), b"payload")
            self.assertNotIn("..", raw_key)

    def test_ingest_contract_persists_mailbox_and_audit_with_idempotency(self) -> None:
        source = (Path(__file__).parent / "app" / "services" / "mail_inbound_operations.py").read_text(encoding="utf-8")
        route = (Path(__file__).parent / "app" / "api" / "routes" / "mail_internal.py").read_text(encoding="utf-8")
        user_nginx = (Path(__file__).parents[1] / "deploy" / "user-web.nginx.conf").read_text(encoding="utf-8")
        admin_nginx = (Path(__file__).parents[1] / "deploy" / "admin-web.nginx.conf").read_text(encoding="utf-8")

        self.assertIn("ON CONFLICT (company_id, content_sha256)", source)
        self.assertIn("INSERT INTO mail_messages", source)
        self.assertIn("INSERT INTO mail_recipients", source)
        self.assertIn("INSERT INTO mail_attachments", source)
        self.assertIn("INSERT INTO audit_logs", source)
        self.assertIn('@router.post("/ingest")', route)
        self.assertIn("X-MoaWorks-Ingest-Token", route)
        self.assertIn("location ^~ /api/v1/internal/", user_nginx)
        self.assertIn("location ^~ /api/v1/internal/", admin_nginx)


if __name__ == "__main__":
    unittest.main()
