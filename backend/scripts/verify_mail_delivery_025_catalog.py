from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql


MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "025_mail_delivery_queue.sql"
FAIL_MARKER = "MAIL_DELIVERY_025_UNSUPPORTED_CATALOG_STATE"


def schema_sql(source: str, schema: str) -> str:
    return (
        source.replace("public.", f'"{schema}".')
        .replace("table_schema = 'public'", f"table_schema = '{schema}'")
        .replace("table_schema='public'", f"table_schema='{schema}'")
    )


def create_base(cursor: psycopg.Cursor, schema: str) -> None:
    cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    cursor.execute(sql.SQL("SET LOCAL search_path TO {}, pg_catalog").format(sql.Identifier(schema)))
    for table in ("companies", "mail_provider_configs", "mail_messages", "mail_recipients"):
        cursor.execute(sql.SQL("CREATE TABLE {} (id TEXT PRIMARY KEY)").format(sql.Identifier(table)))


def create_legacy(cursor: psycopg.Cursor) -> None:
    cursor.execute("CREATE TABLE mail_delivery_providers (id TEXT PRIMARY KEY)")
    cursor.execute(
        """
        CREATE TABLE mail_delivery_queue (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            provider_id TEXT NOT NULL REFERENCES mail_delivery_providers(id) ON DELETE CASCADE,
            provider_key TEXT NOT NULL,
            mail_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
            sender_email TEXT NOT NULL,
            recipient_email TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_text TEXT NOT NULL,
            body_html TEXT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NULL,
            next_retry_at TIMESTAMPTZ NULL,
            sent_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE mail_delivery_attempts (
            id TEXT PRIMARY KEY,
            queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            error_message TEXT NULL,
            response_detail TEXT NULL,
            attempted_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE mail_delivery_events (
            id TEXT PRIMARY KEY,
            queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )


def expect_catalog_rejection(cursor: psycopg.Cursor, migration: str) -> None:
    cursor.execute("SAVEPOINT partial_catalog")
    try:
        cursor.execute(migration)
    except psycopg.Error as exc:
        assert FAIL_MARKER in str(exc)
        cursor.execute("ROLLBACK TO SAVEPOINT partial_catalog")
    else:
        raise AssertionError("partial catalog was accepted")


def run() -> None:
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("MOAWORKS_TEST_DATABASE_URL")
    connect_args = (database_url,) if database_url else ()
    connect_kwargs = {} if database_url else {
        "host": os.environ.get("POSTGRES_HOST"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
        "dbname": os.environ.get("POSTGRES_DB"),
        "user": os.environ.get("POSTGRES_USER"),
        "password": os.environ.get("POSTGRES_PASSWORD"),
    }
    if not database_url and not all(connect_kwargs.values()):
        raise RuntimeError("database connection environment is incomplete")
    source = MIGRATION.read_text(encoding="utf-8")
    prefix = f"qa_m025_{uuid4().hex[:10]}"
    with psycopg.connect(*connect_args, **connect_kwargs) as connection:
        with connection.cursor() as cursor:
            # Fresh and exact-modern/no-op.
            fresh = f"{prefix}_fresh"
            create_base(cursor, fresh)
            migration = schema_sql(source, fresh)
            cursor.execute(migration)
            cursor.execute("SELECT COUNT(*) FROM mail_delivery_queue")
            assert cursor.fetchone()[0] == 0
            cursor.execute(migration)

            # Exact legacy with rows/FKs, forced mid-rename rollback, then retry.
            legacy = f"{prefix}_legacy"
            create_base(cursor, legacy)
            create_legacy(cursor)
            cursor.execute("INSERT INTO companies VALUES ('c')")
            cursor.execute("INSERT INTO mail_provider_configs VALUES ('pc')")
            cursor.execute("INSERT INTO mail_messages VALUES ('m')")
            cursor.execute("INSERT INTO mail_recipients VALUES ('r')")
            cursor.execute("INSERT INTO mail_delivery_providers VALUES ('p')")
            cursor.execute(
                "INSERT INTO mail_delivery_queue(id,company_id,provider_id,provider_key,mail_id,sender_email,recipient_email,subject,body_text,status,created_at,updated_at) VALUES ('q','c','p','legacy','m','s@example.test','r@example.test','s','b','queued',NOW(),NOW())"
            )
            cursor.execute("INSERT INTO mail_delivery_attempts VALUES ('a','q','failed',NULL,NULL,NOW())")
            cursor.execute("INSERT INTO mail_delivery_events VALUES ('e','q','queued','queued','{}',NOW())")
            legacy_migration = schema_sql(source, legacy)
            forced = legacy_migration.replace(
                "ALTER TABLE public.mail_delivery_events RENAME TO mail_delivery_events_v007;".replace("public.", f'"{legacy}".'),
                "RAISE EXCEPTION 'forced rename failure';\n        ALTER TABLE "
                f'"{legacy}".mail_delivery_events RENAME TO mail_delivery_events_v007;',
                1,
            )
            cursor.execute("SAVEPOINT forced_rename")
            try:
                cursor.execute(forced)
            except psycopg.Error as exc:
                assert "forced rename failure" in str(exc)
                cursor.execute("ROLLBACK TO SAVEPOINT forced_rename")
            else:
                raise AssertionError("forced rename did not fail")
            cursor.execute("SELECT COUNT(*) FROM mail_delivery_queue")
            assert cursor.fetchone()[0] == 1
            cursor.execute(legacy_migration)
            for table in ("mail_delivery_queue_v007", "mail_delivery_attempts_v007", "mail_delivery_events_v007"):
                cursor.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
                assert cursor.fetchone()[0] == 1

            # Representative invalid combinations: extra queue column, mixed modern state, and orphan destination.
            both = f"{prefix}_both"
            create_base(cursor, both)
            create_legacy(cursor)
            cursor.execute("ALTER TABLE mail_delivery_queue ADD COLUMN provider_config_id TEXT")
            expect_catalog_rejection(cursor, schema_sql(source, both))

            neither = f"{prefix}_neither"
            create_base(cursor, neither)
            cursor.execute("CREATE TABLE mail_delivery_queue (id TEXT PRIMARY KEY)")
            expect_catalog_rejection(cursor, schema_sql(source, neither))

            mixed = f"{prefix}_mixed"
            create_base(cursor, mixed)
            cursor.execute(schema_sql(source, mixed))
            cursor.execute("DROP TABLE mail_delivery_worker_heartbeats")
            expect_catalog_rejection(cursor, schema_sql(source, mixed))

            mixed_children = f"{prefix}_mixed_children"
            create_base(cursor, mixed_children)
            cursor.execute(schema_sql(source, mixed_children))
            cursor.execute("DROP TABLE mail_delivery_attempts")
            cursor.execute(
                "CREATE TABLE mail_delivery_attempts (id TEXT PRIMARY KEY, queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE, status TEXT NOT NULL, error_message TEXT NULL, response_detail TEXT NULL, attempted_at TIMESTAMPTZ NOT NULL)"
            )
            cursor.execute(
                "CREATE TABLE mail_delivery_events (id TEXT PRIMARY KEY, queue_id TEXT NOT NULL REFERENCES mail_delivery_queue(id) ON DELETE CASCADE, event_type TEXT NOT NULL, message TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL)"
            )
            expect_catalog_rejection(cursor, schema_sql(source, mixed_children))

            destination = f"{prefix}_destination"
            create_base(cursor, destination)
            cursor.execute("CREATE TABLE mail_delivery_queue_v007 (id TEXT PRIMARY KEY)")
            expect_catalog_rejection(cursor, schema_sql(source, destination))

            malformed_fk = f"{prefix}_malformed_fk"
            create_base(cursor, malformed_fk)
            create_legacy(cursor)
            cursor.execute("ALTER TABLE mail_delivery_queue DROP CONSTRAINT mail_delivery_queue_company_id_fkey")
            cursor.execute(
                "ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_company_id_fkey "
                "FOREIGN KEY (company_id) REFERENCES mail_messages(id) ON DELETE SET NULL"
            )
            expect_catalog_rejection(cursor, schema_sql(source, malformed_fk))

        connection.rollback()
    print("MAIL_DELIVERY_025_CATALOG_PASS")


if __name__ == "__main__":
    run()
