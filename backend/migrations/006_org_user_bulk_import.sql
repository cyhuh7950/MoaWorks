ALTER TABLE departments
    ADD COLUMN IF NOT EXISTS system_department_code TEXT,
    ADD COLUMN IF NOT EXISTS department_code TEXT;

UPDATE departments
SET system_department_code = COALESCE(system_department_code, CONCAT('LEGACY-', UPPER(SUBSTRING(MD5(id) FROM 1 FOR 12))))
WHERE system_department_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_system_department_code
    ON departments(system_department_code);
CREATE INDEX IF NOT EXISTS idx_departments_department_code
    ON departments(department_code);

CREATE TABLE IF NOT EXISTS org_import_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    uploaded_by_user_id TEXT NULL REFERENCES users(id),
    uploaded_by_user_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    apply_status TEXT NOT NULL,
    inactive_department_count INTEGER NOT NULL DEFAULT 0,
    created_department_count INTEGER NOT NULL DEFAULT 0,
    moved_user_count INTEGER NOT NULL DEFAULT 0,
    created_user_count INTEGER NOT NULL DEFAULT 0,
    deactivated_user_count INTEGER NOT NULL DEFAULT 0,
    errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    uploaded_at TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_org_import_batches_company_id
    ON org_import_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_org_import_batches_uploaded_at
    ON org_import_batches(uploaded_at DESC);
