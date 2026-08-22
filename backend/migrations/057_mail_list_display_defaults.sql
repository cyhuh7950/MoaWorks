ALTER TABLE user_mail_basic_preferences
    ALTER COLUMN sender_display_mode SET DEFAULT 'name',
    ALTER COLUMN show_list_preview SET DEFAULT FALSE;