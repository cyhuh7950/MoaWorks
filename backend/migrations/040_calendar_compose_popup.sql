ALTER TABLE user_schedule_events
    ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS repeat_type TEXT NOT NULL DEFAULT 'none' CHECK (repeat_type IN ('none', 'daily', 'weekly', 'monthly')),
    ADD COLUMN IF NOT EXISTS repeat_until DATE,
    ADD COLUMN IF NOT EXISTS alert_minutes JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Seoul';

CREATE TABLE IF NOT EXISTS user_schedule_attendees (
    schedule_id TEXT NOT NULL REFERENCES user_schedule_events(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schedule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_schedule_attendees_user
    ON user_schedule_attendees (user_id, schedule_id);

CREATE TABLE IF NOT EXISTS user_schedule_notification_deliveries (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES user_schedule_events(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id),
    occurrence_at TIMESTAMPTZ NOT NULL,
    alert_minutes INTEGER NOT NULL CHECK (alert_minutes IN (0, 10, 30, 60, 1440)),
    recipient_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'failed')),
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_id, occurrence_at, alert_minutes, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_schedule_notification_delivery_status
    ON user_schedule_notification_deliveries (status, updated_at);
