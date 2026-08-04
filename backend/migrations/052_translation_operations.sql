CREATE TABLE IF NOT EXISTS translation_provider_configs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    provider_type TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    api_base_url TEXT NOT NULL DEFAULT '',
    encrypted_api_key TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    cache_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    timeout_seconds INTEGER NOT NULL DEFAULT 15 CHECK (timeout_seconds BETWEEN 1 AND 120),
    max_retries INTEGER NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 5),
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 10000),
    circuit_failure_threshold INTEGER NOT NULL DEFAULT 5 CHECK (circuit_failure_threshold BETWEEN 1 AND 100),
    circuit_recovery_seconds INTEGER NOT NULL DEFAULT 60 CHECK (circuit_recovery_seconds BETWEEN 1 AND 3600),
    cost_per_million_units NUMERIC(18, 8),
    cost_unit TEXT NOT NULL DEFAULT 'tokens' CHECK (cost_unit IN ('tokens', 'characters')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS translation_cache_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    source_hash TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    usage_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    estimated_cost NUMERIC(18, 8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, source_hash, source_locale, target_locale, provider_type, model)
);

CREATE TABLE IF NOT EXISTS translation_review_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    source_hash TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'edited', 'approved', 'failed')),
    estimated_cost NUMERIC(18, 8),
    approved_by_user_id TEXT NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS translation_review_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    review_id TEXT NOT NULL REFERENCES translation_review_items(id),
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('created', 'edit', 'approve', 'retranslate', 'failed')),
    before_text TEXT,
    after_text TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_company_hash
    ON translation_cache_entries (company_id, source_hash, target_locale);
CREATE INDEX IF NOT EXISTS idx_translation_review_company_status
    ON translation_review_items (company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_translation_review_events_review
    ON translation_review_events (company_id, review_id, created_at);
