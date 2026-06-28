CREATE TABLE IF NOT EXISTS mail_messages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    sender_account_id TEXT NOT NULL REFERENCES mail_accounts(id),
    sender_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NULL,
    status TEXT NOT NULL,
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    retention_expires_at TIMESTAMPTZ NULL,
    attachment_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mail_recipients (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    recipient_user_id TEXT NULL REFERENCES users(id),
    recipient_email TEXT NOT NULL,
    recipient_kind TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ NULL,
    read_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS mail_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS messenger_rooms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    room_type TEXT NOT NULL,
    room_name TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    retention_expires_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS messenger_room_members (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES messenger_rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    joined_at TIMESTAMPTZ NOT NULL,
    last_read_message_id TEXT NULL,
    last_read_at TIMESTAMPTZ NULL,
    UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messenger_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES messenger_rooms(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    message_type TEXT NOT NULL,
    body TEXT NOT NULL,
    attachment_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    retention_expires_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS messenger_message_reads (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    read_at TIMESTAMPTZ NOT NULL,
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_company_id ON mail_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_sender_user_id ON mail_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_status ON mail_messages(status);
CREATE INDEX IF NOT EXISTS idx_mail_messages_sent_at ON mail_messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_message_id ON mail_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_user_id ON mail_recipients(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_email ON mail_recipients(recipient_email);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_message_id ON mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_messenger_rooms_company_id ON messenger_rooms(company_id);
CREATE INDEX IF NOT EXISTS idx_messenger_room_members_room_id ON messenger_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_messenger_room_members_user_id ON messenger_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messenger_messages_room_id ON messenger_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messenger_messages_created_at ON messenger_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messenger_message_reads_message_id ON messenger_message_reads(message_id);
