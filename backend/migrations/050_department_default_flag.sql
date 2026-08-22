ALTER TABLE departments
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

WITH default_candidates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at ASC, id ASC) AS position
    FROM departments
    WHERE parent_id IS NULL
      AND name = '본사'
      AND status != 'deleted'
)
UPDATE departments
SET is_default = TRUE
WHERE id IN (
    SELECT id
    FROM default_candidates
    WHERE position = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_one_default_per_company
    ON departments(company_id)
    WHERE is_default = TRUE;
