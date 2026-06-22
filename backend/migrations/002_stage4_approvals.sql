CREATE TABLE IF NOT EXISTS approval_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    creator_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    current_line_index INTEGER NULL,
    submitted_by_user_id TEXT NULL REFERENCES users(id),
    submitted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_lines (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
    approver_user_id TEXT NOT NULL REFERENCES users(id),
    approver_user_name TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    comment TEXT NULL,
    decided_by_user_id TEXT NULL REFERENCES users(id),
    decided_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_documents_company_id ON approval_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_documents_creator_user_id ON approval_documents(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_approval_documents_status ON approval_documents(status);
CREATE INDEX IF NOT EXISTS idx_approval_lines_document_id ON approval_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_approval_lines_approver_user_id ON approval_lines(approver_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_lines_document_sequence ON approval_lines(document_id, sequence);
