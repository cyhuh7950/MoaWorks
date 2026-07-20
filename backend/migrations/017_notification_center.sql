CREATE TABLE IF NOT EXISTS notification_user_states (
    notification_id TEXT NOT NULL REFERENCES notifications(notification_id),
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    read_at TIMESTAMPTZ NULL,
    archived_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
    categories JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_action_audit (
    audit_id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_user_states_user_status
    ON notification_user_states(user_id, status);
CREATE INDEX IF NOT EXISTS idx_notification_action_audit_actor_created
    ON notification_action_audit(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_action_audit_target
    ON notification_action_audit(target_type, target_id);
