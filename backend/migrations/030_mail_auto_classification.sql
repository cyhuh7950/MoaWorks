CREATE TABLE IF NOT EXISTS mail_auto_classification_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS mail_auto_classification_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL CHECK (priority > 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    target_folder_id TEXT NULL REFERENCES mail_user_folders(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, user_id, priority)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_auto_classification_rules_owner_name
    ON mail_auto_classification_rules(company_id, user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_mail_auto_classification_rules_owner_priority
    ON mail_auto_classification_rules(company_id, user_id, priority, id);

CREATE TABLE IF NOT EXISTS mail_auto_classification_conditions (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES mail_auto_classification_rules(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
    field TEXT NOT NULL CHECK (field IN ('sender_email','sender_domain','recipient_email','subject','body','attachment')),
    operator TEXT NOT NULL CHECK (operator IN ('equals','contains','subdomain','starts_with','ends_with','exists','missing')),
    value TEXT NULL,
    CHECK (
        (field IN ('sender_email','recipient_email') AND operator IN ('equals','contains') AND value IS NOT NULL)
        OR (field = 'sender_domain' AND operator IN ('equals','subdomain') AND value IS NOT NULL)
        OR (field = 'subject' AND operator IN ('contains','equals','starts_with','ends_with') AND value IS NOT NULL)
        OR (field = 'body' AND operator = 'contains' AND value IS NOT NULL)
        OR (field = 'attachment' AND operator IN ('exists','missing') AND value IS NULL)
    ),
    UNIQUE (rule_id, position)
);

CREATE TABLE IF NOT EXISTS mail_auto_classification_rule_tags (
    rule_id TEXT NOT NULL REFERENCES mail_auto_classification_rules(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES mail_tags(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
    PRIMARY KEY (rule_id, tag_id),
    UNIQUE (rule_id, tag_id),
    UNIQUE (rule_id, position)
);

CREATE TABLE IF NOT EXISTS mail_auto_classification_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_id TEXT NULL REFERENCES mail_auto_classification_rules(id) ON DELETE SET NULL,
    mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    result TEXT NOT NULL CHECK (result IN ('applied', 'matched_noop', 'failed')),
    folder_applied BOOLEAN NOT NULL DEFAULT FALSE,
    tag_count INTEGER NOT NULL DEFAULT 0 CHECK (tag_count >= 0),
    reason_code TEXT NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_auto_classification_events_owner_created
    ON mail_auto_classification_events(company_id, user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mail_auto_classification_events_rule_created
    ON mail_auto_classification_events(rule_id, created_at DESC, id DESC);
