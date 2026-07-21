ALTER TABLE mail_recipients
    ADD COLUMN IF NOT EXISTS inbox_category TEXT NOT NULL DEFAULT 'primary';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_mail_recipients_inbox_category'
          AND conrelid = 'mail_recipients'::regclass
    ) THEN
        ALTER TABLE mail_recipients
            ADD CONSTRAINT chk_mail_recipients_inbox_category
            CHECK (inbox_category IN ('primary', 'promotions', 'social', 'updates', 'forums'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_mail_recipients_inbox_category
    ON mail_recipients (recipient_user_id, inbox_category);
