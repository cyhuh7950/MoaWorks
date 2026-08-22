ALTER TABLE mail_delivery_providers
    ADD COLUMN IF NOT EXISTS smtp_host TEXT NULL,
    ADD COLUMN IF NOT EXISTS smtp_port INTEGER NULL,
    ADD COLUMN IF NOT EXISTS smtp_username TEXT NULL,
    ADD COLUMN IF NOT EXISTS encrypted_password TEXT NULL;

ALTER TABLE mail_delivery_providers
    DROP CONSTRAINT IF EXISTS chk_mail_delivery_provider_smtp_port;

ALTER TABLE mail_delivery_providers
    ADD CONSTRAINT chk_mail_delivery_provider_smtp_port
    CHECK (smtp_port IS NULL OR smtp_port IN (25, 465, 587));

CREATE INDEX IF NOT EXISTS idx_mail_delivery_providers_key_enabled
    ON mail_delivery_providers (company_id, provider_key, enabled);
