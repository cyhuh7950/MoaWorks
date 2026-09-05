CREATE TABLE IF NOT EXISTS mail_oci_sender_sync_outbox (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create','update','deactivate','delete','reconcile')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_oci_sender_sync_outbox_pending_idx
    ON mail_oci_sender_sync_outbox(next_attempt_at, created_at)
    WHERE status IN ('pending','failed');
