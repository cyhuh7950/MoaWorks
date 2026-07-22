ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS source_message_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS source_action TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_mail_messages_source_message'
          AND conrelid = 'mail_messages'::regclass
    ) THEN
        ALTER TABLE mail_messages
            ADD CONSTRAINT fk_mail_messages_source_message
            FOREIGN KEY (source_message_id)
            REFERENCES mail_messages(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_mail_messages_source_action'
          AND conrelid = 'mail_messages'::regclass
    ) THEN
        ALTER TABLE mail_messages
            ADD CONSTRAINT chk_mail_messages_source_action
            CHECK (source_action IS NULL OR source_action IN ('reply', 'reply_all', 'forward'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mail_messages_source_message
    ON mail_messages (source_message_id)
    WHERE source_message_id IS NOT NULL;

