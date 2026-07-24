CREATE TABLE IF NOT EXISTS user_spam_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filter_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    blocked_action TEXT NOT NULL DEFAULT 'move_to_spam'
        CHECK (blocked_action = 'move_to_spam'),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_spam_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('allow', 'deny')),
    match_type TEXT NOT NULL CHECK (match_type IN ('email', 'domain')),
    match_value TEXT NOT NULL CHECK (char_length(match_value) BETWEEN 1 AND 320),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, user_id, match_type, match_value)
);

CREATE INDEX IF NOT EXISTS idx_user_spam_rules_owner_filter
    ON user_spam_rules(company_id, user_id, rule_type, match_type, enabled, created_at DESC);
