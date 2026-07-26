CREATE TABLE IF NOT EXISTS user_schedule_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_user_schedule_events_owner_status_starts
    ON user_schedule_events (owner_user_id, status, starts_at);
