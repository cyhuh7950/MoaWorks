ALTER TABLE org_import_batches
    ADD COLUMN IF NOT EXISTS deactivated_users_json JSONB NOT NULL DEFAULT '[]'::jsonb;
