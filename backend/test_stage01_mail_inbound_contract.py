import unittest
from email.message import EmailMessage
from pathlib import Path

from app.services.mail_inbound_service import (
    classify_inbound_security,
    parse_inbound_message,
)


def raw_message(*, spam: bool = False, infected: bool = False) -> bytes:
    message = EmailMessage()
    message["From"] = "외부 발신자 <sender@example.net>"
    message["To"] = "admin@moaworks.sinsan.kr"
    message["Subject"] = "외부 수신 테스트"
    message["Message-ID"] = "<external-1@example.net>"
    message["Authentication-Results"] = "mail.moaworks.sinsan.kr; spf=pass; dkim=pass; dmarc=pass"
    if spam:
        message["X-Spam"] = "Yes"
        message["X-Spamd-Result"] = "default: True [8.20 / 6.00]"
    if infected:
        message["X-Virus-Status"] = "Infected"
    message.set_content("일반 텍스트 본문")
    message.add_alternative("<p>HTML 본문</p>", subtype="html")
    message.add_attachment(b"attachment-data", maintype="application", subtype="octet-stream", filename="자료.bin")
    return message.as_bytes()


class MailInboundContractTest(unittest.TestCase):
    def test_parses_korean_multipart_and_attachment_without_losing_raw_identity(self) -> None:
        raw = raw_message()

        parsed = parse_inbound_message(raw)

        self.assertEqual(parsed.message_id, "<external-1@example.net>")
        self.assertEqual(parsed.sender_email, "sender@example.net")
        self.assertEqual(parsed.sender_display_name, "외부 발신자")
        self.assertEqual(parsed.subject, "외부 수신 테스트")
        self.assertEqual(parsed.body_text.strip(), "일반 텍스트 본문")
        self.assertIn("HTML 본문", parsed.body_html or "")
        self.assertEqual(parsed.attachments[0].file_name, "자료.bin")
        self.assertEqual(parsed.attachments[0].content, b"attachment-data")
        self.assertEqual(len(parsed.content_sha256), 64)

    def test_embeds_safe_cid_image_in_html_body(self) -> None:
        message = EmailMessage()
        message["From"] = "sender@example.net"
        message["To"] = "admin@moaworks.sinsan.kr"
        message["Subject"] = "CID 이미지"
        message.set_content("이미지 본문")
        message.add_alternative('<p>본문</p><img src="cid:logo@example.net">', subtype="html")
        html_part = message.get_payload()[1]
        html_part.add_related(
            b"\x89PNG\r\n\x1a\ninline-image",
            maintype="image",
            subtype="png",
            cid="<logo@example.net>",
            filename="logo.png",
            disposition="inline",
        )

        parsed = parse_inbound_message(message.as_bytes())

        self.assertIn("data:image/png;base64,", parsed.body_html or "")
        self.assertNotIn("cid:logo@example.net", parsed.body_html or "")
    def test_security_result_routes_normal_spam_and_virus_separately(self) -> None:
        self.assertEqual(classify_inbound_security(parse_inbound_message(raw_message())).disposition, "inbox")
        self.assertEqual(classify_inbound_security(parse_inbound_message(raw_message(spam=True))).disposition, "spam")
        self.assertEqual(classify_inbound_security(parse_inbound_message(raw_message(infected=True))).disposition, "quarantine")

    def test_migration_supports_durable_raw_spool_dedup_and_external_mailbox_rows(self) -> None:
        sql = (Path(__file__).parent / "migrations" / "048_mail_inbound.sql").read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE IF NOT EXISTS mail_inbound_messages", sql)
        self.assertIn("UNIQUE (company_id, content_sha256)", sql)
        self.assertIn("raw_storage_key", sql)
        self.assertIn("processing_status", sql)
        self.assertIn("external_smtp", sql)
        self.assertIn("DROP NOT NULL", sql)
        self.assertNotIn("DROP TABLE", sql.upper())


if __name__ == "__main__":
    unittest.main()
