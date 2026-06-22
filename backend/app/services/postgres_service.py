from __future__ import annotations

from pathlib import Path
import threading

import psycopg
from psycopg.rows import dict_row

from app.core.config import settings
from app.schemas.setup import DbConfigPayload


class PostgresService:
    _migration_lock = threading.Lock()
    _runtime_migrations_applied = False

    def __init__(self, migration_dir: Path | None = None) -> None:
        self.migration_dir = migration_dir or (Path(__file__).resolve().parents[2] / "migrations")

    def connect(self, db_config: DbConfigPayload | None = None) -> psycopg.Connection:
        config = db_config or DbConfigPayload(
            host=settings.postgres_host,
            port=settings.postgres_port,
            database=settings.postgres_db,
            user=settings.postgres_user,
            password=settings.postgres_password,
        )
        return psycopg.connect(
            host=config.host,
            port=config.port,
            dbname=config.database,
            user=config.user,
            password=config.password,
            connect_timeout=3,
            row_factory=dict_row,
        )

    def validate_runtime_match(self, db_config: DbConfigPayload) -> list[str]:
        errors: list[str] = []
        if db_config.host != settings.postgres_host:
            errors.append("DB 호스트는 현재 실행 서버의 PostgreSQL 호스트와 일치해야 합니다.")
        if db_config.port != settings.postgres_port:
            errors.append("DB 포트는 현재 실행 서버의 PostgreSQL 포트와 일치해야 합니다.")
        if db_config.database != settings.postgres_db:
            errors.append("DB 이름은 현재 실행 서버의 PostgreSQL 데이터베이스와 일치해야 합니다.")
        if db_config.user != settings.postgres_user:
            errors.append("DB 사용자는 현재 실행 서버의 PostgreSQL 사용자와 일치해야 합니다.")
        if db_config.password != settings.postgres_password:
            errors.append("DB 비밀번호는 현재 실행 서버의 PostgreSQL 비밀번호와 일치해야 합니다.")
        return errors

    def test_connection(self, db_config: DbConfigPayload | None = None) -> None:
        with self.connect(db_config) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()

    def ensure_migrations_applied(self, db_config: DbConfigPayload | None = None) -> None:
        if db_config is None and self._runtime_migrations_applied:
            return

        with self._migration_lock:
            if db_config is None and self._runtime_migrations_applied:
                return

            with self.connect(db_config) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS schema_migrations (
                            version TEXT PRIMARY KEY,
                            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                    cursor.execute("SELECT version FROM schema_migrations")
                    applied = {row["version"] for row in cursor.fetchall()}

                    for migration_path in sorted(self.migration_dir.glob("*.sql")):
                        if migration_path.name in applied:
                            continue
                        cursor.execute(migration_path.read_text(encoding="utf-8"))
                        cursor.execute(
                            "INSERT INTO schema_migrations (version) VALUES (%s)",
                            (migration_path.name,),
                        )
                connection.commit()

            if db_config is None:
                self._runtime_migrations_applied = True
