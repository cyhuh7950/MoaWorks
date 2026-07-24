CREATE TABLE IF NOT EXISTS mail_auto_forward_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    keep_original BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS mail_auto_forward_targets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    normalized_email TEXT NOT NULL,
    target_user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('internal','external')),
    position INTEGER NOT NULL CHECK (position > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, user_id, normalized_email),
    UNIQUE (company_id, user_id, position)
);

CREATE TABLE IF NOT EXISTS mail_auto_forward_exceptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    matcher_type TEXT NOT NULL CHECK (matcher_type IN ('sender_email','sender_domain')),
    matcher_value TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('skip','override')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, user_id, matcher_type, matcher_value)
);

CREATE TABLE IF NOT EXISTS mail_auto_forward_exception_targets (
    exception_id TEXT NOT NULL REFERENCES mail_auto_forward_exceptions(id) ON DELETE CASCADE,
    normalized_email TEXT NOT NULL,
    target_user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('internal','external')),
    position INTEGER NOT NULL CHECK (position > 0),
    PRIMARY KEY (exception_id, normalized_email),
    UNIQUE (exception_id, position)
);

ALTER TABLE mail_recipients
    ADD COLUMN IF NOT EXISTS delivery_source TEXT NOT NULL DEFAULT 'direct',
    ADD COLUMN IF NOT EXISTS auto_forward_owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS auto_forward_origin_recipient_id TEXT NULL REFERENCES mail_recipients(id) ON DELETE SET NULL;

ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_delivery_source_check;
ALTER TABLE mail_recipients ADD CONSTRAINT mail_recipients_delivery_source_check
    CHECK (delivery_source IN ('direct','auto_forward'));

ALTER TABLE mail_delivery_queue
    ADD COLUMN IF NOT EXISTS delivery_kind TEXT NOT NULL DEFAULT 'direct',
    ADD COLUMN IF NOT EXISTS sender_email_override TEXT NULL,
    ADD COLUMN IF NOT EXISTS sender_display_name_override TEXT NULL,
    ADD COLUMN IF NOT EXISTS reply_to_email_override TEXT NULL;

ALTER TABLE mail_delivery_queue DROP CONSTRAINT IF EXISTS mail_delivery_queue_delivery_kind_check;
ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_delivery_kind_check
    CHECK (delivery_kind IN ('direct','auto_forward'));

CREATE TABLE IF NOT EXISTS mail_auto_forward_deliveries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    origin_recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    exception_id TEXT NULL REFERENCES mail_auto_forward_exceptions(id) ON DELETE SET NULL,
    target_email TEXT NOT NULL,
    target_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    forwarded_recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    delivery_queue_id TEXT NULL REFERENCES mail_delivery_queue(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('internal_delivered','queued','blocked','retry_pending','sent','failed')),
    reason_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    UNIQUE (origin_recipient_id, target_email)
);

CREATE INDEX IF NOT EXISTS idx_mail_auto_forward_targets_owner_position
    ON mail_auto_forward_targets(company_id, user_id, position);
CREATE INDEX IF NOT EXISTS idx_mail_auto_forward_exceptions_owner_matcher
    ON mail_auto_forward_exceptions(company_id, user_id, matcher_type, matcher_value);
CREATE INDEX IF NOT EXISTS idx_mail_auto_forward_deliveries_owner_created
    ON mail_auto_forward_deliveries(company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_auto_forward_deliveries_queue
    ON mail_auto_forward_deliveries(delivery_queue_id) WHERE delivery_queue_id IS NOT NULL;
