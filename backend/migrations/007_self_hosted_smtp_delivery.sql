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

CREATE INDEX IF NOT EXISTS idx_mail_delivery_providers_company_id ON mail_delivery_providers(company_id);
