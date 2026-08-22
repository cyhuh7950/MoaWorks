CREATE TABLE IF NOT EXISTS user_personal_profiles (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id),
    external_email VARCHAR(255) NOT NULL DEFAULT '',
    mobile_phone VARCHAR(64) NOT NULL DEFAULT '',
    office_phone VARCHAR(64) NOT NULL DEFAULT '',
    introduction VARCHAR(2000) NOT NULL DEFAULT '',
    postal_code VARCHAR(32) NOT NULL DEFAULT '',
    address_line1 VARCHAR(500) NOT NULL DEFAULT '',
    address_line2 VARCHAR(500) NOT NULL DEFAULT '',
    memo VARCHAR(2000) NOT NULL DEFAULT '',
    anniversary DATE,
    photo_content BYTEA,
    photo_content_type VARCHAR(32),
    version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_personal_profiles_photo_pair_check CHECK (
        (photo_content IS NULL AND photo_content_type IS NULL)
        OR (photo_content IS NOT NULL AND photo_content_type IN ('image/jpeg','image/png','image/webp'))
    ),
    CONSTRAINT user_personal_profiles_photo_size_check CHECK (
        photo_content IS NULL OR octet_length(photo_content) <= 2097152
    )
);

CREATE INDEX IF NOT EXISTS ix_user_personal_profiles_company_owner
    ON user_personal_profiles(company_id, owner_user_id);
