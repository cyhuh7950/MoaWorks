CREATE TABLE IF NOT EXISTS mail_engine_daily_send_usage (
    usage_date DATE PRIMARY KEY,
    attempt_count BIGINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
