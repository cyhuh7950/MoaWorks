ALTER TABLE messenger_room_members
    ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_messenger_room_members_favorite
    ON messenger_room_members (user_id, is_favorite DESC, room_id);

CREATE TABLE IF NOT EXISTS messenger_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    upload_id TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    storage_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messenger_attachments_message_created
    ON messenger_attachments (message_id, created_at DESC);
