from __future__ import annotations

import json
from pathlib import Path
import uuid

from psycopg import sql
from psycopg.errors import CheckViolation

from app.services.mail_daily_send_quota import MailDailySendLimitExceeded, MailDailySendQuota
from app.services.postgres_service import PostgresService


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
EXPECTED_MIGRATIONS = {
    "066_mail_sender_display_id.sql",
    "067_mail_engine_daily_send_limit.sql",
    "068_admin_mfa_and_active_limit.sql",
}


class _SchemaDatabase:
    def __init__(self, schema_name: str) -> None:
        self.schema_name = schema_name

    def connect(self):
        connection = PostgresService().connect()
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(self.schema_name)))
        connection.commit()
        return connection


def _insert_admin(cursor, *, prefix: str, company_id: str, department_id: str, role_id: str, user_id: str, status: str) -> None:
    cursor.execute(
        """
        INSERT INTO public.users (
          id, company_id, email, name, password_hash, department_id,
          role_id, status, user_type, created_at, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'admin', statement_timestamp(), statement_timestamp())
        """,
        (user_id, company_id, f"{user_id}@{prefix}.invalid", user_id, f"hash-{prefix}", department_id, role_id, status),
    )


def _verify_public_transaction(prefix: str) -> dict[str, object]:
    connection = PostgresService().connect()
    company_id = f"{prefix}_company"
    department_id = f"{prefix}_department"
    admin_role_id = f"{prefix}_admin_role"
    regular_role_id = f"{prefix}_regular_role"
    pending_user_id = f"{prefix}_pending_admin"
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT version FROM public.schema_migrations WHERE version = ANY(%s) ORDER BY version",
                (sorted(EXPECTED_MIGRATIONS),),
            )
            applied = {row["version"] for row in cursor.fetchall()}
            if applied != EXPECTED_MIGRATIONS:
                raise AssertionError("migration 066~068 rows are incomplete")

            cursor.execute(
                """
                CREATE TEMP TABLE user_mail_basic_preferences (
                    owner_user_id TEXT PRIMARY KEY,
                    sender_display_mode TEXT NOT NULL DEFAULT 'name',
                    CONSTRAINT user_mail_basic_preferences_sender_display_mode_check
                        CHECK (sender_display_mode IN ('name', 'name_email'))
                ) ON COMMIT DROP
                """
            )
            cursor.execute(
                "INSERT INTO user_mail_basic_preferences (owner_user_id, sender_display_mode) VALUES (%s, 'name')",
                (f"{prefix}_sender",),
            )
            cursor.execute((MIGRATIONS / "066_mail_sender_display_id.sql").read_text(encoding="utf-8"))
            cursor.execute(
                "UPDATE user_mail_basic_preferences SET sender_display_mode = 'id' WHERE owner_user_id = %s RETURNING sender_display_mode",
                (f"{prefix}_sender",),
            )
            if cursor.fetchone()["sender_display_mode"] != "id":
                raise AssertionError("migration 066 did not accept id")
            cursor.execute("SAVEPOINT task11_sender_invalid")
            try:
                cursor.execute(
                    "UPDATE user_mail_basic_preferences SET sender_display_mode = 'email' WHERE owner_user_id = %s",
                    (f"{prefix}_sender",),
                )
            except CheckViolation:
                cursor.execute("ROLLBACK TO SAVEPOINT task11_sender_invalid")
            else:
                raise AssertionError("migration 066 accepted an unknown sender mode")
            finally:
                cursor.execute("RELEASE SAVEPOINT task11_sender_invalid")

            cursor.execute(
                """
                SELECT count(*) AS count
                FROM public.users AS candidate
                LEFT JOIN public.roles AS role_row ON role_row.id = candidate.role_id
                WHERE candidate.status = 'active'
                  AND (candidate.user_type = 'admin' OR pg_catalog.jsonb_exists(COALESCE(role_row.permissions, '[]'::jsonb), 'admin:*'))
                """
            )
            active_before = cursor.fetchone()["count"]
            cursor.execute(
                "INSERT INTO public.companies (id, name, domain, status, created_at) VALUES (%s, %s, %s, 'active', statement_timestamp())",
                (company_id, "Task 11 transaction", f"{prefix}.invalid"),
            )
            cursor.execute(
                "INSERT INTO public.departments (id, company_id, name, status, sort_order, created_at) VALUES (%s, %s, %s, 'active', 100, statement_timestamp())",
                (department_id, company_id, "Task 11 transaction"),
            )
            cursor.execute(
                """
                INSERT INTO public.roles (id, company_id, name, permissions, status, created_at)
                VALUES
                  (%s, %s, %s, '["admin:*"]'::jsonb, 'active', statement_timestamp()),
                  (%s, %s, %s, '[]'::jsonb, 'active', statement_timestamp())
                """,
                (admin_role_id, company_id, "Task 11 admin", regular_role_id, company_id, "Task 11 regular"),
            )

            for index in range(max(0, 3 - active_before)):
                _insert_admin(
                    cursor,
                    prefix=prefix,
                    company_id=company_id,
                    department_id=department_id,
                    role_id=admin_role_id,
                    user_id=f"{prefix}_active_admin_{index}",
                    status="active",
                )

            cursor.execute("SAVEPOINT task11_admin_limit")
            try:
                _insert_admin(
                    cursor,
                    prefix=prefix,
                    company_id=company_id,
                    department_id=department_id,
                    role_id=admin_role_id,
                    user_id=f"{prefix}_blocked_admin",
                    status="active",
                )
            except CheckViolation as exc:
                if exc.diag.message_primary != "ADMIN_ACTIVE_LIMIT_REACHED":
                    raise
                cursor.execute("ROLLBACK TO SAVEPOINT task11_admin_limit")
            else:
                raise AssertionError("migration 068 allowed a fourth active admin")
            finally:
                cursor.execute("RELEASE SAVEPOINT task11_admin_limit")

            _insert_admin(
                cursor,
                prefix=prefix,
                company_id=company_id,
                department_id=department_id,
                role_id=admin_role_id,
                user_id=pending_user_id,
                status="pending_mfa",
            )
            cursor.execute("SAVEPOINT task11_pending_enrollment")
            try:
                cursor.execute(
                    "INSERT INTO public.admin_mfa_profiles (id, user_id, status) VALUES (%s, %s, 'pending')",
                    (f"{prefix}_profile", pending_user_id),
                )
                cursor.execute(
                    """
                    INSERT INTO public.admin_mfa_invitations (
                      id, target_user_id, invitation_kind, requested_role_id, status, expires_at
                    ) VALUES (%s, %s, 'new', %s, 'pending', statement_timestamp() + interval '10 minutes')
                    """,
                    (f"{prefix}_invitation", pending_user_id, admin_role_id),
                )
                cursor.execute(
                    """
                    INSERT INTO public.admin_mfa_challenges (id, challenge_hash, purpose, user_id, expires_at)
                    VALUES (%s, %s, 'admin_enrollment', %s, statement_timestamp() + interval '10 minutes')
                    """,
                    (f"{prefix}_challenge", uuid.uuid4().bytes, pending_user_id),
                )
                cursor.execute(
                    "UPDATE public.users SET status = 'active', updated_at = statement_timestamp() WHERE id = %s",
                    (pending_user_id,),
                )
            except CheckViolation as exc:
                if exc.diag.message_primary != "ADMIN_ACTIVE_LIMIT_REACHED":
                    raise
                cursor.execute("ROLLBACK TO SAVEPOINT task11_pending_enrollment")
            else:
                raise AssertionError("pending enrollment failure did not roll back")
            finally:
                cursor.execute("RELEASE SAVEPOINT task11_pending_enrollment")

            cursor.execute(
                """
                SELECT
                  (SELECT status FROM public.users WHERE id = %s) AS user_status,
                  (SELECT count(*) FROM public.admin_mfa_profiles WHERE user_id = %s) AS profiles,
                  (SELECT count(*) FROM public.admin_mfa_invitations WHERE target_user_id = %s) AS invitations,
                  (SELECT count(*) FROM public.admin_mfa_challenges WHERE user_id = %s) AS challenges
                """,
                (pending_user_id, pending_user_id, pending_user_id, pending_user_id),
            )
            pending = dict(cursor.fetchone())
            if pending != {"user_status": "pending_mfa", "profiles": 0, "invitations": 0, "challenges": 0}:
                raise AssertionError("pending enrollment rollback left child rows")
        connection.rollback()
    finally:
        connection.rollback()
        connection.close()

    verification = PostgresService().connect()
    try:
        with verification.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  (SELECT count(*) FROM public.companies WHERE id = %s) AS companies,
                  (SELECT count(*) FROM public.departments WHERE id = %s) AS departments,
                  (SELECT count(*) FROM public.roles WHERE company_id = %s) AS roles,
                  (SELECT count(*) FROM public.users WHERE company_id = %s) AS users
                """,
                (company_id, department_id, company_id, company_id),
            )
            residue = dict(cursor.fetchone())
        if any(residue.values()):
            raise AssertionError("public transaction QA residue remains")
    finally:
        verification.rollback()
        verification.close()

    return {
        "migrations": sorted(EXPECTED_MIGRATIONS),
        "senderIdAccepted": True,
        "activeAdminBefore": active_before,
        "fourthAdminRejected": True,
        "pendingEnrollmentRolledBack": True,
        "publicResidue": 0,
    }


def _verify_quota_schema(prefix: str) -> dict[str, object]:
    schema_name = f"{prefix}_quota"
    control = PostgresService().connect()
    created = False
    first = second = None
    third_rejected = False
    try:
        with control.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))
            cursor.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema_name)))
            cursor.execute((MIGRATIONS / "067_mail_engine_daily_send_limit.sql").read_text(encoding="utf-8"))
        control.commit()
        created = True

        quota = MailDailySendQuota(_SchemaDatabase(schema_name), limit=2)
        first = quota.reserve_attempt()
        second = quota.reserve_attempt()
        try:
            quota.reserve_attempt()
        except MailDailySendLimitExceeded:
            third_rejected = True
        else:
            raise AssertionError("quota N+1 attempt was accepted")
        if (first.used, second.used) != (1, 2):
            raise AssertionError("quota N sequence is incorrect")

        probe = _SchemaDatabase(schema_name).connect()
        try:
            with probe.cursor() as cursor:
                cursor.execute("SELECT count(*) AS rows, sum(attempt_count) AS attempts FROM mail_engine_daily_send_usage")
                usage = dict(cursor.fetchone())
        finally:
            probe.rollback()
            probe.close()
        if usage != {"rows": 1, "attempts": 2}:
            raise AssertionError("quota usage row is inconsistent")
    finally:
        control.rollback()
        if created:
            with control.cursor() as cursor:
                cursor.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema_name)))
            control.commit()
        control.close()

    residue_probe = PostgresService().connect()
    try:
        with residue_probe.cursor() as cursor:
            cursor.execute("SELECT to_regnamespace(%s) AS schema_oid", (schema_name,))
            if cursor.fetchone()["schema_oid"] is not None:
                raise AssertionError("quota schema residue remains")
    finally:
        residue_probe.rollback()
        residue_probe.close()

    return {
        "acceptedUses": [first.used, second.used],
        "nPlusOneRejected": third_rejected,
        "schemaResidue": 0,
    }


def main() -> None:
    prefix = f"task11_{uuid.uuid4().hex}"
    result = {
        "status": "TASK11_TRANSACTION_ACCEPTANCE_PASS",
        "publicTransaction": _verify_public_transaction(prefix),
        "quotaSchema": _verify_quota_schema(prefix),
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
