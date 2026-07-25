CREATE TABLE IF NOT EXISTS approval_basic_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    writing_method TEXT NOT NULL DEFAULT 'general' CHECK (writing_method = 'general'),
    attachment_image_display TEXT NOT NULL DEFAULT 'thumbnail'
        CHECK (attachment_image_display IN ('thumbnail', 'original', 'filename')),
    signature_storage_key TEXT NULL UNIQUE,
    signature_file_name TEXT NULL,
    signature_content_type TEXT NULL,
    signature_size_bytes BIGINT NULL CHECK (signature_size_bytes IS NULL OR signature_size_bytes > 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_basic_preferences_company
    ON approval_basic_preferences(company_id, user_id);

ALTER TABLE approval_lines ADD COLUMN IF NOT EXISTS signature_storage_key TEXT NULL;
ALTER TABLE approval_lines ADD COLUMN IF NOT EXISTS signature_file_name TEXT NULL;
ALTER TABLE approval_lines ADD COLUMN IF NOT EXISTS signature_content_type TEXT NULL;
ALTER TABLE approval_lines ADD COLUMN IF NOT EXISTS signature_size_bytes BIGINT NULL;
