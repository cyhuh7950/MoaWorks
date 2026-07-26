CREATE TABLE IF NOT EXISTS approval_delegations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    delegate_user_id TEXT NOT NULL REFERENCES users(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_approval_delegation_period CHECK (start_date <= end_date),
    CONSTRAINT chk_approval_delegation_people CHECK (owner_user_id <> delegate_user_id),
    CONSTRAINT chk_approval_delegation_version CHECK (version >= 1),
    CONSTRAINT chk_approval_delegation_reason CHECK (char_length(reason) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_owner
    ON approval_delegations(company_id, owner_user_id, deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegate_active
    ON approval_delegations(company_id, delegate_user_id, enabled, start_date, end_date)
    WHERE deleted_at IS NULL;

ALTER TABLE approval_lines
    ADD COLUMN IF NOT EXISTS delegation_id TEXT NULL REFERENCES approval_delegations(id);

CREATE INDEX IF NOT EXISTS idx_approval_lines_delegation
    ON approval_lines(delegation_id)
    WHERE delegation_id IS NOT NULL;
