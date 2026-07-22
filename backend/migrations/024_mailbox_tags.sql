CREATE TABLE IF NOT EXISTS mail_user_folders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name VARCHAR(40) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_tags (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name VARCHAR(30) NOT NULL,
    color VARCHAR(20) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE mail_recipients
    ADD COLUMN IF NOT EXISTS folder_id TEXT NULL REFERENCES mail_user_folders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS spam_marked_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS purged_by_user_id TEXT NULL REFERENCES users(id);

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS sender_purged_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sender_purged_by_user_id TEXT NULL REFERENCES users(id);

CREATE TABLE IF NOT EXISTS mail_recipient_tags (
    recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES mail_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (recipient_id, tag_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_user_folders_owner_lower_name
    ON mail_user_folders (company_id, user_id, LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_tags_owner_lower_name
    ON mail_tags (company_id, user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_mail_user_folders_owner_sort
    ON mail_user_folders (company_id, user_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_tags_owner_sort
    ON mail_tags (company_id, user_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_folder_state
    ON mail_recipients (folder_id, is_spam, deleted_at, purged_at, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_spam_state
    ON mail_recipients (recipient_user_id, is_spam, deleted_at, purged_at, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_recipient_tags_tag_recipient
    ON mail_recipient_tags (tag_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_sender_trash
    ON mail_messages (sender_user_id, sender_deleted_at, sender_purged_at, updated_at DESC);