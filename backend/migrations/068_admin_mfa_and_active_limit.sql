DO $migration$
DECLARE
    status_attribute SMALLINT;
    status_constraint RECORD;
    extracted_value TEXT;
    extracted_count INTEGER;
    allowed_statuses TEXT[] := ARRAY['active', 'inactive', 'deleted', 'pending_mfa'];
BEGIN
    SELECT attnum
    INTO status_attribute
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.users'::regclass
      AND attname = 'status'
      AND NOT attisdropped;

    FOR status_constraint IN
        SELECT constraint_row.oid, constraint_row.conname
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.users'::regclass
          AND constraint_row.contype = 'c'
          AND constraint_row.conkey = ARRAY[status_attribute]::SMALLINT[]
    LOOP
        extracted_count := 0;
        FOR extracted_value IN
            SELECT replace(matches[1], '''''', '''')
            FROM pg_catalog.regexp_matches(
                pg_catalog.pg_get_constraintdef(status_constraint.oid),
                '''((?:''''|[^''])*)''',
                'g'
            ) AS matches
        LOOP
            allowed_statuses := pg_catalog.array_append(allowed_statuses, extracted_value);
            extracted_count := extracted_count + 1;
        END LOOP;

        IF extracted_count = 0 THEN
            RAISE EXCEPTION
                'cannot safely extend users.status constraint %',
                status_constraint.conname;
        END IF;

        EXECUTE pg_catalog.format(
            'ALTER TABLE public.users DROP CONSTRAINT %I',
            status_constraint.conname
        );
    END LOOP;

    SELECT pg_catalog.array_agg(DISTINCT status_value ORDER BY status_value)
    INTO allowed_statuses
    FROM pg_catalog.unnest(allowed_statuses) AS status_value;

    EXECUTE pg_catalog.format(
        'ALTER TABLE public.users ADD CONSTRAINT users_status_mfa_check '
        'CHECK (status = ANY (%L::text[])) NOT VALID',
        allowed_statuses
    );
    ALTER TABLE public.users VALIDATE CONSTRAINT users_status_mfa_check;
END
$migration$;

CREATE TABLE admin_mfa_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    recovery_email TEXT,
    recovery_email_verified_at TIMESTAMPTZ,
    totp_key_version INTEGER,
    totp_nonce BYTEA,
    totp_ciphertext BYTEA,
    totp_tag BYTEA,
    profile_version BIGINT NOT NULL DEFAULT 0 CHECK (profile_version >= 0),
    last_used_step BIGINT CHECK (last_used_step >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'disabled')),
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT admin_mfa_profiles_seed_shape_check CHECK (
        pg_catalog.num_nonnulls(
            totp_key_version, totp_nonce, totp_ciphertext, totp_tag
        ) = 0 OR (
            pg_catalog.num_nonnulls(
                totp_key_version, totp_nonce, totp_ciphertext, totp_tag
            ) = 4
            AND totp_key_version > 0
            AND octet_length(totp_nonce) = 12
            AND octet_length(totp_ciphertext) > 0
            AND octet_length(totp_tag) = 16
        )
    ),
    CONSTRAINT admin_mfa_profiles_active_material_check CHECK (
        status <> 'active' OR (
            recovery_email IS NOT NULL
            AND recovery_email_verified_at IS NOT NULL
            AND totp_key_version IS NOT NULL
            AND totp_nonce IS NOT NULL
            AND totp_ciphertext IS NOT NULL
            AND totp_tag IS NOT NULL
            AND activated_at IS NOT NULL
        )
    )
);

CREATE TABLE admin_mfa_challenges (
    id TEXT PRIMARY KEY,
    challenge_hash BYTEA NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (
        purpose IN (
            'login', 'enroll', 'admin_enrollment', 'email_verify',
            'recovery', 'mfa_reenroll'
        )
    ),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_email TEXT,
    code_key_version INTEGER,
    code_mac BYTEA,
    pending_totp_key_version INTEGER,
    pending_totp_nonce BYTEA,
    pending_totp_ciphertext BYTEA,
    pending_totp_tag BYTEA,
    expires_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    resend_not_before TIMESTAMPTZ,
    resend_count INTEGER NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
    consumed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT admin_mfa_challenges_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT admin_mfa_challenges_code_shape_check CHECK (
        pg_catalog.num_nonnulls(code_key_version, code_mac) = 0
        OR (
            pg_catalog.num_nonnulls(code_key_version, code_mac) = 2
            AND code_key_version > 0
            AND octet_length(code_mac) > 0
        )
    ),
    CONSTRAINT admin_mfa_challenges_pending_seed_shape_check CHECK (
        pg_catalog.num_nonnulls(
            pending_totp_key_version, pending_totp_nonce,
            pending_totp_ciphertext, pending_totp_tag
        ) = 0 OR (
            pg_catalog.num_nonnulls(
                pending_totp_key_version, pending_totp_nonce,
                pending_totp_ciphertext, pending_totp_tag
            ) = 4
            AND pending_totp_key_version > 0
            AND octet_length(pending_totp_nonce) = 12
            AND octet_length(pending_totp_ciphertext) > 0
            AND octet_length(pending_totp_tag) = 16
        )
    ),
    CONSTRAINT admin_mfa_challenges_email_binding_check CHECK (
        purpose NOT IN ('email_verify', 'recovery')
        OR (target_email IS NOT NULL AND code_key_version IS NOT NULL AND code_mac IS NOT NULL)
    ),
    CONSTRAINT admin_mfa_challenges_terminal_time_check CHECK (
        (consumed_at IS NULL OR consumed_at >= created_at)
        AND (cancelled_at IS NULL OR cancelled_at >= created_at)
        AND NOT (consumed_at IS NOT NULL AND cancelled_at IS NOT NULL)
    )
);

CREATE TABLE admin_mfa_invitations (
    id TEXT PRIMARY KEY,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitation_kind TEXT NOT NULL CHECK (
        invitation_kind IN ('new', 'promotion', 'reactivation', 'bootstrap')
    ),
    requested_user_type TEXT NOT NULL DEFAULT 'admin' CHECK (requested_user_type = 'admin'),
    requested_role_id TEXT REFERENCES roles(id),
    requested_status TEXT NOT NULL DEFAULT 'active' CHECK (requested_status = 'active'),
    requested_by_user_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT admin_mfa_invitations_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT admin_mfa_invitations_terminal_check CHECK (
        (status = 'pending' AND completed_at IS NULL AND cancelled_at IS NULL)
        OR (
            status = 'completed'
            AND completed_at IS NOT NULL
            AND completed_at >= created_at
            AND cancelled_at IS NULL
        )
        OR (
            status = 'cancelled'
            AND cancelled_at IS NOT NULL
            AND cancelled_at >= created_at
            AND completed_at IS NULL
        )
        OR (status = 'expired' AND completed_at IS NULL AND cancelled_at IS NULL)
    )
);

CREATE TABLE admin_mfa_recovery_codes (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES admin_mfa_profiles(id) ON DELETE CASCADE,
    code_key_version INTEGER NOT NULL CHECK (code_key_version > 0),
    code_mac BYTEA NOT NULL CHECK (octet_length(code_mac) > 0),
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (profile_id, code_mac)
);

CREATE TABLE admin_mfa_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enforcement_mode TEXT NOT NULL DEFAULT 'optional'
        CHECK (enforcement_mode IN ('optional', 'required')),
    required_epoch BIGINT NOT NULL DEFAULT 0 CHECK (required_epoch >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

INSERT INTO admin_mfa_policy (singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE admin_mfa_break_glass_requests (
    request_id TEXT PRIMARY KEY,
    target_user_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    correlation_id TEXT NOT NULL CHECK (length(btrim(correlation_id)) > 0),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) >= 16),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'consumed', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    result_challenge_id TEXT REFERENCES admin_mfa_challenges(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT admin_mfa_break_glass_requests_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT admin_mfa_break_glass_requests_terminal_check CHECK (
        (status = 'pending' AND consumed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND consumed_at IS NULL)
        OR (status = 'expired' AND consumed_at IS NULL AND cancelled_at IS NULL)
    )
);

CREATE TABLE admin_mfa_break_glass_approvals (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES admin_mfa_break_glass_requests(request_id),
    approver_id TEXT NOT NULL CHECK (length(btrim(approver_id)) > 0),
    key_version INTEGER NOT NULL CHECK (key_version > 0),
    payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) > 0),
    detached_signature BYTEA NOT NULL CHECK (octet_length(detached_signature) > 0),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (request_id, approver_id)
);

CREATE UNIQUE INDEX admin_mfa_invitations_one_pending_per_user
    ON admin_mfa_invitations (target_user_id)
    WHERE status = 'pending';
CREATE INDEX admin_mfa_challenges_open_by_user
    ON admin_mfa_challenges (user_id, purpose, expires_at)
    WHERE consumed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX admin_mfa_challenges_expiry
    ON admin_mfa_challenges (expires_at);
CREATE INDEX admin_mfa_recovery_codes_unused
    ON admin_mfa_recovery_codes (profile_id)
    WHERE used_at IS NULL;
CREATE INDEX admin_mfa_break_glass_requests_pending
    ON admin_mfa_break_glass_requests (expires_at)
    WHERE status = 'pending';
CREATE INDEX admin_mfa_break_glass_approvals_request
    ON admin_mfa_break_glass_approvals (request_id);

CREATE OR REPLACE FUNCTION public.enforce_admin_active_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
    old_is_active_admin BOOLEAN := FALSE;
    new_is_active_admin BOOLEAN;
    active_admin_count BIGINT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        old_is_active_admin := OLD.status = 'active' AND (
            OLD.user_type = 'admin'
            OR EXISTS (
                SELECT 1
                FROM public.roles AS old_role
                WHERE old_role.id = OLD.role_id
                  AND pg_catalog.jsonb_exists(old_role.permissions, 'admin:*')
            )
        );
    END IF;

    new_is_active_admin := NEW.status = 'active' AND (
        NEW.user_type = 'admin'
        OR EXISTS (
            SELECT 1
            FROM public.roles AS new_role
            WHERE new_role.id = NEW.role_id
              AND pg_catalog.jsonb_exists(new_role.permissions, 'admin:*')
        )
    );

    IF NOT old_is_active_admin AND new_is_active_admin THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(1297043287, 3);
        SELECT pg_catalog.count(*)
        INTO active_admin_count
        FROM public.users AS existing_user
        LEFT JOIN public.roles AS existing_role ON existing_role.id = existing_user.role_id
        WHERE existing_user.id <> NEW.id
          AND existing_user.status = 'active'
          AND (
              existing_user.user_type = 'admin'
              OR pg_catalog.jsonb_exists(existing_role.permissions, 'admin:*')
          );

        IF active_admin_count >= 3 THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'ADMIN_ACTIVE_LIMIT_REACHED';
        END IF;
    END IF;

    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.enforce_admin_active_role_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
    current_active_admin_count BIGINT;
    newly_privileged_user_count BIGINT;
BEGIN
    IF NOT pg_catalog.jsonb_exists(COALESCE(OLD.permissions, '[]'::jsonb), 'admin:*')
       AND pg_catalog.jsonb_exists(COALESCE(NEW.permissions, '[]'::jsonb), 'admin:*') THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(1297043287, 3);

        SELECT pg_catalog.count(*)
        INTO current_active_admin_count
        FROM public.users AS existing_user
        LEFT JOIN public.roles AS existing_role ON existing_role.id = existing_user.role_id
        WHERE existing_user.status = 'active'
          AND (
              existing_user.user_type = 'admin'
              OR pg_catalog.jsonb_exists(existing_role.permissions, 'admin:*')
          );

        SELECT pg_catalog.count(*)
        INTO newly_privileged_user_count
        FROM public.users AS role_user
        WHERE role_user.role_id = NEW.id
          AND role_user.status = 'active'
          AND role_user.user_type <> 'admin';

        IF newly_privileged_user_count > 0
           AND current_active_admin_count + newly_privileged_user_count > 3 THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'ADMIN_ACTIVE_LIMIT_REACHED';
        END IF;
    END IF;

    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS users_admin_active_limit_guard ON public.users;
CREATE TRIGGER users_admin_active_limit_guard
BEFORE INSERT OR UPDATE OF status, user_type, role_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_active_user_limit();

DROP TRIGGER IF EXISTS roles_admin_active_limit_guard ON public.roles;
CREATE TRIGGER roles_admin_active_limit_guard
BEFORE UPDATE OF permissions ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_active_role_limit();
