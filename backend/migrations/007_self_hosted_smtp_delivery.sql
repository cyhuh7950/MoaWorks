CREATE TABLE IF NOT EXISTS mail_delivery_providers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_key TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sender_domain TEXT NOT NULL,
    helo_name TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    use_tls BOOLEAN NOT NULL DEFAULT FALSE,
    timeout_sec INTEGER NOT NULL DEFAULT 15,
    max_retry_count INTEGER NOT NULL DEFAULT 3,
    retry_interval_sec INTEGER NOT NULL DEFAULT 300,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, provider_key)
);

CREATE TABLE IF NOT EXISTS mail_delivery_queue (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES mail_delivery_providers(id) ON DELETE CASCADE,
    provider_key TEXT NOT NULL,
    mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    next_retry_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_delivery_attempts (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error_message TEXT NULL,
    response_detail TEXT NULL,
    attempted_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_delivery_events (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_delivery_providers_company_id ON mail_delivery_providers(company_id);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_company_id ON mail_delivery_queue(company_id);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_mail_id ON mail_delivery_queue(mail_id);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_status ON mail_delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_created_at ON mail_delivery_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_attempts_queue_id ON mail_delivery_attempts(queue_id);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_events_queue_id ON mail_delivery_events(queue_id);
