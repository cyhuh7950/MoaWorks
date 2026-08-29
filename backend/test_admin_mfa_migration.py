from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile
from typing import Any, Literal, get_args, get_origin
import uuid

import pytest
from pydantic import ValidationError
from psycopg import sql
from psycopg.errors import CheckViolation, DivisionByZero

from app.core.config import settings
from app.schemas.setup import DbConfigPayload
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
MFA_TABLE_DROP_ORDER = (
    "admin_mfa_break_glass_approvals",
    "admin_mfa_break_glass_requests",
    "admin_mfa_recovery_codes",
    "admin_mfa_invitations",
    "admin_mfa_challenges",
    "admin_mfa_profiles",
    "admin_mfa_policy",
)


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


def _runtime_db_config() -> DbConfigPayload:
    return DbConfigPayload(
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )


def _require_postgres_opt_in() -> None:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to use the existing PostgreSQL runtime")


def _assert_check_violation(connection: Any, statement: str, parameters: tuple[Any, ...]) -> None:
    savepoint = sql.Identifier(f"task6_expected_check_{uuid.uuid4().hex}")
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("SAVEPOINT {}").format(savepoint))
        try:
            with pytest.raises(CheckViolation):
                cursor.execute(statement, parameters)
        finally:
            cursor.execute(sql.SQL("ROLLBACK TO SAVEPOINT {}").format(savepoint))
            cursor.execute(sql.SQL("RELEASE SAVEPOINT {}").format(savepoint))


def _task6_catalog_counts(connection: Any) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                (SELECT count(*)
                   FROM pg_class
                  WHERE relnamespace = 'public'::regnamespace
                    AND relname = ANY(%s)) AS tables,
                (SELECT count(*)
                   FROM pg_proc
                  WHERE pronamespace = 'public'::regnamespace
                    AND proname = ANY(%s)) AS functions,
                (SELECT count(*)
                   FROM pg_trigger
                  WHERE NOT tgisinternal
                    AND tgname = ANY(%s)) AS triggers,
                (SELECT count(*)
                   FROM pg_constraint
                  WHERE conrelid = 'public.users'::regclass
                    AND conname = 'users_status_mfa_check') AS status_constraints,
                (SELECT count(*)
                   FROM public.schema_migrations
                  WHERE version = %s) AS migration_rows
            """,
            (
                sorted(MFA_TABLES),
                ["enforce_admin_active_user_limit", "enforce_admin_active_role_limit"],
                ["users_admin_active_limit_guard", "roles_admin_active_limit_guard"],
                MIGRATION.name,
            ),
        )
        return dict(cursor.fetchone())


def _cleanup_runner_applied_migration(
    connection: Any,
    prior_status_constraints: list[tuple[str, str]],
) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DROP TRIGGER IF EXISTS users_admin_active_limit_guard ON public.users")
        cursor.execute("DROP TRIGGER IF EXISTS roles_admin_active_limit_guard ON public.roles")
        cursor.execute("DROP FUNCTION IF EXISTS public.enforce_admin_active_user_limit()")
        cursor.execute("DROP FUNCTION IF EXISTS public.enforce_admin_active_role_limit()")
        for table_name in MFA_TABLE_DROP_ORDER:
            cursor.execute(
                sql.SQL("DROP TABLE public.{}").format(sql.Identifier(table_name))
            )
        cursor.execute(
            "ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_mfa_check"
        )
        for constraint_name, definition in prior_status_constraints:
            cursor.execute(
                sql.SQL("ALTER TABLE public.users ADD CONSTRAINT {} {}").format(
                    sql.Identifier(constraint_name),
                    sql.SQL(definition),
                )
            )
        cursor.execute(
            "DELETE FROM public.schema_migrations WHERE version = %s RETURNING version",
            (MIGRATION.name,),
        )
        assert [row["version"] for row in cursor.fetchall()] == [MIGRATION.name]
    connection.commit()


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


def test_postgres_service_applies_068_once_records_exact_version_and_then_noops() -> None:
    _require_postgres_opt_in()
    db_config = _runtime_db_config()
    connection = PostgresService().connect(db_config)
    applied_by_test = False
    prior_status_constraints: list[tuple[str, str]] = []
    temporary_path: Path | None = None
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT conname, pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE conrelid = 'public.users'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%%status%%'
                ORDER BY conname
                """
            )
            prior_status_constraints = [
                (row["conname"], row["definition"]) for row in cursor.fetchall()
            ]

        assert _task6_catalog_counts(connection) == {
            "tables": 0,
            "functions": 0,
            "triggers": 0,
            "status_constraints": 0,
            "migration_rows": 0,
        }

        with tempfile.TemporaryDirectory(prefix="moaworks-task6-fix1-runner-") as temp_dir:
            temporary_path = Path(temp_dir)
            (temporary_path / MIGRATION.name).write_text(
                _migration_sql(), encoding="utf-8"
            )
            service = PostgresService(migration_dir=temporary_path)
            service.ensure_migrations_applied(db_config=db_config)
            applied_by_test = True

            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) AS count FROM public.schema_migrations WHERE version = %s",
                    (MIGRATION.name,),
                )
                assert cursor.fetchone()["count"] == 1
                cursor.execute(
                    "SELECT oid FROM pg_class WHERE oid = 'public.admin_mfa_profiles'::regclass"
                )
                first_table_oid = cursor.fetchone()["oid"]

            PostgresService(migration_dir=temporary_path).ensure_migrations_applied(
                db_config=db_config
            )

            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) AS count FROM public.schema_migrations WHERE version = %s",
                    (MIGRATION.name,),
                )
                assert cursor.fetchone()["count"] == 1
                cursor.execute(
                    "SELECT oid FROM pg_class WHERE oid = 'public.admin_mfa_profiles'::regclass"
                )
                assert cursor.fetchone()["oid"] == first_table_oid
    finally:
        if applied_by_test:
            _cleanup_runner_applied_migration(connection, prior_status_constraints)
            assert _task6_catalog_counts(connection) == {
                "tables": 0,
                "functions": 0,
                "triggers": 0,
                "status_constraints": 0,
                "migration_rows": 0,
            }
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT conname, pg_get_constraintdef(oid) AS definition
                    FROM pg_constraint
                    WHERE conrelid = 'public.users'::regclass
                      AND contype = 'c'
                      AND pg_get_constraintdef(oid) ILIKE '%%status%%'
                    ORDER BY conname
                    """
                )
                restored_status_constraints = [
                    (row["conname"], row["definition"]) for row in cursor.fetchall()
                ]
            assert restored_status_constraints == prior_status_constraints
        connection.close()

    assert temporary_path is not None
    assert not temporary_path.exists()


def test_postgres_service_rolls_back_failed_migration_atomically() -> None:
    _require_postgres_opt_in()
    db_config = _runtime_db_config()
    suffix = uuid.uuid4().hex
    version = f"998_task6_atomic_rollback_{suffix}.sql"
    table_name = f"task6_atomic_rollback_{suffix}"
    temporary_path: Path | None = None

    with tempfile.TemporaryDirectory(prefix="moaworks-task6-fix1-rollback-") as temp_dir:
        temporary_path = Path(temp_dir)
        (temporary_path / version).write_text(
            f"CREATE TABLE public.{table_name} (id integer PRIMARY KEY); SELECT 1 / 0;",
            encoding="utf-8",
        )
        try:
            with pytest.raises(DivisionByZero):
                PostgresService(migration_dir=temporary_path).ensure_migrations_applied(
                    db_config=db_config
                )

            with PostgresService().connect(db_config) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) AS count FROM public.schema_migrations WHERE version = %s",
                        (version,),
                    )
                    assert cursor.fetchone()["count"] == 0
                    cursor.execute("SELECT to_regclass(%s) AS table_name", (f"public.{table_name}",))
                    assert cursor.fetchone()["table_name"] is None
        finally:
            with PostgresService().connect(db_config) as cleanup_connection:
                with cleanup_connection.cursor() as cursor:
                    cursor.execute(
                        sql.SQL("DROP TABLE IF EXISTS public.{}").format(
                            sql.Identifier(table_name)
                        )
                    )
                    cursor.execute(
                        "DELETE FROM public.schema_migrations WHERE version = %s",
                        (version,),
                    )
                cleanup_connection.commit()

    assert temporary_path is not None
    assert not temporary_path.exists()


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


@pytest.mark.parametrize(
    ("case_name", "key_version", "nonce", "ciphertext", "tag"),
    [
        ("missing-key-version", None, b"n" * 12, b"ciphertext", b"t" * 16),
        ("missing-nonce", 1, None, b"ciphertext", b"t" * 16),
        ("missing-ciphertext", 1, b"n" * 12, None, b"t" * 16),
        ("missing-tag", 1, b"n" * 12, b"ciphertext", None),
        ("nonce-11-bytes", 1, b"n" * 11, b"ciphertext", b"t" * 16),
        ("nonce-13-bytes", 1, b"n" * 13, b"ciphertext", b"t" * 16),
        ("tag-15-bytes", 1, b"n" * 12, b"ciphertext", b"t" * 15),
        ("tag-17-bytes", 1, b"n" * 12, b"ciphertext", b"t" * 17),
    ],
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_profile_totp_seed_rejects_partial_or_invalid_material(
    migrated_postgres: MigratedPostgres,
    case_name: str,
    key_version: int | None,
    nonce: bytes | None,
    ciphertext: bytes | None,
    tag: bytes | None,
) -> None:
    _assert_check_violation(
        migrated_postgres.connection,
        """
        INSERT INTO public.admin_mfa_profiles (
            id, user_id, totp_key_version, totp_nonce, totp_ciphertext, totp_tag
        ) VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            f"{migrated_postgres.prefix}_profile_shape_{case_name}",
            migrated_postgres.regular_user_id,
            key_version,
            nonce,
            ciphertext,
            tag,
        ),
    )


@pytest.mark.parametrize(
    ("case_name", "key_version", "nonce", "ciphertext", "tag"),
    [
        ("missing-key-version", None, b"n" * 12, b"ciphertext", b"t" * 16),
        ("missing-nonce", 1, None, b"ciphertext", b"t" * 16),
        ("missing-ciphertext", 1, b"n" * 12, None, b"t" * 16),
        ("missing-tag", 1, b"n" * 12, b"ciphertext", None),
        ("nonce-11-bytes", 1, b"n" * 11, b"ciphertext", b"t" * 16),
        ("nonce-13-bytes", 1, b"n" * 13, b"ciphertext", b"t" * 16),
        ("tag-15-bytes", 1, b"n" * 12, b"ciphertext", b"t" * 15),
        ("tag-17-bytes", 1, b"n" * 12, b"ciphertext", b"t" * 17),
    ],
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_challenge_pending_totp_seed_rejects_partial_or_invalid_material(
    migrated_postgres: MigratedPostgres,
    case_name: str,
    key_version: int | None,
    nonce: bytes | None,
    ciphertext: bytes | None,
    tag: bytes | None,
) -> None:
    _assert_check_violation(
        migrated_postgres.connection,
        """
        INSERT INTO public.admin_mfa_challenges (
            id, challenge_hash, purpose, user_id,
            pending_totp_key_version, pending_totp_nonce,
            pending_totp_ciphertext, pending_totp_tag, expires_at
        ) VALUES (
            %s, %s, 'login', %s, %s, %s, %s, %s,
            statement_timestamp() + interval '5 minutes'
        )
        """,
        (
            f"{migrated_postgres.prefix}_pending_shape_{case_name}",
            uuid.uuid4().bytes,
            migrated_postgres.regular_user_id,
            key_version,
            nonce,
            ciphertext,
            tag,
        ),
    )


@pytest.mark.parametrize(
    ("case_name", "key_version", "code_mac"),
    [
        ("missing-key-version", None, b"mac"),
        ("missing-mac", 1, None),
        ("non-positive-key-version", 0, b"mac"),
        ("empty-mac", 1, b""),
    ],
)
def test_challenge_mac_rejects_partial_or_invalid_material(
    migrated_postgres: MigratedPostgres,
    case_name: str,
    key_version: int | None,
    code_mac: bytes | None,
) -> None:
    _assert_check_violation(
        migrated_postgres.connection,
        """
        INSERT INTO public.admin_mfa_challenges (
            id, challenge_hash, purpose, user_id,
            code_key_version, code_mac, expires_at
        ) VALUES (
            %s, %s, 'login', %s, %s, %s,
            statement_timestamp() + interval '5 minutes'
        )
        """,
        (
            f"{migrated_postgres.prefix}_mac_shape_{case_name}",
            uuid.uuid4().bytes,
            migrated_postgres.regular_user_id,
            key_version,
            code_mac,
        ),
    )


def test_seed_and_mac_material_accepts_only_complete_or_all_null_shapes(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO public.admin_mfa_profiles (
                id, user_id, totp_key_version, totp_nonce, totp_ciphertext, totp_tag
            ) VALUES (%s, %s, 1, %s, %s, %s)
            """,
            (
                f"{migrated_postgres.prefix}_complete_profile",
                migrated_postgres.regular_user_id,
                b"n" * 12,
                b"ciphertext",
                b"t" * 16,
            ),
        )
        for suffix, key_version, code_mac, pending_values in (
            ("all_null", None, None, (None, None, None, None)),
            (
                "complete",
                1,
                b"mac",
                (1, b"n" * 12, b"ciphertext", b"t" * 16),
            ),
        ):
            cursor.execute(
                """
                INSERT INTO public.admin_mfa_challenges (
                    id, challenge_hash, purpose, user_id, code_key_version, code_mac,
                    pending_totp_key_version, pending_totp_nonce,
                    pending_totp_ciphertext, pending_totp_tag, expires_at
                ) VALUES (
                    %s, %s, 'login', %s, %s, %s, %s, %s, %s, %s,
                    statement_timestamp() + interval '5 minutes'
                )
                """,
                (
                    f"{migrated_postgres.prefix}_valid_shape_{suffix}",
                    uuid.uuid4().bytes,
                    migrated_postgres.regular_user_id,
                    key_version,
                    code_mac,
                    *pending_values,
                ),
            )


@pytest.mark.parametrize(
    ("status", "has_completed_at", "has_cancelled_at"),
    [
        ("pending", True, False),
        ("pending", False, True),
        ("completed", False, False),
        ("completed", True, True),
        ("cancelled", False, False),
        ("cancelled", True, True),
        ("expired", True, False),
        ("expired", False, True),
    ],
)
def test_invitation_terminal_status_requires_matching_timestamp(
    migrated_postgres: MigratedPostgres,
    status: str,
    has_completed_at: bool,
    has_cancelled_at: bool,
) -> None:
    _assert_check_violation(
        migrated_postgres.connection,
        """
        INSERT INTO public.admin_mfa_invitations (
            id, target_user_id, invitation_kind, status, expires_at,
            completed_at, cancelled_at
        ) VALUES (
            %s, %s, 'promotion', %s,
            statement_timestamp() + interval '5 minutes',
            CASE WHEN %s THEN statement_timestamp() ELSE NULL END,
            CASE WHEN %s THEN statement_timestamp() ELSE NULL END
        )
        """,
        (
            f"{migrated_postgres.prefix}_invitation_{status}_{has_completed_at}_{has_cancelled_at}",
            migrated_postgres.regular_user_id,
            status,
            has_completed_at,
            has_cancelled_at,
        ),
    )


def test_expired_break_glass_request_cannot_have_cancelled_timestamp(
    migrated_postgres: MigratedPostgres,
) -> None:
    _assert_check_violation(
        migrated_postgres.connection,
        """
        INSERT INTO public.admin_mfa_break_glass_requests (
            request_id, target_user_id, reason, correlation_id, nonce,
            status, expires_at, cancelled_at
        ) VALUES (
            %s, %s, 'Task 6 expiry contract', %s, %s,
            'expired', statement_timestamp() + interval '5 minutes',
            statement_timestamp()
        )
        """,
        (
            f"{migrated_postgres.prefix}_expired_cancelled_request",
            migrated_postgres.regular_user_id,
            f"{migrated_postgres.prefix}_correlation",
            b"n" * 16,
        ),
    )


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


def test_active_limit_guards_use_fixed_lock_safe_search_path_and_narrow_triggers(
    migrated_postgres: MigratedPostgres,
) -> None:
    with migrated_postgres.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT proname, prosecdef, proconfig, pg_get_functiondef(oid) AS definition
            FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace
              AND proname = ANY(%s)
            ORDER BY proname
            """,
            (["enforce_admin_active_user_limit", "enforce_admin_active_role_limit"],),
        )
        functions = cursor.fetchall()
        cursor.execute(
            """
            SELECT tgname, pg_get_triggerdef(oid) AS definition
            FROM pg_trigger
            WHERE NOT tgisinternal
              AND tgname = ANY(%s)
            ORDER BY tgname
            """,
            (["users_admin_active_limit_guard", "roles_admin_active_limit_guard"],),
        )
        triggers = {row["tgname"]: row["definition"] for row in cursor.fetchall()}

    assert len(functions) == 2
    for function in functions:
        assert function["prosecdef"] is False
        assert function["proconfig"] == ["search_path=pg_catalog"]
        assert "pg_catalog.pg_advisory_xact_lock(1297043287, 3)" in function["definition"]
        assert "public.users" in function["definition"]
        assert "public.roles" in function["definition"]
    assert "UPDATE OF permissions" in triggers["roles_admin_active_limit_guard"]
    assert "INSERT OR UPDATE OF status, user_type, role_id" in triggers[
        "users_admin_active_limit_guard"
    ]


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
    with pytest.raises(CheckViolation, match="ADMIN_ACTIVE_LIMIT_REACHED"):
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
    with pytest.raises(CheckViolation, match="ADMIN_ACTIVE_LIMIT_REACHED"):
        with migrated_postgres.connection.transaction():
            with migrated_postgres.connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE public.roles SET permissions = %s::jsonb WHERE id = %s",
                    ('["admin:*"]', migrated_postgres.regular_role_id),
                )
