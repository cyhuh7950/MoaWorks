ALTER TABLE mail_recipients
    ADD COLUMN IF NOT EXISTS inbox_category TEXT NOT NULL DEFAULT 'primary',
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT NULL REFERENCES users(id);

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT NULL REFERENCES users(id);

ALTER TABLE mail_recipients
    DROP CONSTRAINT IF EXISTS chk_mail_recipients_inbox_category;
ALTER TABLE mail_recipients
    ADD CONSTRAINT chk_mail_recipients_inbox_category
    CHECK (inbox_category IN ('primary', 'promotions', 'social', 'updates', 'forums'));

CREATE INDEX IF NOT EXISTS idx_mail_recipients_inbox_category
    ON mail_recipients (recipient_user_id, inbox_category)
    WHERE deleted_at IS NULL;
