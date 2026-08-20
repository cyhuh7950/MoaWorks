ALTER TABLE messenger_rooms
    ADD COLUMN IF NOT EXISTS translation_locale TEXT NOT NULL DEFAULT 'ko';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'messenger_rooms_translation_locale_check'
    ) THEN
        ALTER TABLE messenger_rooms
            ADD CONSTRAINT messenger_rooms_translation_locale_check
            CHECK (translation_locale IN ('ko', 'en', 'ja', 'zh-cn', 'es', 'fr', 'de'));
    END IF;
END $$;

COMMENT ON COLUMN messenger_rooms.translation_locale IS
    'Target language used to display optional LLM translations while preserving original messages.';