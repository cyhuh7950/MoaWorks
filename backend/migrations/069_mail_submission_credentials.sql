CREATE TABLE IF NOT EXISTS mail_submission_credentials (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    issued_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, user_id),
    UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS mail_submission_credentials_active_username_idx
    ON mail_submission_credentials (username)
    WHERE active = TRUE;
