ALTER TABLE messenger_rooms
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS closed_by_user_id TEXT NULL REFERENCES users(id);

ALTER TABLE messenger_room_members
    ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_messenger_room_members_active
    ON messenger_room_members (user_id, room_id)
    WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messenger_rooms_retention_cleanup
    ON messenger_rooms (retention_expires_at, id)
    WHERE status = 'deleted';

