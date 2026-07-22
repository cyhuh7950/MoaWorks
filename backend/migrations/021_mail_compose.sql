ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_mail_messages_scheduled_due
    ON mail_messages (scheduled_at ASC)
    WHERE status = 'scheduled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_attachments_storage_key
    ON mail_attachments (storage_key)
    WHERE storage_key IS NOT NULL;
