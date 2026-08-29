from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import os
from pathlib import Path
import uuid

import pytest
from pydantic import ValidationError
from psycopg import sql

from app.core.config import Settings
from app.services.postgres_service import PostgresService


def _quota_types():
    from app.services.mail_daily_send_quota import (
        MailDailyQuotaUnavailable,
        MailDailySendLimitExceeded,
        MailDailySendQuota,
    )

    return MailDailySendQuota, MailDailySendLimitExceeded, MailDailyQuotaUnavailable


@pytest.mark.parametrize("value", ["-1", "1.5", "not-an-integer"])
def test_daily_limit_rejects_negative_and_non_integer(monkeypatch, value: str) -> None:
    monkeypatch.setenv("MAIL_ENGINE_DAILY_SEND_LIMIT", value)
    with pytest.raises(ValidationError):
        Settings()


def test_daily_limit_defaults_to_unlimited(monkeypatch) -> None:
    monkeypatch.delenv("MAIL_ENGINE_DAILY_SEND_LIMIT", raising=False)
    assert Settings().mail_engine_daily_send_limit == 0


def test_database_error_is_fail_closed() -> None:
    MailDailySendQuota, _, MailDailyQuotaUnavailable = _quota_types()

    class BrokenDatabase:
        def connect(self):
            raise RuntimeError("database unavailable")

    with pytest.raises(MailDailyQuotaUnavailable):
        MailDailySendQuota(BrokenDatabase(), limit=10).reserve_attempt()


def test_missing_database_result_is_fail_closed() -> None:
    MailDailySendQuota, _, MailDailyQuotaUnavailable = _quota_types()

    class EmptyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def execute(self, query, params):
            return None

        def fetchone(self):
            return None

    class EmptyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def cursor(self):
            return EmptyCursor()

    class EmptyDatabase:
        def connect(self):
            return EmptyConnection()

    with pytest.raises(MailDailyQuotaUnavailable):
        MailDailySendQuota(EmptyDatabase(), limit=10).reserve_attempt()


class _SchemaDatabase:
    def __init__(self, schema_name: str, session_timezone: str = "UTC") -> None:
        self.schema_name = schema_name
        self.session_timezone = session_timezone

    def connect(self):
        connection = PostgresService().connect()
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("SET search_path TO {}").format(sql.Identifier(self.schema_name))
            )
            cursor.execute(
                "SELECT set_config('TimeZone', %s, false)",
                (self.session_timezone,),
            )
        connection.commit()
        return connection


@pytest.fixture
def quota_schema():
    if os.getenv("MOAWORKS_UI041_POSTGRES_INTEGRATION") != "1":
        pytest.skip("기존 PostgreSQL fixture opt-in에서만 실행합니다.")

    schema_name = f"task4_quota_{uuid.uuid4().hex}"
    migration_path = (
        Path(__file__).parent / "migrations" / "067_mail_engine_daily_send_limit.sql"
    )
    control = PostgresService().connect()
    try:
        with control.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))
            cursor.execute(
                sql.SQL("SET search_path TO {}").format(sql.Identifier(schema_name))
            )
            cursor.execute(migration_path.read_text(encoding="utf-8"))
        control.commit()
        yield schema_name
    finally:
        control.rollback()
        with control.cursor() as cursor:
            cursor.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema_name)
                )
            )
        control.commit()
        control.close()


def _usage_count(schema_name: str) -> int:
    connection = _SchemaDatabase(schema_name).connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(SUM(attempt_count), 0) AS count "
                "FROM mail_engine_daily_send_usage"
            )
            return cursor.fetchone()["count"]
    finally:
        connection.rollback()
        connection.close()


def test_migration_067_executes_and_exposes_expected_schema(quota_schema: str) -> None:
    connection = _SchemaDatabase(quota_schema).connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = %s
                  AND table_name = 'mail_engine_daily_send_usage'
                ORDER BY ordinal_position
                """,
                (quota_schema,),
            )
            columns = cursor.fetchall()
            cursor.execute(
                """
                SELECT constraint_type
                FROM information_schema.table_constraints
                WHERE table_schema = %s
                  AND table_name = 'mail_engine_daily_send_usage'
                ORDER BY constraint_type
                """,
                (quota_schema,),
            )
            constraint_types = [row["constraint_type"] for row in cursor.fetchall()]
    finally:
        connection.rollback()
        connection.close()

    assert [
        (row["column_name"], row["data_type"], row["is_nullable"])
        for row in columns
    ] == [
        ("usage_date", "date", "NO"),
        ("attempt_count", "bigint", "NO"),
        ("updated_at", "timestamp with time zone", "NO"),
    ]
    assert columns[1]["column_default"] == "0"
    assert constraint_types.count("PRIMARY KEY") == 1
    assert constraint_types.count("CHECK") >= 1


def test_reserve_attempt_allows_n_and_rejects_n_plus_one(quota_schema: str) -> None:
    MailDailySendQuota, MailDailySendLimitExceeded, _ = _quota_types()
    quota = MailDailySendQuota(_SchemaDatabase(quota_schema), limit=2)

    assert quota.reserve_attempt().allowed is True
    assert quota.reserve_attempt().allowed is True
    with pytest.raises(MailDailySendLimitExceeded):
        quota.reserve_attempt()
    assert _usage_count(quota_schema) == 2


def test_zero_is_unlimited_but_every_attempt_is_observed(quota_schema: str) -> None:
    MailDailySendQuota, _, _ = _quota_types()
    quota = MailDailySendQuota(_SchemaDatabase(quota_schema), limit=0)

    reservations = [quota.reserve_attempt() for _ in range(4)]

    assert [reservation.used for reservation in reservations] == [1, 2, 3, 4]
    assert all(reservation.allowed for reservation in reservations)
    assert _usage_count(quota_schema) == 4


def test_postgres_seoul_date_and_reset_ignore_session_timezone(
    quota_schema: str,
) -> None:
    MailDailySendQuota, _, _ = _quota_types()
    utc = MailDailySendQuota(
        _SchemaDatabase(quota_schema, session_timezone="UTC"), limit=0
    ).reserve_attempt()
    honolulu = MailDailySendQuota(
        _SchemaDatabase(quota_schema, session_timezone="Pacific/Honolulu"), limit=0
    ).reserve_attempt()

    connection = _SchemaDatabase(
        quota_schema, session_timezone="America/New_York"
    ).connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    timezone('Asia/Seoul', statement_timestamp())::date AS usage_date,
                    (
                        (
                            timezone('Asia/Seoul', statement_timestamp())::date + 1
                        )::timestamp AT TIME ZONE 'Asia/Seoul'
                    ) AS reset_at
                """
            )
            expected = cursor.fetchone()
    finally:
        connection.rollback()
        connection.close()

    assert utc.usage_date == honolulu.usage_date == expected["usage_date"]
    assert utc.reset_at == honolulu.reset_at == expected["reset_at"]
    assert isinstance(utc.reset_at, datetime)
    assert utc.reset_at.tzinfo is not None


def test_restart_preserves_usage(quota_schema: str) -> None:
    MailDailySendQuota, MailDailySendLimitExceeded, _ = _quota_types()
    first_process = MailDailySendQuota(_SchemaDatabase(quota_schema), limit=2)
    assert first_process.reserve_attempt().used == 1

    restarted_process = MailDailySendQuota(_SchemaDatabase(quota_schema), limit=2)
    assert restarted_process.reserve_attempt().used == 2
    with pytest.raises(MailDailySendLimitExceeded):
        restarted_process.reserve_attempt()


def test_concurrent_workers_allow_exactly_n(quota_schema: str) -> None:
    MailDailySendQuota, MailDailySendLimitExceeded, _ = _quota_types()
    limit = 11

    def reserve() -> bool:
        quota = MailDailySendQuota(_SchemaDatabase(quota_schema), limit=limit)
        try:
            return quota.reserve_attempt().allowed
        except MailDailySendLimitExceeded:
            return False

    with ThreadPoolExecutor(max_workers=20) as pool:
        outcomes = list(pool.map(lambda _: reserve(), range(32)))

    assert outcomes.count(True) == limit
    assert outcomes.count(False) == 32 - limit
    assert _usage_count(quota_schema) == limit
