CREATE TABLE IF NOT EXISTS notifications (
    notification_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL,
    company_id TEXT NOT NULL,
    actor_user_id TEXT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    ttl_minutes INTEGER NOT NULL DEFAULT 4320,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'unread',
    read_at TIMESTAMPTZ NULL,
    acknowledged_at TIMESTAMPTZ NULL,
    archived_at TIMESTAMPTZ NULL,
    delivery_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
    links JSONB NOT NULL DEFAULT '{}'::jsonb,
    auditing JSONB NOT NULL DEFAULT '{}'::jsonb,
    visibility TEXT NOT NULL,
    recipient_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_audience TEXT NOT NULL DEFAULT 'both',
    last_notified_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS monitoring_events (
    event_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL,
    company_id TEXT NOT NULL,
    actor_user_id TEXT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    ttl_minutes INTEGER NOT NULL DEFAULT 4320,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    visibility TEXT NOT NULL DEFAULT 'both',
    targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    links JSONB NOT NULL DEFAULT '{}'::jsonb,
    delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
    auditing JSONB NOT NULL DEFAULT '{}'::jsonb,
    target_audience TEXT NOT NULL DEFAULT 'both'
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user_ids ON notifications USING GIN(recipient_user_ids);
CREATE INDEX IF NOT EXISTS idx_notifications_dedup_key ON notifications(dedup_key);
CREATE INDEX IF NOT EXISTS idx_notifications_resource ON notifications(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_occurred_at ON monitoring_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_category ON monitoring_events(category);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_severity ON monitoring_events(severity);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_resource ON monitoring_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_resolved ON monitoring_events(resolved);
