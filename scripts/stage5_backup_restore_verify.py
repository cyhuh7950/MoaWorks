from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "backend" / "migrations"
OUTPUT_DIR = ROOT / "docs" / "phase-5"

SOURCE_DSN = {
    "host": "127.0.0.1",
    "port": 5435,
    "dbname": "moaworks",
    "user": "moaworks",
    "password": "change-me",
    "connect_timeout": 3,
}
ADMIN_DSN = {
    **SOURCE_DSN,
    "dbname": "postgres",
}

TABLE_ORDER = [
    "companies",
    "departments",
    "roles",
    "users",
    "mail_provider_configs",
    "mail_accounts",
    "audit_logs",
    "approval_documents",
    "approval_lines",
]

JSONB_COLUMNS = {
    "roles": {"permissions"},
}


def now_tag() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%SZ")


def dump_rows() -> tuple[dict[str, list[dict[str, Any]]], dict[str, int]]:
    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    counts: dict[str, int] = {}
    with psycopg.connect(**SOURCE_DSN, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for table in TABLE_ORDER:
                cur.execute(f"SELECT * FROM {table} ORDER BY 1")
                rows = cur.fetchall()
                normalized: list[dict[str, Any]] = []
                for row in rows:
                    normalized_row: dict[str, Any] = {}
                    for key, value in row.items():
                        if isinstance(value, datetime):
                            normalized_row[key] = value.isoformat()
                        else:
                            normalized_row[key] = value
                    normalized.append(normalized_row)
                rows_by_table[table] = normalized
                counts[table] = len(normalized)
    return rows_by_table, counts


def create_restore_database(db_name: str) -> None:
    with psycopg.connect(**ADMIN_DSN, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {db_name}")
            cur.execute(f"CREATE DATABASE {db_name}")


def apply_migrations(db_name: str) -> list[str]:
    applied: list[str] = []
    dsn = {**SOURCE_DSN, "dbname": db_name}
    with psycopg.connect(**dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                cur.execute(migration_path.read_text(encoding="utf-8"))
                cur.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s) ON CONFLICT (version) DO NOTHING",
                    (migration_path.name,),
                )
                applied.append(migration_path.name)
        conn.commit()
    return applied


def restore_rows(db_name: str, rows_by_table: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    restored_counts: dict[str, int] = {}
    dsn = {**SOURCE_DSN, "dbname": db_name}
    with psycopg.connect(**dsn) as conn:
        with conn.cursor() as cur:
            for table in TABLE_ORDER:
                rows = rows_by_table[table]
                if not rows:
                    restored_counts[table] = 0
                    continue
                columns = list(rows[0].keys())
                placeholders = ", ".join(["%s"] * len(columns))
                column_sql = ", ".join(columns)
                json_columns = JSONB_COLUMNS.get(table, set())
                for row in rows:
                    values = []
                    for column in columns:
                        value = row[column]
                        if column in json_columns:
                            values.append(Jsonb(value))
                        else:
                            values.append(value)
                    cur.execute(
                        f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})",
                        values,
                    )
                restored_counts[table] = len(rows)
        conn.commit()
    return restored_counts


def verify_counts(db_name: str) -> dict[str, int]:
    verified: dict[str, int] = {}
    dsn = {**SOURCE_DSN, "dbname": db_name}
    with psycopg.connect(**dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for table in TABLE_ORDER:
                cur.execute(f"SELECT COUNT(*) AS count FROM {table}")
                verified[table] = int(cur.fetchone()["count"])
    return verified


def drop_restore_database(db_name: str) -> None:
    with psycopg.connect(**ADMIN_DSN, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {db_name}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tag = now_tag()
    dump_file = OUTPUT_DIR / f"stage5-backup-{tag}.json"
    summary_file = OUTPUT_DIR / f"stage5-backup-restore-summary-{tag}.json"
    restore_db = f"moaworks_restore_probe_{tag.lower().replace('-', '_')}_{uuid4().hex[:6]}"

    rows_by_table, source_counts = dump_rows()
    dump_file.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(UTC).isoformat(),
                "sourceDsn": {k: v for k, v in SOURCE_DSN.items() if k != "password"},
                "tables": rows_by_table,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    create_restore_database(restore_db)
    applied = apply_migrations(restore_db)
    restored_counts = restore_rows(restore_db, rows_by_table)
    verified_counts = verify_counts(restore_db)
    drop_restore_database(restore_db)

    summary = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "dumpFile": str(dump_file),
        "restoreDatabase": restore_db,
        "cleanup": "dropped",
        "appliedMigrations": applied,
        "sourceCounts": source_counts,
        "restoredCounts": restored_counts,
        "verifiedCounts": verified_counts,
        "match": source_counts == verified_counts == restored_counts,
    }
    summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
