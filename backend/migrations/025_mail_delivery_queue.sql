ALTER TABLE mail_provider_configs
    ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tls_mode TEXT NOT NULL DEFAULT 'starttls',
    ADD COLUMN IF NOT EXISTS from_address TEXT NULL,
    ADD COLUMN IF NOT EXISTS last_connection_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_connection_error TEXT NULL,
    ADD COLUMN IF NOT EXISTS max_retry_count INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS retry_interval_sec INTEGER NOT NULL DEFAULT 60;

DO $$
DECLARE
    queue_columns TEXT[];
    attempt_columns TEXT[];
    event_columns TEXT[];
    heartbeat_columns TEXT[];
    legacy_queue_columns CONSTANT TEXT[] := ARRAY[
        'attempt_count','body_html','body_text','company_id','created_at','id','last_error','mail_id',
        'next_retry_at','provider_id','provider_key','recipient_email','sender_email','sent_at','status','subject','updated_at'
    ];
    modern_queue_columns CONSTANT TEXT[] := ARRAY[
        'accepted_at','attempt_count','company_id','created_at','id','last_error','lease_expires_at','mail_id',
        'next_attempt_at','provider_config_id','recipient_id','sent_at','status','updated_at','worker_id'
    ];
    legacy_attempt_columns CONSTANT TEXT[] := ARRAY[
        'attempted_at','error_message','id','queue_id','response_detail','status'
    ];
    modern_attempt_columns CONSTANT TEXT[] := ARRAY[
        'attempt_number','error_message','finished_at','id','queue_id','relay_response','result','started_at'
    ];
    legacy_event_columns CONSTANT TEXT[] := ARRAY[
        'created_at','event_type','id','message','payload','queue_id'
    ];
    modern_heartbeat_columns CONSTANT TEXT[] := ARRAY[
        'last_error','last_heartbeat_at','last_success_at','status','updated_at','worker_id'
    ];
    fresh_state BOOLEAN;
    legacy_state BOOLEAN;
    modern_state BOOLEAN;
BEGIN
    SELECT COALESCE(array_agg(column_name::TEXT ORDER BY column_name), ARRAY[]::TEXT[])
      INTO queue_columns
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_delivery_queue';
    SELECT COALESCE(array_agg(column_name::TEXT ORDER BY column_name), ARRAY[]::TEXT[])
      INTO attempt_columns
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_delivery_attempts';
    SELECT COALESCE(array_agg(column_name::TEXT ORDER BY column_name), ARRAY[]::TEXT[])
      INTO event_columns
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_delivery_events';
    SELECT COALESCE(array_agg(column_name::TEXT ORDER BY column_name), ARRAY[]::TEXT[])
      INTO heartbeat_columns
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_delivery_worker_heartbeats';

    fresh_state := queue_columns = ARRAY[]::TEXT[]
        AND attempt_columns = ARRAY[]::TEXT[]
        AND event_columns = ARRAY[]::TEXT[]
        AND heartbeat_columns = ARRAY[]::TEXT[]
        AND to_regclass('public.mail_delivery_queue_v007') IS NULL
        AND to_regclass('public.mail_delivery_attempts_v007') IS NULL
        AND to_regclass('public.mail_delivery_events_v007') IS NULL;

    legacy_state := queue_columns = legacy_queue_columns
        AND attempt_columns = legacy_attempt_columns
        AND event_columns = legacy_event_columns
        AND heartbeat_columns = ARRAY[]::TEXT[]
        AND to_regclass('public.mail_delivery_queue_v007') IS NULL
        AND to_regclass('public.mail_delivery_attempts_v007') IS NULL
        AND to_regclass('public.mail_delivery_events_v007') IS NULL
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_pkey' AND constraint_type='PRIMARY KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_company_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_provider_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_mail_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_attempts' AND constraint_name='mail_delivery_attempts_pkey' AND constraint_type='PRIMARY KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_attempts' AND constraint_name='mail_delivery_attempts_queue_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_events' AND constraint_name='mail_delivery_events_pkey' AND constraint_type='PRIMARY KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_events' AND constraint_name='mail_delivery_events_queue_id_fkey' AND constraint_type='FOREIGN KEY');

    modern_state := queue_columns = modern_queue_columns
        AND attempt_columns = modern_attempt_columns
        AND event_columns = ARRAY[]::TEXT[]
        AND heartbeat_columns = modern_heartbeat_columns
        AND to_regclass('public.mail_delivery_queue_v007') IS NULL
        AND to_regclass('public.mail_delivery_attempts_v007') IS NULL
        AND to_regclass('public.mail_delivery_events_v007') IS NULL
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_pkey' AND constraint_type='PRIMARY KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_company_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_provider_config_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_mail_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_queue' AND constraint_name='mail_delivery_queue_recipient_id_fkey' AND constraint_type='FOREIGN KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_attempts' AND constraint_name='mail_delivery_attempts_pkey' AND constraint_type='PRIMARY KEY')
        AND EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='mail_delivery_attempts' AND constraint_name='mail_delivery_attempts_queue_id_fkey' AND constraint_type='FOREIGN KEY');

    IF NOT fresh_state AND NOT legacy_state AND NOT modern_state THEN
        RAISE EXCEPTION 'MAIL_DELIVERY_025_UNSUPPORTED_CATALOG_STATE';
    END IF;

    IF legacy_state THEN
        ALTER TABLE public.mail_delivery_attempts RENAME TO mail_delivery_attempts_v007;
        ALTER TABLE public.mail_delivery_attempts_v007
            RENAME CONSTRAINT mail_delivery_attempts_pkey TO mail_delivery_attempts_v007_pkey;
        ALTER TABLE public.mail_delivery_events RENAME TO mail_delivery_events_v007;
        ALTER TABLE public.mail_delivery_events_v007
            RENAME CONSTRAINT mail_delivery_events_pkey TO mail_delivery_events_v007_pkey;
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
