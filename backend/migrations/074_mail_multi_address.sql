-- Existing account and login addresses remain authoritative for authentication.
-- These tables add independently managed mail identities without multiplying mailboxes.
CREATE TABLE IF NOT EXISTS mail_managed_domains (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, domain),
    CHECK (domain = LOWER(domain))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_managed_domains_name
    ON mail_managed_domains (LOWER(domain));
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_managed_domains_primary
    ON mail_managed_domains (company_id) WHERE is_primary;

INSERT INTO mail_managed_domains (company_id, domain, status, is_primary)
SELECT company_id, LOWER(mail_domain), 'active', TRUE
FROM mail_domain_settings
ON CONFLICT (company_id, domain) DO NOTHING;

CREATE TABLE IF NOT EXISTS mail_addresses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    send_requested BOOLEAN NOT NULL DEFAULT FALSE,
    send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (address = LOWER(address)),
    CHECK (address ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_addresses_address
    ON mail_addresses (LOWER(address));
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_addresses_primary
    ON mail_addresses (user_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_mail_addresses_user ON mail_addresses (company_id, user_id);

INSERT INTO mail_addresses (id, company_id, user_id, address, is_primary, active, send_requested, send_enabled)
SELECT 'primary_' || a.user_id, u.company_id, a.user_id, LOWER(a.email), TRUE,
       a.status = 'active', TRUE, a.status = 'active'
FROM mail_accounts a JOIN users u ON u.id = a.user_id
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_primary_mail_address() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO mail_addresses (id, company_id, user_id, address, is_primary, active, send_requested, send_enabled, updated_at)
    SELECT 'primary_' || NEW.user_id, u.company_id, NEW.user_id, LOWER(NEW.email), TRUE,
           NEW.status = 'active', TRUE, NEW.status = 'active', NOW()
    FROM users u WHERE u.id = NEW.user_id
    ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        address = EXCLUDED.address,
        active = EXCLUDED.active,
        send_enabled = EXCLUDED.send_enabled,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_primary_mail_address ON mail_accounts;
CREATE TRIGGER trg_sync_primary_mail_address
    AFTER INSERT OR UPDATE OF email, status ON mail_accounts
    FOR EACH ROW EXECUTE FUNCTION sync_primary_mail_address();

CREATE OR REPLACE FUNCTION sync_primary_mail_domain() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND LOWER(OLD.mail_domain) <> LOWER(NEW.mail_domain) THEN
        UPDATE mail_managed_domains SET is_primary = FALSE, updated_at = NOW()
        WHERE company_id = NEW.company_id AND is_primary;
    END IF;
    INSERT INTO mail_managed_domains (company_id, domain, status, is_primary, updated_at)
    VALUES (NEW.company_id, LOWER(NEW.mail_domain), 'active', TRUE, NOW())
    ON CONFLICT (company_id, domain) DO UPDATE SET
        status = 'active', is_primary = TRUE, updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_primary_mail_domain ON mail_domain_settings;
CREATE TRIGGER trg_sync_primary_mail_domain
    AFTER INSERT OR UPDATE OF mail_domain ON mail_domain_settings
    FOR EACH ROW EXECUTE FUNCTION sync_primary_mail_domain();

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS sender_identity_selected BOOLEAN NOT NULL DEFAULT FALSE;
