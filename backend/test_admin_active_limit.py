from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile
import threading
import time
from typing import Any
import uuid

import pytest
from psycopg import sql
from psycopg.errors import CheckViolation
from psycopg.pq import DiagnosticField

from app.core.config import settings
from app.schemas.setup import DbConfigPayload
from app.services.directory_store import (
    DirectoryAdminActiveLimitError,
    _map_admin_active_limit,
)
from app.services.postgres_service import PostgresService


MIGRATION = Path(__file__).parent / "migrations" / "068_admin_mfa_and_active_limit.sql"
POSTGRES_OPT_IN = "MOAWORKS_UI041_POSTGRES_INTEGRATION"
LIMIT_MARKER = "ADMIN_ACTIVE_LIMIT_REACHED"
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
class ActiveLimitFixture:
    connection: Any
    prefix: str
    company_id: str
    department_id: str
    privileged_role_id: str
    regular_role_id: str
    privileged_user_ids: tuple[str, str]
    regular_user_ids: tuple[str, ...]


def _db_config() -> DbConfigPayload:
    return DbConfigPayload(
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )


def _insert_user(
    cursor: Any,
    fixture: ActiveLimitFixture,
    user_id: str,
    *,
    status: str = "active",
    user_type: str = "user",
    role_id: str | None = None,
) -> None:
    cursor.execute(
        """
        INSERT INTO public.users (
            id, company_id, email, name, password_hash, department_id, role_id,
            status, user_type, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s,
            statement_timestamp(), statement_timestamp()
        )
        """,
        (
            user_id,
            fixture.company_id,
            f"{user_id}@{fixture.prefix}.invalid",
            user_id,
            f"fixture-hash-{fixture.prefix}",
            fixture.department_id,
            role_id or fixture.regular_role_id,
            status,
            user_type,
        ),
    )


def _expect_limit(connection: Any, statement: str, parameters: tuple[Any, ...]) -> None:
    with pytest.raises(CheckViolation, match=LIMIT_MARKER):
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute(statement, parameters)


@pytest.fixture(scope="module")
def active_limit_db() -> ActiveLimitFixture:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to use the existing PostgreSQL runtime")

    connection = PostgresService().connect(_db_config())
    prefix = f"task7_{uuid.uuid4().hex}"
    fixture = ActiveLimitFixture(
        connection=connection,
        prefix=prefix,
        company_id=f"{prefix}_company",
        department_id=f"{prefix}_department",
        privileged_role_id=f"{prefix}_privileged_role",
        regular_role_id=f"{prefix}_regular_role",
        privileged_user_ids=(f"{prefix}_privileged_1", f"{prefix}_privileged_2"),
        regular_user_ids=tuple(f"{prefix}_regular_{index}" for index in range(1, 7)),
    )
    prior_status_constraints: list[tuple[str, str]] = []
    migration_applied = False

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(*) AS count
                FROM public.users AS candidate
                LEFT JOIN public.roles AS candidate_role ON candidate_role.id = candidate.role_id
                WHERE candidate.status = 'active'
                  AND (
                      candidate.user_type = 'admin'
                      OR pg_catalog.jsonb_exists(candidate_role.permissions, 'admin:*')
                  )
                """
            )
            assert cursor.fetchone()["count"] == 1
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
            cursor.execute(
                "SELECT count(*) AS count FROM public.schema_migrations WHERE version = %s",
                (MIGRATION.name,),
            )
            assert cursor.fetchone()["count"] == 0
        connection.rollback()

        with tempfile.TemporaryDirectory(prefix="moaworks-task7-migration-") as temp_dir:
            temp_path = Path(temp_dir) / MIGRATION.name
            temp_path.write_text(MIGRATION.read_text(encoding="utf-8"), encoding="utf-8")
            PostgresService(migration_dir=temp_path.parent).ensure_migrations_applied(
                db_config=_db_config()
            )
            migration_applied = True

        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO public.companies (id, name, domain, status, created_at)
                VALUES (%s, %s, %s, 'active', statement_timestamp())
                """,
                (fixture.company_id, "Task 7 fixture", f"{prefix}.invalid"),
            )
            cursor.execute(
                """
                INSERT INTO public.departments (
                    id, company_id, name, status, sort_order, created_at
                ) VALUES (%s, %s, %s, 'active', 100, statement_timestamp())
                """,
                (fixture.department_id, fixture.company_id, "Task 7 fixture"),
            )
            cursor.execute(
                """
                INSERT INTO public.roles (
                    id, company_id, name, permissions, status, created_at
                ) VALUES
                    (%s, %s, %s, '["admin:*"]'::jsonb, 'active', statement_timestamp()),
                    (%s, %s, %s, '[]'::jsonb, 'active', statement_timestamp())
                """,
                (
                    fixture.privileged_role_id,
                    fixture.company_id,
                    "Task 7 privileged",
                    fixture.regular_role_id,
                    fixture.company_id,
                    "Task 7 regular",
                ),
            )
            for user_id in fixture.privileged_user_ids:
                _insert_user(
                    cursor,
                    fixture,
                    user_id,
                    user_type="admin",
                    role_id=fixture.privileged_role_id,
                )
            for user_id in fixture.regular_user_ids:
                _insert_user(cursor, fixture, user_id)
        connection.commit()

        yield fixture
    finally:
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM public.users WHERE left(id, %s) = %s",
                (len(prefix), prefix),
            )
            cursor.execute(
                "DELETE FROM public.roles WHERE left(id, %s) = %s",
                (len(prefix), prefix),
            )
            cursor.execute("DELETE FROM public.departments WHERE id = %s", (fixture.department_id,))
            cursor.execute("DELETE FROM public.companies WHERE id = %s", (fixture.company_id,))
            if migration_applied:
                cursor.execute("DROP TRIGGER IF EXISTS users_admin_active_limit_guard ON public.users")
                cursor.execute("DROP TRIGGER IF EXISTS roles_admin_active_limit_guard ON public.roles")
                cursor.execute("DROP FUNCTION IF EXISTS public.enforce_admin_active_user_limit()")
                cursor.execute("DROP FUNCTION IF EXISTS public.enforce_admin_active_role_limit()")
                for table_name in MFA_TABLE_DROP_ORDER:
                    cursor.execute(sql.SQL("DROP TABLE public.{}").format(sql.Identifier(table_name)))
                cursor.execute(
                    "ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_mfa_check"
                )
                for constraint_name, definition in prior_status_constraints:
                    cursor.execute(
                        sql.SQL("ALTER TABLE public.users ADD CONSTRAINT {} {}").format(
                            sql.Identifier(constraint_name), sql.SQL(definition)
                        )
                    )
                cursor.execute(
                    "DELETE FROM public.schema_migrations WHERE version = %s",
                    (MIGRATION.name,),
                )
        connection.commit()
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) AS count FROM public.users WHERE left(id, %s) = %s",
                (len(prefix), prefix),
            )
            assert cursor.fetchone()["count"] == 0
            cursor.execute(
                "SELECT count(*) AS count FROM public.schema_migrations WHERE version = %s",
                (MIGRATION.name,),
            )
            assert cursor.fetchone()["count"] == 0
        connection.close()


def test_migration_limit_uses_check_violation_sqlstate() -> None:
    migration_sql = MIGRATION.read_text(encoding="utf-8")
    assert migration_sql.count("ERRCODE = '23514'") == 2
    assert migration_sql.count(LIMIT_MARKER) == 2


def test_service_boundary_maps_only_the_active_limit_check_violation() -> None:
    marker_info = {
        DiagnosticField.MESSAGE_PRIMARY: LIMIT_MARKER.encode(),
    }
    unrelated_info = {
        DiagnosticField.MESSAGE_PRIMARY: b"UNRELATED_CHECK",
        DiagnosticField.MESSAGE_DETAIL: LIMIT_MARKER.encode(),
    }

    @_map_admin_active_limit
    def active_limit_failure() -> None:
        raise CheckViolation(LIMIT_MARKER, info=marker_info)

    @_map_admin_active_limit
    def unrelated_check_failure() -> None:
        raise CheckViolation(
            f"UNRELATED_CHECK\nDETAIL: {LIMIT_MARKER}",
            info=unrelated_info,
        )

    with pytest.raises(DirectoryAdminActiveLimitError, match="최대 3개"):
        active_limit_failure()
    with pytest.raises(CheckViolation, match="UNRELATED_CHECK"):
        unrelated_check_failure()


def test_create_promote_reactivate_and_role_expansion_are_rejected_at_three(
    active_limit_db: ActiveLimitFixture,
) -> None:
    fixture = active_limit_db
    blocked_id = f"{fixture.prefix}_blocked_create"
    _expect_limit(
        fixture.connection,
        """
        INSERT INTO public.users (
            id, company_id, email, name, password_hash, department_id, role_id,
            status, user_type, created_at, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', 'admin',
                  statement_timestamp(), statement_timestamp())
        """,
        (
            blocked_id,
            fixture.company_id,
            f"{blocked_id}@{fixture.prefix}.invalid",
            blocked_id,
            "fixture-hash",
            fixture.department_id,
            fixture.privileged_role_id,
        ),
    )
    _expect_limit(
        fixture.connection,
        "UPDATE public.users SET user_type = 'admin' WHERE id = %s",
        (fixture.regular_user_ids[0],),
    )
    with fixture.connection.cursor() as cursor:
        cursor.execute(
            "UPDATE public.users SET status = 'inactive', user_type = 'admin' WHERE id = %s",
            (fixture.regular_user_ids[1],),
        )
    fixture.connection.commit()
    _expect_limit(
        fixture.connection,
        "UPDATE public.users SET status = 'active' WHERE id = %s",
        (fixture.regular_user_ids[1],),
    )
    _expect_limit(
        fixture.connection,
        "UPDATE public.roles SET permissions = '[\"admin:*\"]'::jsonb WHERE id = %s",
        (fixture.regular_role_id,),
    )


def test_ordinary_update_and_deactivation_remain_available(
    active_limit_db: ActiveLimitFixture,
) -> None:
    fixture = active_limit_db
    privileged_id = fixture.privileged_user_ids[0]
    with fixture.connection.cursor() as cursor:
        cursor.execute(
            "UPDATE public.users SET name = name || ' checked' WHERE id = %s RETURNING status",
            (privileged_id,),
        )
        assert cursor.fetchone()["status"] == "active"
        cursor.execute(
            "UPDATE public.users SET status = 'inactive' WHERE id = %s RETURNING status",
            (privileged_id,),
        )
        assert cursor.fetchone()["status"] == "inactive"
        cursor.execute(
            "UPDATE public.users SET status = 'active' WHERE id = %s RETURNING status",
            (privileged_id,),
        )
        assert cursor.fetchone()["status"] == "active"
    fixture.connection.commit()


def test_two_connection_promotion_race_allows_only_one_winner(
    active_limit_db: ActiveLimitFixture,
) -> None:
    fixture = active_limit_db
    temporarily_inactive = fixture.privileged_user_ids[1]
    candidates = fixture.regular_user_ids[2:4]
    with fixture.connection.cursor() as cursor:
        cursor.execute(
            "UPDATE public.users SET status = 'inactive' WHERE id = %s",
            (temporarily_inactive,),
        )
    fixture.connection.commit()

    blocker = PostgresService().connect(_db_config())
    with blocker.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", (1297043287, 3))

    barrier = threading.Barrier(3)
    outcomes: list[tuple[str, str]] = []
    backend_pids: list[int] = []
    outcome_lock = threading.Lock()

    def promote(candidate_id: str) -> None:
        connection = PostgresService().connect(_db_config())
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid() AS pid")
                backend_pid = int(cursor.fetchone()["pid"])
            with outcome_lock:
                backend_pids.append(backend_pid)
            barrier.wait(timeout=5)
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE public.users SET user_type = 'admin' WHERE id = %s",
                        (candidate_id,),
                    )
                connection.commit()
                outcome = "committed"
            except CheckViolation as exc:
                connection.rollback()
                assert LIMIT_MARKER in str(exc)
                outcome = "rejected"
            with outcome_lock:
                outcomes.append((candidate_id, outcome))
        finally:
            connection.close()

    threads = [threading.Thread(target=promote, args=(candidate,)) for candidate in candidates]
    for thread in threads:
        thread.start()
    try:
        barrier.wait(timeout=5)

        observer = PostgresService().connect(_db_config())
        try:
            deadline = time.monotonic() + 5
            waiting_count = 0
            while time.monotonic() < deadline:
                with observer.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT count(*) AS count
                        FROM pg_catalog.pg_stat_activity
                        WHERE pid = ANY(%s)
                          AND wait_event_type = 'Lock'
                          AND wait_event = 'advisory'
                        """,
                        (backend_pids,),
                    )
                    waiting_count = int(cursor.fetchone()["count"])
                observer.rollback()
                if waiting_count == 2:
                    break
                time.sleep(0.05)
            assert waiting_count == 2, "both promotion transactions must wait on the fixed advisory lock"
        finally:
            observer.close()
    finally:
        blocker.commit()
        blocker.close()

    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()

    assert sorted(outcome for _, outcome in outcomes) == ["committed", "rejected"]
    winner = next(candidate for candidate, outcome in outcomes if outcome == "committed")
    with fixture.connection.cursor() as cursor:
        cursor.execute("UPDATE public.users SET user_type = 'user' WHERE id = %s", (winner,))
        cursor.execute(
            "UPDATE public.users SET status = 'active' WHERE id = %s",
            (temporarily_inactive,),
        )
    fixture.connection.commit()
