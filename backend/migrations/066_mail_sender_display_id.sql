ALTER TABLE user_mail_basic_preferences
    DROP CONSTRAINT IF EXISTS user_mail_basic_preferences_sender_display_mode_check;

ALTER TABLE user_mail_basic_preferences
    ADD CONSTRAINT user_mail_basic_preferences_sender_display_mode_check
    CHECK (sender_display_mode IN ('name', 'id', 'name_email'));
