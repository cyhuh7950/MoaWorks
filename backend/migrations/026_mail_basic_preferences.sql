CREATE TABLE IF NOT EXISTS user_mail_basic_preferences (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sender_display_mode TEXT NOT NULL DEFAULT 'name_email' CHECK (sender_display_mode IN ('name', 'name_email')),
    block_remote_images BOOLEAN NOT NULL DEFAULT TRUE,
    disable_risky_tags BOOLEAN NOT NULL DEFAULT TRUE,
    show_route_country BOOLEAN NOT NULL DEFAULT FALSE,
    include_spam_trash_in_search BOOLEAN NOT NULL DEFAULT FALSE,
    show_list_preview BOOLEAN NOT NULL DEFAULT TRUE,
    recipient_input_mode TEXT NOT NULL DEFAULT 'autocomplete' CHECK (recipient_input_mode IN ('autocomplete', 'name_only', 'search')),
    confirm_before_send BOOLEAN NOT NULL DEFAULT TRUE,
    save_sent_copy BOOLEAN NOT NULL DEFAULT TRUE,
    read_receipt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    editor_mode TEXT NOT NULL DEFAULT 'html' CHECK (editor_mode IN ('html', 'plain')),
    compose_mode TEXT NOT NULL DEFAULT 'normal' CHECK (compose_mode IN ('normal', 'popup')),
    message_encoding TEXT NOT NULL DEFAULT 'utf-8' CHECK (message_encoding IN ('utf-8', 'euc-kr', 'iso-2022-jp')),
    draft_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sender_display_name TEXT NOT NULL DEFAULT '',
    reply_to_email TEXT,
    vcard_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_mail_basic_preferences_company_owner UNIQUE (company_id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mail_basic_preferences_company_owner
    ON user_mail_basic_preferences(company_id, owner_user_id);

ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS sender_display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS reply_to_email TEXT;
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS message_encoding TEXT NOT NULL DEFAULT 'utf-8';
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS sender_copy_saved BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS read_receipt_requested BOOLEAN NOT NULL DEFAULT TRUE;

