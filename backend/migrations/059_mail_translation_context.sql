ALTER TABLE user_mail_basic_preferences
    ADD COLUMN IF NOT EXISTS translation_target_locale VARCHAR(20) NOT NULL DEFAULT 'ko',
    ADD COLUMN IF NOT EXISTS translation_compose_mode VARCHAR(20) NOT NULL DEFAULT 'preview';

ALTER TABLE user_mail_basic_preferences
    DROP CONSTRAINT IF EXISTS chk_user_mail_translation_compose_mode;

ALTER TABLE user_mail_basic_preferences
    ADD CONSTRAINT chk_user_mail_translation_compose_mode
    CHECK (translation_compose_mode IN ('preview', 'apply'));
