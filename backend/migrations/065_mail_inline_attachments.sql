ALTER TABLE mail_attachments
    ADD COLUMN IF NOT EXISTS content_disposition TEXT NOT NULL DEFAULT 'attachment',
    ADD COLUMN IF NOT EXISTS content_id TEXT NULL;

ALTER TABLE mail_attachments
    DROP CONSTRAINT IF EXISTS mail_attachments_content_disposition_check;
ALTER TABLE mail_attachments
    ADD CONSTRAINT mail_attachments_content_disposition_check
    CHECK (content_disposition IN ('attachment', 'inline'));

ALTER TABLE mail_attachments
    DROP CONSTRAINT IF EXISTS mail_attachments_inline_content_id_check;
ALTER TABLE mail_attachments
    ADD CONSTRAINT mail_attachments_inline_content_id_check
    CHECK (
        (content_disposition = 'inline' AND content_id IS NOT NULL)
        OR (content_disposition = 'attachment' AND content_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_attachments_message_content_id
    ON mail_attachments (message_id, content_id)
    WHERE content_id IS NOT NULL;
