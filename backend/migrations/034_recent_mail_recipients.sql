CREATE TABLE IF NOT EXISTS user_recent_mail_recipients (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT NULL,
    department_name TEXT NULL,
    last_used_at TIMESTAMPTZ NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recent_mail_recipients_owner_email
    ON user_recent_mail_recipients (company_id, owner_user_id, LOWER(recipient_email));

CREATE INDEX IF NOT EXISTS idx_recent_mail_recipients_owner_latest
    ON user_recent_mail_recipients (company_id, owner_user_id, last_used_at DESC, id);

WITH latest AS (
    SELECT DISTINCT ON (m.company_id, m.sender_user_id, LOWER(r.recipient_email))
        m.company_id,
        m.sender_user_id AS owner_user_id,
        LOWER(BTRIM(r.recipient_email)) AS recipient_email,
        u.name AS recipient_name,
        d.name AS department_name,
        m.sent_at AS last_used_at
    FROM mail_messages m
    JOIN mail_recipients r ON r.message_id = m.id
    LEFT JOIN users u
      ON u.company_id = m.company_id
     AND LOWER(u.email) = LOWER(BTRIM(r.recipient_email))
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE m.status = 'sent'
      AND m.sent_at IS NOT NULL
      AND m.sender_deleted_at IS NULL
      AND r.delivery_source = 'direct'
      AND BTRIM(r.recipient_email) <> ''
    ORDER BY m.company_id, m.sender_user_id, LOWER(r.recipient_email), m.sent_at DESC
), ranked AS (
    SELECT latest.*,
           ROW_NUMBER() OVER (
               PARTITION BY company_id, owner_user_id
               ORDER BY last_used_at DESC, recipient_email
           ) AS recent_rank
    FROM latest
)
INSERT INTO user_recent_mail_recipients (
    id, company_id, owner_user_id, recipient_email, recipient_name,
    department_name, last_used_at, use_count, created_at, updated_at
)
SELECT
    'recent_' || MD5(company_id || ':' || owner_user_id || ':' || recipient_email),
    company_id, owner_user_id, recipient_email, recipient_name,
    department_name, last_used_at, 1, last_used_at, last_used_at
FROM ranked
WHERE recent_rank <= 200
ON CONFLICT (company_id, owner_user_id, (LOWER(recipient_email))) DO NOTHING;
