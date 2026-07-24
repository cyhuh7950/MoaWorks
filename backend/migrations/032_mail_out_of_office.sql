CREATE TABLE IF NOT EXISTS mail_out_of_office_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    start_date DATE NULL,
    end_date DATE NULL,
    subject TEXT NOT NULL DEFAULT '',
    message_text TEXT NOT NULL DEFAULT '',
    target_scope TEXT NOT NULL DEFAULT 'all' CHECK (target_scope IN ('all','internal','external')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (company_id, user_id),
    CHECK ((start_date IS NULL AND end_date IS NULL) OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date AND end_date - start_date <= 364)),
    CHECK (char_length(subject) <= 200),
    CHECK (char_length(message_text) <= 4000)
);

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS chk_mail_messages_source_action;
ALTER TABLE mail_messages ADD CONSTRAINT chk_mail_messages_source_action
    CHECK (source_action IS NULL OR source_action IN ('reply','reply_all','forward','out_of_office'));

ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_delivery_source_check;
ALTER TABLE mail_recipients ADD CONSTRAINT mail_recipients_delivery_source_check
    CHECK (delivery_source IN ('direct','auto_forward','out_of_office'));

ALTER TABLE mail_delivery_queue DROP CONSTRAINT IF EXISTS mail_delivery_queue_delivery_kind_check;
ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_delivery_kind_check
    CHECK (delivery_kind IN ('direct','auto_forward','out_of_office'));

CREATE TABLE IF NOT EXISTS mail_out_of_office_deliveries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_id TEXT NOT NULL REFERENCES mail_out_of_office_policies(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    normalized_sender_email TEXT NOT NULL,
    origin_mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    origin_recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    response_mail_id TEXT NULL REFERENCES mail_messages(id) ON DELETE SET NULL,
    response_recipient_id TEXT NULL REFERENCES mail_recipients(id) ON DELETE SET NULL,
    delivery_queue_id TEXT NULL REFERENCES mail_delivery_queue(id) ON DELETE SET NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('internal','external')),
    status TEXT NOT NULL CHECK (status IN ('internal_delivered','queued','blocked','retry_pending','sent','failed')),
    reason_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    UNIQUE (policy_id, period_start, period_end, normalized_sender_email)
);

CREATE INDEX IF NOT EXISTS idx_mail_out_of_office_policies_owner
    ON mail_out_of_office_policies(company_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mail_out_of_office_deliveries_owner_created
    ON mail_out_of_office_deliveries(company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_out_of_office_deliveries_queue
    ON mail_out_of_office_deliveries(delivery_queue_id) WHERE delivery_queue_id IS NOT NULL;
