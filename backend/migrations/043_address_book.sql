CREATE TABLE IF NOT EXISTS contact_groups (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_groups_owner_status_sort
    ON contact_groups (owner_user_id, status, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_groups_owner_name_active
    ON contact_groups (owner_user_id, LOWER(name)) WHERE status='active';

ALTER TABLE personal_contacts
    ADD COLUMN IF NOT EXISTS group_id TEXT NULL REFERENCES contact_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_personal_contacts_owner_group_status
    ON personal_contacts (owner_user_id, group_id, status);
