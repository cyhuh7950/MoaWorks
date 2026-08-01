ALTER TABLE help_policy_documents
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN;

UPDATE help_policy_documents
SET is_system = FALSE
WHERE is_system IS NULL;

ALTER TABLE help_policy_documents
  ALTER COLUMN is_system SET DEFAULT FALSE;

ALTER TABLE help_policy_documents
  ALTER COLUMN is_system SET NOT NULL;

ALTER TABLE help_policy_documents
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE help_policy_documents
SET created_at = COALESCE(created_at, updated_at, NOW())
WHERE created_at IS NULL;

ALTER TABLE help_policy_documents
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE help_policy_documents
  ALTER COLUMN created_at SET NOT NULL;
