from __future__ import annotations

import os
import unittest

from app.schemas.content_operations import HelpPatch
from app.services.content_operations_service import ContentOperationsService
from app.services.postgres_service import PostgresService


class _RollbackOnlyConnection:
    """Keep the service commit inside the test transaction."""

    def __init__(self, connection) -> None:
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        return False

    def cursor(self):
        return self.connection.cursor()

    def commit(self) -> None:
        return None


class _ExistingConnectionDb:
    def __init__(self, connection) -> None:
        self.connection = connection

    def connect(self) -> _RollbackOnlyConnection:
        return _RollbackOnlyConnection(self.connection)


@unittest.skipUnless(
    os.getenv("MOAWORKS_DEF01_POSTGRES_INTEGRATION") == "1",
    "실제 PostgreSQL 통합 검증에서만 실행합니다.",
)
class ContentOperationsPatchHelpPostgresTest(unittest.TestCase):
    def test_patch_help_updates_content_version_and_audit_in_one_transaction(self) -> None:
        connection = PostgresService().connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TEMP TABLE users (
                        id TEXT PRIMARY KEY,
                        company_id TEXT NOT NULL,
                        name TEXT NOT NULL
                    ) ON COMMIT DROP;
                    CREATE TEMP TABLE help_policy_documents (
                        id TEXT PRIMARY KEY,
                        code TEXT NOT NULL,
                        title TEXT NOT NULL,
                        category TEXT NOT NULL,
                        audience TEXT NOT NULL,
                        status TEXT NOT NULL,
                        is_system BOOLEAN NOT NULL DEFAULT FALSE,
                        content TEXT NOT NULL,
                        version INTEGER NOT NULL DEFAULT 1,
                        published_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    ) ON COMMIT DROP;
                    CREATE TEMP TABLE audit_logs (
                        id TEXT PRIMARY KEY,
                        company_id TEXT NOT NULL,
                        actor_user_id TEXT NOT NULL,
                        actor_user_name TEXT NOT NULL,
                        target_type TEXT NOT NULL,
                        target_id TEXT NOT NULL,
                        event TEXT NOT NULL,
                        status_before TEXT,
                        status_after TEXT,
                        reason TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    ) ON COMMIT DROP
                    """
                )
                cursor.execute(
                    "INSERT INTO users (id,company_id,name) VALUES (%s,%s,%s)",
                    ("usr_def01_pg", "cmp_def01_pg", "DEF-01 PostgreSQL 검증"),
                )
                cursor.execute(
                    """
                    INSERT INTO help_policy_documents
                        (id,code,title,category,audience,status,is_system,content,version)
                    VALUES (%s,%s,%s,%s,%s,%s,FALSE,%s,1)
                    """,
                    (
                        "hpd_def01_pg",
                        "DEF01-PG",
                        "수정 전 제목",
                        "help",
                        "all",
                        "draft",
                        "수정 전 본문",
                    ),
                )

            service = ContentOperationsService.__new__(ContentOperationsService)
            service.db = _ExistingConnectionDb(connection)

            updated = service.patch_help(
                "usr_def01_pg",
                "hpd_def01_pg",
                HelpPatch(title="수정 후 제목", content="수정 후 본문"),
            )

            self.assertEqual(updated["title"], "수정 후 제목")
            self.assertEqual(updated["content"], "수정 후 본문")
            self.assertEqual(updated["version"], 2)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT event,status_before,status_after FROM audit_logs WHERE target_id=%s",
                    ("hpd_def01_pg",),
                )
                audit = cursor.fetchone()
            self.assertIsNotNone(audit)
            self.assertEqual(audit["event"], "content.help.updated")
            self.assertEqual(audit["status_before"], "draft")
            self.assertEqual(audit["status_after"], "draft")
        finally:
            connection.rollback()
            connection.close()


if __name__ == "__main__":
    unittest.main()
