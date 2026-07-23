CREATE TABLE IF NOT EXISTS user_mail_signatures (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 50),
    content_text TEXT NOT NULL CHECK (CHAR_LENGTH(content_text) BETWEEN 1 AND 4000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_mail_signatures_id_owner UNIQUE (id, company_id, owner_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_mail_signatures_owner_name_ci
    ON user_mail_signatures(company_id, owner_user_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_user_mail_signatures_owner_updated
    ON user_mail_signatures(company_id, owner_user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_mail_signature_preferences (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    position TEXT NOT NULL DEFAULT 'body_bottom' CHECK (position IN ('body_top', 'body_bottom')),
    default_signature_id TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_mail_signature_preferences_company_owner UNIQUE (company_id, owner_user_id),
    CONSTRAINT fk_user_mail_signature_preferences_default
        FOREIGN KEY (default_signature_id, company_id, owner_user_id)
        REFERENCES user_mail_signatures(id, company_id, owner_user_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_user_mail_signature_preferences_owner
    ON user_mail_signature_preferences(company_id, owner_user_id);
