CREATE TABLE IF NOT EXISTS user_calendars (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'approval_required', 'private')),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_calendars_default_active
    ON user_calendars (owner_user_id) WHERE status='active' AND is_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_calendars_name_active
    ON user_calendars (owner_user_id, LOWER(name)) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_user_calendars_owner_order
    ON user_calendars (company_id, owner_user_id, status, sort_order);

CREATE TABLE IF NOT EXISTS user_calendar_subscriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    calendar_id TEXT NOT NULL REFERENCES user_calendars(id),
    subscriber_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'cancelled')),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (calendar_id, subscriber_user_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_owner
    ON user_calendar_subscriptions (calendar_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_subscriber
    ON user_calendar_subscriptions (company_id, subscriber_user_id, status, updated_at);

INSERT INTO user_calendars (id, company_id, owner_user_id, name, color, sort_order, is_default, visibility, version, status, created_at, updated_at)
SELECT 'cal_' || substr(md5(u.id), 1, 24), u.company_id, u.id, '내 일정', '#0f766e', 0, TRUE, 'private', 0, 'active', NOW(), NOW()
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_calendars c WHERE c.owner_user_id=u.id AND c.status='active'
)
ON CONFLICT DO NOTHING;

ALTER TABLE user_schedule_events ADD COLUMN IF NOT EXISTS calendar_id TEXT;

UPDATE user_schedule_events s
SET calendar_id = c.id
FROM user_calendars c
WHERE s.calendar_id IS NULL AND c.owner_user_id=s.owner_user_id AND c.status='active' AND c.is_default;

ALTER TABLE user_schedule_events ALTER COLUMN calendar_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_user_schedule_events_calendar') THEN
        ALTER TABLE user_schedule_events
            ADD CONSTRAINT fk_user_schedule_events_calendar FOREIGN KEY (calendar_id) REFERENCES user_calendars(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_schedule_events_calendar
    ON user_schedule_events (calendar_id, status, starts_at);
