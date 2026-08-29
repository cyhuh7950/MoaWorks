from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Literal, get_args, get_origin
import uuid

import pytest
from pydantic import ValidationError
from psycopg import sql
from psycopg.errors import CheckViolation, RaiseException

from app.services.postgres_service import PostgresService


MIGRATION = Path(__file__).parent / "migrations" / "068_admin_mfa_and_active_limit.sql"
POSTGRES_OPT_IN = "MOAWORKS_UI041_POSTGRES_INTEGRATION"
MFA_TABLES = {
    "admin_mfa_profiles",
    "admin_mfa_challenges",
    "admin_mfa_invitations",
    "admin_mfa_recovery_codes",
    "admin_mfa_policy",
    "admin_mfa_break_glass_requests",
    "admin_mfa_break_glass_approvals",
}


@dataclass(frozen=True)
class MigratedPostgres:
    connection: Any
    prefix: str
    company_id: str
    department_id: str
    admin_role_id: str
    regular_role_id: str
    existing_admin_ids: tuple[str, ...]
    regular_user_id: str


def _migration_sql() -> str:
    assert MIGRATION.is_file(), f"required migration is missing: {MIGRATION}"
    return MIGRATION.read_text(encoding="utf-8")


def _literal_values(annotation: Any) -> set[str]:
    if get_origin(annotation) is Literal:
        return {value for value in get_args(annotation) if isinstance(value, str)}
    values: set[str] = set()
    for argument in get_args(annotation):
        values.update(_literal_values(argument))
    return values


@pytest.fixture(scope="module")
def migrated_postgres() -> MigratedPostgres:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to apply migration 068 to PostgreSQL")

    connection = PostgresService().connect()
    prefix = f"task6_{uuid.uuid4().hex}"
    company_id = f"{prefix}_company"
    department_id = f"{prefix}_department"
    admin_role_id = f"{prefix}_admin_role"
    regular_role_id = f"{prefix}_regular_role"
    existing_admin_ids = tuple(f"{prefix}_existing_admin_{index}" for index in range(4))
    regular_user_id = f"{prefix}_regular_user"
    status_constraint = f"{prefix}_legacy_user_status_check"

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO public.companies (id, name, domain, status, created_at)
                VALUES (%s, %s, %s, 'active', statement_timestamp())
                """,
                (company_id, "Task 6 fixture", f"{prefix}.invalid"),
            )
            cursor.execute(
                """
                INSERT INTO public.departments (
                    id, company_id, name, status, sort_order, created_at
                ) VALUES (%s, %s, %s, 'active', 100, statement_timestamp())
                """,
                (department_id, company_id, "Task 6 fixture"),
            )
            cursor.execute(
                """
                INSERT INTO public.roles (
                    id, company_id, name, permissions, status, created_at
                ) VALUES
                    (%s, %s, %s, %s::jsonb, 'active', statement_timestamp()),
                    (%s, %s, %s, %s::jsonb, 'active', statement_timestamp())
                """,
                (
                    admin_role_id,
                    company_id,
                    "Task 6 fixture admin",
                    '["admin:*"]',
                    regular_role_id,
                    company_id,
                    "Task 6 fixture regular",
                    "[]",
                ),
            )
            for index, user_id in enumerate(existing_admin_ids):
                cursor.execute(
                    """
                    INSERT INTO public.users (
                        id, company_id, email, name, password_hash,
                        department_id, role_id, status, user_type,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, 'active', 'admin',
                        statement_timestamp(), statement_timestamp()
                    )
                    """,
                    (
                        user_id,
                        company_id,
                        f"existing-admin-{index}@{prefix}.invalid",
                        f"Existing admin {index}",
                        f"fixture-hash-{prefix}-{index}",
                        department_id,
                        admin_role_id,
                    ),
                )
            cursor.execute(
                """
                INSERT INTO public.users (
                    id, company_id, email, name, password_hash,
                    department_id, role_id, status, user_type,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, 'active', 'user',
                    statement_timestamp(), statement_timestamp()
                )
                """,
                (
                    regular_user_id,
                    company_id,
                    f"regular-user@{prefix}.invalid",
                    "Regular user",
                    f"fixture-hash-{prefix}-regular",
                    department_id,
                    regular_role_id,
                ),
            )
            cursor.execute(
                sql.SQL(
                    "ALTER TABLE public.users ADD CONSTRAINT {} "
                    "CHECK (status IN ('active', 'inactive', 'deleted'))"
                ).format(sql.Identifier(status_constraint))
            )
            cursor.execute(_migration_sql())

        yield MigratedPostgres(
            connection=connection,
            prefix=prefix,
            company_id=company_id,
            department_id=department_id,
            admin_role_id=admin_role_id,
            regular_role_id=regular_role_id,
            existing_admin_ids=existing_admin_ids,
            regular_user_id=regular_user_id,
        )
    finally:
        connection.rollback()
        connection.close()


def test_migration_068_exists_before_schema_contract() -> None:
    """A missing migration must fail before any schema contract can be claimed."""
    assert MIGRATION.is_file(), f"required migration is missing: {MIGRATION}"


def test_directory_user_status_is_closed_and_includes_pending_mfa() -> None:
    from app.schemas.directory import (
        AuthUserSummary,
        DirectoryUserStatus,
        UserCreateRequest,
        UserRecord,
        UserUpdateRequest,
        UserView,
    )

    expected = {"active", "inactive", "deleted", "pending_mfa"}
    assert _literal_values(DirectoryUserStatus) == expected
    for model in (
        UserRecord,
        AuthUserSummary,
        UserCreateRequest,
        UserUpdateRequest,
        UserView,
    ):
        assert _literal_values(model.model_fields["status"].annotation) == expected

    pending = UserCreateRequest(
        name="Pending administrator",
        loginId="pending-admin",
        password="not-a-real-password",
        departmentId="department-1",
        roleId="role-1",
        status="pending_mfa",
        userType="admin",
    )
    assert pending.status == "pending_mfa"
    with pytest.raises(ValidationError):
        UserCreateRequest(
            name="Unknown status",
            loginId="unknown-status",
            password="not-a-real-password",
            departmentId="department-1",
            roleId="role-1",
            status="mfa_bypassed",
            userType="admin",
        )


def test_migration_068_applies_and_exposes_required_tables(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            """,
            (sorted(MFA_TABLES),),
        )
        tables = {row["table_name"] for row in cursor.fetchall()}

    assert tables == MFA_TABLES


def test_challenge_and_encrypted_seed_columns_enforce_security_boundaries(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            """,
            (sorted(MFA_TABLES),),
        )
        columns_by_table: dict[str, set[str]] = {}
        for row in cursor.fetchall():
            columns_by_table.setdefault(row["table_name"], set()).add(row["column_name"])
        cursor.execute(
            """
            SELECT pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace
              AND conrelid IN (
                  'public.admin_mfa_profiles'::regclass,
                  'public.admin_mfa_challenges'::regclass
              )
            """
        )
        security_constraints = " ".join(
            row["definition"].lower() for row in cursor.fetchall()
        )

    assert {
        "purpose",
        "user_id",
        "target_email",
        "code_key_version",
        "code_mac",
        "expires_at",
        "attempt_count",
        "resend_not_before",
        "resend_count",
        "consumed_at",
    } <= columns_by_table["admin_mfa_challenges"]
    for prefix in ("totp", "pending_totp"):
        table = "admin_mfa_profiles" if prefix == "totp" else "admin_mfa_challenges"
        assert {
            f"{prefix}_key_version",
            f"{prefix}_nonce",
            f"{prefix}_ciphertext",
            f"{prefix}_tag",
        } <= columns_by_table[table]
    prohibited_columns = {"secret", "password", "token", "private_key", "otp_code"}
    assert not prohibited_columns.intersection(set().union(*columns_by_table.values()))
    assert "octet_length" in security_constraints
    assert "= 12" in security_constraints
    assert "expires_at" in security_constraints


def test_break_glass_approval_is_unique_per_request_and_approver(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT array_agg(kcu.column_name ORDER BY kcu.ordinal_position)::text[] AS columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_schema = tc.constraint_schema
             AND kcu.constraint_name = tc.constraint_name
             AND kcu.table_name = tc.table_name
            WHERE tc.table_schema = 'public'
              AND tc.table_name = 'admin_mfa_break_glass_approvals'
              AND tc.constraint_type = 'UNIQUE'
            GROUP BY tc.constraint_name
            """
        )
        unique_constraints = {tuple(row["columns"]) for row in cursor.fetchall()}

    assert ("request_id", "approver_id") in unique_constraints


def test_users_status_constraint_is_extended_without_rewriting_existing_admins(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conrelid = 'public.users'::regclass
              AND conname = 'users_status_mfa_check'
            """
        )
        status_constraint = cursor.fetchone()
        cursor.execute(
            """
            SELECT id, status, user_type
            FROM public.users
            WHERE id = ANY(%s)
            ORDER BY id
            """,
            (list(migrated_postgres.existing_admin_ids),),
        )
        existing_admins = cursor.fetchall()
        cursor.execute(
            """
            SELECT count(*) AS count
            FROM public.admin_mfa_profiles
            WHERE user_id = ANY(%s)
            """,
            (list(migrated_postgres.existing_admin_ids),),
        )
        profile_count = cursor.fetchone()["count"]

    assert status_constraint is not None
    assert "pending_mfa" in status_constraint["definition"]
    assert len(existing_admins) == 4
    assert all(row["status"] == "active" for row in existing_admins)
    assert all(row["user_type"] == "admin" for row in existing_admins)
    assert profile_count == 0


def test_empty_profile_cannot_be_active(migrated_postgres: MigratedPostgres) -> None:
    pending_profile_id = f"{migrated_postgres.prefix}_pending_profile"
    user_id = migrated_postgres.existing_admin_ids[0]
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO public.admin_mfa_profiles (id, user_id)
            VALUES (%s, %s)
            RETURNING status
            """,
            (pending_profile_id, user_id),
        )
        assert cursor.fetchone()["status"] == "pending"
        cursor.execute("SELECT status FROM public.users WHERE id = %s", (user_id,))
        assert cursor.fetchone()["status"] == "active"

    with pytest.raises(CheckViolation):
        with migrated_postgres.connection.transaction():
            with migrated_postgres.connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE public.admin_mfa_profiles SET status = 'active' WHERE id = %s",
                    (pending_profile_id,),
                )


def test_existing_over_limit_state_is_preserved_but_new_transition_is_blocked(
    migrated_postgres: MigratedPostgres,
) -> None:
    existing_id = migrated_postgres.existing_admin_ids[0]
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            "UPDATE public.users SET name = name || ' preserved' WHERE id = %s RETURNING status",
            (existing_id,),
        )
        assert cursor.fetchone()["status"] == "active"

    blocked_user_id = f"{migrated_postgres.prefix}_blocked_admin"
    with pytest.raises(RaiseException, match="ADMIN_ACTIVE_LIMIT_REACHED"):
        with migrated_postgres.connection.transaction():
            with migrated_postgres.connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.users (
                        id, company_id, email, name, password_hash,
                        department_id, role_id, status, user_type,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, 'active', 'admin',
                        statement_timestamp(), statement_timestamp()
                    )
                    """,
                    (
                        blocked_user_id,
                        migrated_postgres.company_id,
                        f"blocked-admin@{migrated_postgres.prefix}.invalid",
                        "Blocked admin",
                        f"fixture-hash-{migrated_postgres.prefix}-blocked",
                        migrated_postgres.department_id,
                        migrated_postgres.admin_role_id,
                    ),
                )


def test_pending_admin_is_not_counted_or_granted_active_status(
    migrated_postgres: MigratedPostgres,
) -> None:
    pending_user_id = f"{migrated_postgres.prefix}_pending_admin"
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO public.users (
                id, company_id, email, name, password_hash,
                department_id, role_id, status, user_type,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, 'pending_mfa', 'admin',
                statement_timestamp(), statement_timestamp()
            ) RETURNING status
            """,
            (
                pending_user_id,
                migrated_postgres.company_id,
                f"pending-admin@{migrated_postgres.prefix}.invalid",
                "Pending admin",
                f"fixture-hash-{migrated_postgres.prefix}-pending",
                migrated_postgres.department_id,
                migrated_postgres.admin_role_id,
            ),
        )
        assert cursor.fetchone()["status"] == "pending_mfa"
        cursor.execute(
            "SELECT count(*) AS count FROM public.admin_mfa_profiles WHERE user_id = %s",
            (pending_user_id,),
        )
        assert cursor.fetchone()["count"] == 0


def test_role_admin_permission_expansion_uses_the_same_active_limit_guard(
    migrated_postgres: MigratedPostgres,
) -> None:
    with pytest.raises(RaiseException, match="ADMIN_ACTIVE_LIMIT_REACHED"):
        with migrated_postgres.connection.transaction():
            with migrated_postgres.connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE public.roles SET permissions = %s::jsonb WHERE id = %s",
                    ('["admin:*"]', migrated_postgres.regular_role_id),
                )
