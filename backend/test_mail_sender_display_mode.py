from __future__ import annotations

import os
from pathlib import Path
import unittest

from psycopg.errors import CheckViolation
from pydantic import ValidationError

from app.schemas.mail_messenger import MailBasicPreferencesUpdateRequest
from app.services.postgres_service import PostgresService


class SenderDisplayModeSchemaTests(unittest.TestCase):
    def test_sender_display_mode_accepts_id_and_rejects_unknown(self) -> None:
        request = MailBasicPreferencesUpdateRequest(senderDisplayMode="id", expectedVersion=1)

        self.assertEqual(request.senderDisplayMode, "id")
        with self.assertRaises(ValidationError):
            MailBasicPreferencesUpdateRequest(senderDisplayMode="email", expectedVersion=1)


@unittest.skipUnless(
    os.getenv("MOAWORKS_UI041_POSTGRES_INTEGRATION") == "1",
    "기존 CI PostgreSQL fixture에서만 migration 실제 동작을 검증합니다.",
)
class SenderDisplayModeMigrationPostgresTests(unittest.TestCase):
    migration_path = Path(__file__).parent / "migrations" / "066_mail_sender_display_id.sql"

    def test_migration_066_accepts_id_and_preserves_existing_preference(self) -> None:
        connection = PostgresService().connect()
        try:
            with connection.cursor() as cursor:
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
                    """
                    INSERT INTO user_mail_basic_preferences (owner_user_id, sender_display_mode)
                    VALUES (%s, %s)
                    """,
                    ("user-a", "name"),
                )
                cursor.execute(self.migration_path.read_text(encoding="utf-8"))

                cursor.execute(
                    "SELECT sender_display_mode FROM user_mail_basic_preferences WHERE owner_user_id = %s",
                    ("user-a",),
                )
                self.assertEqual(cursor.fetchone()["sender_display_mode"], "name")

                cursor.execute(
                    "UPDATE user_mail_basic_preferences SET sender_display_mode = 'id' WHERE owner_user_id = %s",
                    ("user-a",),
                )
                cursor.execute(
                    "SELECT sender_display_mode FROM user_mail_basic_preferences WHERE owner_user_id = %s",
                    ("user-a",),
                )
                self.assertEqual(cursor.fetchone()["sender_display_mode"], "id")

                with self.assertRaises(CheckViolation):
                    cursor.execute(
                        "UPDATE user_mail_basic_preferences SET sender_display_mode = 'email' WHERE owner_user_id = %s",
                        ("user-a",),
                    )
        finally:
            connection.rollback()
            connection.close()
