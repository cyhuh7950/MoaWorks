ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_department_head BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_department_head
    ON users (department_id, is_department_head)
    WHERE is_department_head = TRUE;
