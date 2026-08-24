CREATE TABLE IF NOT EXISTS personal_ai_configs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type VARCHAR(32) NOT NULL,
    model VARCHAR(200) NOT NULL,
    encrypted_api_key TEXT,
    connection_status VARCHAR(32) NOT NULL DEFAULT 'untested',
    last_test_code VARCHAR(100),
    last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, user_id),
    CHECK (connection_status IN ('unconfigured', 'untested', 'ready', 'error'))
);

CREATE INDEX IF NOT EXISTS ix_personal_ai_configs_company_user
    ON personal_ai_configs(company_id, user_id);

CREATE TABLE IF NOT EXISTS personal_ai_rate_limits (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(16) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
    CHECK (action IN ('test', 'chat')),
    PRIMARY KEY (company_id, user_id, action, window_started_at)
);
