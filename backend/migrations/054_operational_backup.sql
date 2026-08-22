CREATE TABLE IF NOT EXISTS operational_backup_policies (
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours BETWEEN 1 AND 720),
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
    encryption_required BOOLEAN NOT NULL DEFAULT TRUE,
    storage_path TEXT NOT NULL DEFAULT '/var/lib/moaworks/backups',
    last_scheduled_at TIMESTAMPTZ,
    next_scheduled_at TIMESTAMPTZ,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_backup_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'schedule')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired')),
    artifact_path TEXT,
    artifact_sha256 TEXT,
    size_bytes BIGINT,
    snapshot_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_backup_jobs_company_created
    ON operational_backup_jobs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_backup_jobs_claim
    ON operational_backup_jobs(status, created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS operational_restore_drills (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    backup_job_id TEXT NOT NULL REFERENCES operational_backup_jobs(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    isolated_database TEXT,
    checksum_verified BOOLEAN NOT NULL DEFAULT FALSE,
    rpo_seconds BIGINT,
    rto_seconds BIGINT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_restore_drills_company_created
    ON operational_restore_drills(company_id, created_at DESC);
