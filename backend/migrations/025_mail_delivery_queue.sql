ALTER TABLE mail_provider_configs
    ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tls_mode TEXT NOT NULL DEFAULT 'starttls',
    ADD COLUMN IF NOT EXISTS from_address TEXT NULL,
    ADD COLUMN IF NOT EXISTS last_connection_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_connection_error TEXT NULL,
    ADD COLUMN IF NOT EXISTS max_retry_count INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS retry_interval_sec INTEGER NOT NULL DEFAULT 60;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'mail_delivery_queue'
          AND column_name = 'provider_id'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'mail_delivery_queue'
          AND column_name = 'provider_config_id'
    ) THEN
        IF to_regclass('public.mail_delivery_queue_v007') IS NOT NULL
            OR to_regclass('public.mail_delivery_attempts_v007') IS NOT NULL
            OR to_regclass('public.mail_delivery_events_v007') IS NOT NULL THEN
            RAISE EXCEPTION 'legacy mail delivery preservation tables already exist';
        END IF;

        IF to_regclass('public.mail_delivery_attempts') IS NOT NULL THEN
            ALTER TABLE public.mail_delivery_attempts RENAME TO mail_delivery_attempts_v007;
            ALTER TABLE public.mail_delivery_attempts_v007
                RENAME CONSTRAINT mail_delivery_attempts_pkey TO mail_delivery_attempts_v007_pkey;
        END IF;

        IF to_regclass('public.mail_delivery_events') IS NOT NULL THEN
            ALTER TABLE public.mail_delivery_events RENAME TO mail_delivery_events_v007;
            ALTER TABLE public.mail_delivery_events_v007
                RENAME CONSTRAINT mail_delivery_events_pkey TO mail_delivery_events_v007_pkey;
        END IF;

        ALTER TABLE public.mail_delivery_queue RENAME TO mail_delivery_queue_v007;
        ALTER TABLE public.mail_delivery_queue_v007
            RENAME CONSTRAINT mail_delivery_queue_pkey TO mail_delivery_queue_v007_pkey;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS mail_delivery_queue (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_config_id TEXT NOT NULL REFERENCES mail_provider_configs(id) ON DELETE CASCADE,
    mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES mail_recipients(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued','processing','blocked','retry_pending','sent','failed','cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    worker_id TEXT NULL,
    last_error TEXT NULL,
    accepted_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (mail_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS mail_delivery_attempts (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    result TEXT NOT NULL CHECK (result IN ('sent','retry_pending','failed','blocked')),
    error_message TEXT NULL,
    relay_response TEXT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    UNIQUE (queue_id, attempt_number)
);
CREATE TABLE IF NOT EXISTS mail_delivery_worker_heartbeats (
    worker_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('starting','idle','working','degraded','stopped')),
    last_heartbeat_at TIMESTAMPTZ NOT NULL,
    last_success_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_claim ON mail_delivery_queue(status, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_queue_company ON mail_delivery_queue(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_attempts_queue ON mail_delivery_attempts(queue_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_heartbeat ON mail_delivery_worker_heartbeats(last_heartbeat_at DESC);
