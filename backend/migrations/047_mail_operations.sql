CREATE TABLE IF NOT EXISTS mail_domain_settings (
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    registered_domain TEXT NOT NULL,
    mail_domain TEXT NOT NULL,
    user_host TEXT NOT NULL,
    admin_host TEXT NOT NULL,
    mail_host TEXT NOT NULL,
    admin_access_mode TEXT NOT NULL DEFAULT 'restricted'
        CHECK (admin_access_mode IN ('public', 'restricted', 'private')),
    admin_allowed_cidrs JSONB NOT NULL DEFAULT '[]'::jsonb,
    active_outbound_provider_key TEXT NOT NULL DEFAULT 'self_hosted'
        CHECK (active_outbound_provider_key IN ('self_hosted', 'oci_email_delivery')),
    previous_outbound_provider_key TEXT NULL
        CHECK (
            previous_outbound_provider_key IS NULL
            OR previous_outbound_provider_key IN ('self_hosted', 'oci_email_delivery')
        ),
    provider_switched_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_domain_settings_mail_domain
    ON mail_domain_settings (LOWER(mail_domain));
CREATE INDEX IF NOT EXISTS idx_mail_domain_settings_active_provider
    ON mail_domain_settings (active_outbound_provider_key);

