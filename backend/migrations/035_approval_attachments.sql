CREATE TABLE IF NOT EXISTS approval_attachments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    storage_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_attachments_document_id
    ON approval_attachments(document_id);
