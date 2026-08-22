ALTER TABLE mail_provider_configs
    ADD COLUMN IF NOT EXISTS dkim_domain TEXT NULL,
    ADD COLUMN IF NOT EXISTS dkim_selector TEXT NULL,
    ADD COLUMN IF NOT EXISTS encrypted_dkim_private_key TEXT NULL;

ALTER TABLE mail_delivery_queue
    ADD COLUMN IF NOT EXISTS envelope_from TEXT NULL,
    ADD COLUMN IF NOT EXISTS final_provider_type TEXT NULL,
    ADD COLUMN IF NOT EXISTS dsn_action TEXT NULL,
    ADD COLUMN IF NOT EXISTS dsn_status_code TEXT NULL;

CREATE TABLE IF NOT EXISTS mail_delivery_feedback (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
    content_sha256 TEXT NOT NULL,
    action TEXT NOT NULL,
    status_code TEXT NOT NULL,
    diagnostic TEXT NOT NULL,
    raw_storage_key TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    UNIQUE (queue_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS mail_oci_suppressions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'oci',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_mail_feedback_queue ON mail_delivery_feedback(queue_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_oci_suppression_active ON mail_oci_suppressions(company_id, active, recipient_email);
