import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.mail_inbound_operations import MailInboundOperations, MailInboundStorage, verify_ingest_token


def inbound_raw(*, infected: bool = False) -> bytes:
    message = EmailMessage()
    message["From"] = "sender@example.net"
    message["To"] = "admin@moaworks.sinsan.kr"
    message["Subject"] = "수신"
    message["Message-ID"] = "<inbound@example.net>"
    if infected:
        message["X-Virus-Status"] = "Infected"
    message.set_content("본문")
    message.add_attachment(b"file", maintype="application", subtype="octet-stream", filename="a.bin")
    return message.as_bytes()


class FakeCursor:
    def __init__(self, *, duplicate: bool = False) -> None:
        self.duplicate = duplicate
        self.last_row = None
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def execute(self, query, params=None) -> None:
        normalized = " ".join(query.split())
        self.statements.append((normalized, params))
        if normalized.startswith("SELECT u.id AS user_id"):
            self.last_row = {"user_id": "user-admin", "company_id": "cmp-default"}
        elif normalized.startswith("INSERT INTO mail_inbound_messages"):
            self.last_row = {
                "id": "inbound-existing" if self.duplicate else params[0],
                "mail_message_id": "mail-existing" if self.duplicate else None,
                "processing_status": "processed" if self.duplicate else "spooled",
            }
        elif normalized.startswith("SELECT id FROM mail_inbound_recipients"):
            self.last_row = {"id": "existing-recipient"} if self.duplicate else None
        else:
            self.last_row = None

    def fetchone(self):
        return self.last_row


class FakeConnection:
    def __init__(self, cursor) -> None:
        self.cursor_value = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def cursor(self):
        return self.cursor_value

    def commit(self) -> None:
        self.commits += 1


class FakeDb:
    def __init__(self, cursor) -> None:
        self.connection = FakeConnection(cursor)
        self.migrations_checked = False

    def ensure_migrations_applied(self) -> None:
        self.migrations_checked = True

    def connect(self):
        return self.connection


class MailInboundIngestTest(unittest.TestCase):
    def test_inbox_ingest_persists_message_recipient_attachment_and_audit(self) -> None:
        cursor = FakeCursor()
        db = FakeDb(cursor)
        with tempfile.TemporaryDirectory() as temporary:
            result = MailInboundOperations(
                db=db, storage=MailInboundStorage(Path(temporary))
            ).ingest(
                envelope_from="sender@example.net",
                recipient_email="admin@moaworks.sinsan.kr",
                raw_message=inbound_raw(),
            )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertEqual(result.disposition, "inbox")
        self.assertFalse(result.duplicate)
        self.assertIn("INSERT INTO mail_messages", statements)
        self.assertIn("INSERT INTO mail_recipients", statements)
        self.assertIn("INSERT INTO mail_attachments", statements)
        self.assertIn("INSERT INTO audit_logs", statements)
        self.assertTrue(db.migrations_checked)
        self.assertEqual(db.connection.commits, 1)

    def test_infected_message_is_quarantined_without_mailbox_delivery(self) -> None:
        cursor = FakeCursor()
        with tempfile.TemporaryDirectory() as temporary:
            result = MailInboundOperations(
                db=FakeDb(cursor), storage=MailInboundStorage(Path(temporary))
            ).ingest(
                envelope_from="sender@example.net",
                recipient_email="admin@moaworks.sinsan.kr",
                raw_message=inbound_raw(infected=True),
            )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertEqual(result.disposition, "quarantine")
        self.assertNotIn("INSERT INTO mail_messages", statements)
        self.assertIn("processing_status='quarantined'", statements)

    def test_duplicate_recipient_returns_without_creating_another_mailbox_row(self) -> None:
        cursor = FakeCursor(duplicate=True)
        with tempfile.TemporaryDirectory() as temporary:
            result = MailInboundOperations(
                db=FakeDb(cursor), storage=MailInboundStorage(Path(temporary))
            ).ingest(
                envelope_from="sender@example.net",
                recipient_email="admin@moaworks.sinsan.kr",
                raw_message=inbound_raw(),
            )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertTrue(result.duplicate)
        self.assertNotIn("INSERT INTO mail_messages", statements)

    def test_internal_route_rejects_missing_token_and_accepts_authenticated_raw_message(self) -> None:
        client = TestClient(app)
        headers = {
            "Content-Type": "message/rfc822",
            "X-MoaWorks-Envelope-From": "sender@example.net",
            "X-MoaWorks-Envelope-To": "admin@moaworks.sinsan.kr",
        }

        with patch.object(settings, "mail_ingest_token", "configured-token"):
            denied = client.post("/api/v1/internal/mail/ingest", content=b"raw", headers=headers)
            with patch("app.api.routes.mail_internal.MailInboundOperations") as operations:
                operations.return_value.ingest.return_value = SimpleNamespace(
                    inbound_id="inbound-1", disposition="inbox", duplicate=False
                )
                accepted = client.post(
                    "/api/v1/internal/mail/ingest",
                    content=b"raw",
                    headers={**headers, "X-MoaWorks-Ingest-Token": "configured-token"},
                )

        self.assertEqual(denied.status_code, 401)
        self.assertEqual(accepted.status_code, 202)
        self.assertEqual(accepted.json()["inboundId"], "inbound-1")

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
        self.assertIn('@router.post("/ingest"', route)
        self.assertIn("X-MoaWorks-Ingest-Token", route)
        self.assertIn("location ^~ /api/v1/internal/", user_nginx)
        self.assertIn("location ^~ /api/v1/internal/", admin_nginx)


if __name__ == "__main__":
    unittest.main()
