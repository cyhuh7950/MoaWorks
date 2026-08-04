ALTER TABLE mail_messages
    ALTER COLUMN sender_user_id DROP NOT NULL,
    ALTER COLUMN sender_account_id DROP NOT NULL;

ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_delivery_source_check;
ALTER TABLE mail_recipients ADD CONSTRAINT mail_recipients_delivery_source_check
    CHECK (delivery_source IN ('direct','auto_forward','out_of_office','external_smtp'));

CREATE TABLE IF NOT EXISTS mail_inbound_messages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    internet_message_id TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    raw_storage_key TEXT NOT NULL,
    envelope_from TEXT NOT NULL,
    header_from TEXT NOT NULL,
    authentication_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    spam_result TEXT NULL,
    virus_status TEXT NULL,
    security_disposition TEXT NOT NULL
        CHECK (security_disposition IN ('inbox','spam','quarantine','blocked')),
    processing_status TEXT NOT NULL
        CHECK (processing_status IN ('spooled','processed','failed','quarantined')),
    mail_message_id TEXT NULL REFERENCES mail_messages(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS mail_inbound_recipients (
    id TEXT PRIMARY KEY,
    inbound_message_id TEXT NOT NULL REFERENCES mail_inbound_messages(id) ON DELETE CASCADE,
    recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('inbox','spam','quarantine','blocked')),
    mail_recipient_id TEXT NULL REFERENCES mail_recipients(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (inbound_message_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_inbound_processing
    ON mail_inbound_messages (processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_mail_inbound_recipient
    ON mail_inbound_recipients (recipient_user_id, created_at DESC);
