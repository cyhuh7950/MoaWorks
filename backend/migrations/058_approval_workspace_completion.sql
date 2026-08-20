ALTER TABLE approval_documents
    ADD COLUMN IF NOT EXISTS urgent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS creator_department_id TEXT NULL REFERENCES departments(id),
    ADD COLUMN IF NOT EXISTS shared_with_department BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE approval_documents ad
SET creator_department_id = u.department_id
FROM users u
WHERE ad.creator_user_id = u.id
  AND ad.creator_department_id IS NULL;

CREATE TABLE IF NOT EXISTS approval_document_audiences (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience_type TEXT NOT NULL CHECK (audience_type IN ('reference', 'viewer')),
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(document_id, user_id)
);

CREATE TABLE IF NOT EXISTS approval_document_deletions (
    document_id TEXT NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deleted_at TIMESTAMPTZ NOT NULL,
    permanently_deleted_at TIMESTAMPTZ NULL,
    PRIMARY KEY(document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_audiences_user
    ON approval_document_audiences(user_id, audience_type, read_at);
CREATE INDEX IF NOT EXISTS idx_approval_documents_department
    ON approval_documents(company_id, creator_department_id, shared_with_department, status);
CREATE INDEX IF NOT EXISTS idx_approval_deletions_user
    ON approval_document_deletions(user_id, deleted_at);
