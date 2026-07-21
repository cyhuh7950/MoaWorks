ALTER TABLE mail_recipients
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT NULL REFERENCES users(id);

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS sender_deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sender_deleted_by_user_id TEXT NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_mail_recipients_user_delete_received
    ON mail_recipients (recipient_user_id, deleted_at, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_recipients_user_category_delete_received
    ON mail_recipients (recipient_user_id, inbox_category, deleted_at, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_messages_sender_status_delete_time
    ON mail_messages (sender_user_id, status, sender_deleted_at, sent_at DESC, updated_at DESC);
