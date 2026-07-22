ALTER TABLE departments
    ADD COLUMN IF NOT EXISTS department_code TEXT NULL;

CREATE TABLE IF NOT EXISTS personal_contacts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_contacts_owner_status
    ON personal_contacts (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_personal_contacts_company_id
    ON personal_contacts (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_contacts_owner_email_active
    ON personal_contacts (owner_user_id, LOWER(email))
