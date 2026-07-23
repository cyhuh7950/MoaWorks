DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_mail_user_folders_id_owner'
          AND conrelid = 'mail_user_folders'::regclass
    ) THEN
        ALTER TABLE mail_user_folders
            ADD CONSTRAINT uq_mail_user_folders_id_owner
            UNIQUE (id, company_id, user_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_mailbox_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    mailbox_type TEXT NOT NULL
        CHECK (mailbox_type IN ('inbox', 'sent', 'draft', 'folder')),
    folder_id TEXT,
    retention_days INTEGER
        CHECK (retention_days IS NULL OR retention_days IN (30, 90, 180, 365)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_user_mailbox_policy_folder
        CHECK (
            (mailbox_type = 'folder' AND folder_id IS NOT NULL)
            OR (mailbox_type <> 'folder' AND folder_id IS NULL)
        ),
    FOREIGN KEY (folder_id, company_id, user_id)
        REFERENCES mail_user_folders(id, company_id, user_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_mailbox_policy_system
    ON user_mailbox_policies(company_id, user_id, mailbox_type)
    WHERE folder_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_mailbox_policy_folder
    ON user_mailbox_policies(company_id, user_id, folder_id)
    WHERE mailbox_type = 'folder';
CREATE INDEX IF NOT EXISTS idx_user_mailbox_policies_owner
    ON user_mailbox_policies(company_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mailbox_backup_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    mailbox_type TEXT NOT NULL
        CHECK (mailbox_type IN ('inbox', 'sent', 'draft', 'scheduled', 'spam', 'trash', 'folder')),
    folder_id TEXT,
    mailbox_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired')),
    snapshot_at TIMESTAMPTZ,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
    processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
    artifact_key TEXT,
    artifact_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (artifact_size_bytes >= 0),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    error_code TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (folder_id, company_id, user_id)
        REFERENCES mail_user_folders(id, company_id, user_id)
        ON DELETE SET NULL (folder_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_backup_jobs_active_owner
    ON mailbox_backup_jobs(company_id, user_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_mailbox_backup_jobs_owner_created
    ON mailbox_backup_jobs(company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_backup_jobs_claim
    ON mailbox_backup_jobs(status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_mailbox_backup_jobs_expiry
    ON mailbox_backup_jobs(status, expires_at)
    WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS mailbox_backup_job_items (
    job_id TEXT NOT NULL REFERENCES mailbox_backup_jobs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
    message_id TEXT NOT NULL REFERENCES mail_messages(id),
    view_type TEXT NOT NULL CHECK (view_type IN ('sender', 'recipient')),
    recipient_id TEXT REFERENCES mail_recipients(id),
    PRIMARY KEY (job_id, ordinal),
    CONSTRAINT ck_mailbox_backup_item_view
        CHECK (
            (view_type = 'sender' AND recipient_id IS NULL)
            OR (view_type = 'recipient' AND recipient_id IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_backup_items_sender
    ON mailbox_backup_job_items(job_id, message_id)
    WHERE view_type = 'sender';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_backup_items_recipient
    ON mailbox_backup_job_items(job_id, recipient_id)
    WHERE view_type = 'recipient';
