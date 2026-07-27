from __future__ import annotations

import os
import unittest

from app.schemas.directory import AuthUserSummary
from app.services.postgres_service import PostgresService
from app.services.workspace_service import WorkspaceService


class _ExistingConnection:
    def __init__(self, connection) -> None:
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        return False


class _ExistingConnectionDb:
    def __init__(self, connection) -> None:
        self.connection = connection

    def connect(self) -> _ExistingConnection:
        return _ExistingConnection(self.connection)


@unittest.skipUnless(
    os.getenv("MOAWORKS_UI041_POSTGRES_INTEGRATION") == "1",
    "실제 PostgreSQL 통합 검증에서만 실행합니다.",
)
class Ui041PostgresContactListTests(unittest.TestCase):
    def test_list_contacts_accepts_none_and_valid_group_id(self) -> None:
        connection = PostgresService().connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TEMP TABLE contact_groups (
                        id TEXT PRIMARY KEY,
                        company_id TEXT NOT NULL,
                        owner_user_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        status TEXT NOT NULL
                    ) ON COMMIT DROP;
                    CREATE TEMP TABLE personal_contacts (
                        id TEXT PRIMARY KEY,
                        company_id TEXT NOT NULL,
                        owner_user_id TEXT NOT NULL,
                        group_id TEXT,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL,
                        phone TEXT NOT NULL DEFAULT '',
                        company_name TEXT NOT NULL DEFAULT '',
                        memo TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    ) ON COMMIT DROP
                    """
                )
                cursor.execute(
                    "INSERT INTO contact_groups (id,company_id,owner_user_id,name,status) VALUES (%s,%s,%s,%s,'active')",
                    ("ctg_ui041_pg", "cmp_ui041_pg", "usr_ui041_pg", "PostgreSQL 검증"),
                )
                cursor.execute(
                    """
                    INSERT INTO personal_contacts
                        (id,company_id,owner_user_id,group_id,name,email)
                    VALUES
                        (%s,%s,%s,NULL,%s,%s),
                        (%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        "ctc_ui041_none",
                        "cmp_ui041_pg",
                        "usr_ui041_pg",
                        "미분류 연락처",
                        "none-ui041@example.invalid",
                        "ctc_ui041_group",
                        "cmp_ui041_pg",
                        "usr_ui041_pg",
                        "ctg_ui041_pg",
                        "그룹 연락처",
                        "group-ui041@example.invalid",
                    ),
                )

            service = WorkspaceService.__new__(WorkspaceService)
            service.db = _ExistingConnectionDb(connection)
            user = AuthUserSummary(
                userId="usr_ui041_pg",
                companyId="cmp_ui041_pg",
                userName="UI-041 PostgreSQL 검증",
                userEmail="ui041@example.invalid",
                roleId="role_ui041_pg",
                roleName="검증",
                userType="user",
                status="active",
                permissions=[],
            )

            all_items = service.list_contacts(user, group_id=None)["items"]
            grouped_items = service.list_contacts(user, group_id="ctg_ui041_pg")["items"]

            self.assertEqual({item["id"] for item in all_items}, {"ctc_ui041_none", "ctc_ui041_group"})
            self.assertEqual([item["id"] for item in grouped_items], ["ctc_ui041_group"])
        finally:
            connection.rollback()
            connection.close()


if __name__ == "__main__":
    unittest.main()
