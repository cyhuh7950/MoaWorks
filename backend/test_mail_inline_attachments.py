from __future__ import annotations

from pathlib import Path
import unittest

from pydantic import ValidationError

from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailAttachmentUploadResponse,
    MailAttachmentView,
)


class MailInlineAttachmentContractTests(unittest.TestCase):
    def test_attachment_default_is_backward_compatible(self) -> None:
        """Removing the attachment default or adding a default CID must fail this test."""
        item = MailAttachmentMeta(
            uploadId="a" * 32,
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )

        self.assertEqual(item.disposition, "attachment")
        self.assertIsNone(item.contentId)

    def test_inline_requires_content_id(self) -> None:
        """Removing the inline/CID validation must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentMeta(
                uploadId="b" * 32,
                fileName="a.png",
                contentType="image/png",
                sizeBytes=1,
                disposition="inline",
            )

    def test_attachment_rejects_content_id(self) -> None:
        """Allowing a CID on a normal attachment must fail this test."""
        with self.assertRaises(ValidationError):
            MailAttachmentMeta(
                uploadId="c" * 32,
                fileName="a.txt",
                contentType="text/plain",
                sizeBytes=1,
                contentId="mw-1@moaworks.invalid",
            )

    def test_inline_accepts_content_id(self) -> None:
        """Rejecting a complete inline attachment contract must fail this test."""
        item = MailAttachmentMeta(
            uploadId="d" * 32,
            fileName="a.png",
            contentType="image/png",
            sizeBytes=1,
            disposition="inline",
            contentId="mw-1@moaworks.invalid",
        )

        self.assertEqual(item.disposition, "inline")
        self.assertEqual(item.contentId, "mw-1@moaworks.invalid")

    def test_upload_and_view_keep_attachment_safe_defaults(self) -> None:
        """Removing API response defaults or exposing a default CID must fail this test."""
        uploaded = MailAttachmentUploadResponse(
            uploadId="e" * 32,
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )
        view = MailAttachmentView(
            fileName="a.txt",
            contentType="text/plain",
            sizeBytes=1,
        )

        for item in (uploaded, view):
            self.assertEqual(item.disposition, "attachment")
            self.assertIsNone(item.contentId)
            self.assertIsNone(item.previewPath)

    def test_migration_declares_inline_contract_without_checksum_column(self) -> None:
        """Dropping a DB guard/index or adding checksum storage must fail this static contract test."""
        migration = (Path(__file__).parent / "migrations" / "065_mail_inline_attachments.sql").read_text(
            encoding="utf-8"
        ).lower()
        normalized = "".join(migration.split())

        self.assertIn("addcolumnifnotexistscontent_disposition", normalized)
        self.assertIn("addcolumnifnotexistscontent_id", normalized)
        self.assertIn("content_dispositionin('attachment','inline')", normalized)
        self.assertIn("content_disposition='inline'andcontent_idisnotnull", normalized)
        self.assertIn("content_disposition='attachment'andcontent_idisnull", normalized)
        self.assertIn("createuniqueindexifnotexistsuq_mail_attachments_message_content_id", normalized)
        self.assertIn("wherecontent_idisnotnull", normalized)
        self.assertNotIn("checksum", migration)


if __name__ == "__main__":
    unittest.main()
