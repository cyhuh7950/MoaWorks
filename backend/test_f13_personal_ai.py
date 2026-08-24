from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.directory import AuthUserSummary


BACKEND_ROOT = Path(__file__).resolve().parent


class RecordingCursor:
    def __init__(self, rows: list[dict[str, object] | None] | None = None) -> None:
        self.rows = list(rows or [])
        self.executions: list[tuple[str, tuple[object, ...] | None]] = []

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
        self.executions.append((query, params))

    def fetchone(self) -> dict[str, object] | None:
        return self.rows.pop(0) if self.rows else None


class RecordingConnection:
    def __init__(self, cursor: RecordingCursor) -> None:
        self._cursor = cursor
        self.commit_count = 0

    def __enter__(self) -> "RecordingConnection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> RecordingCursor:
        return self._cursor

    def commit(self) -> None:
        self.commit_count += 1


class RecordingDb:
    def __init__(self, rows: list[dict[str, object] | None] | None = None) -> None:
        self.cursor = RecordingCursor(rows)
        self.connections: list[RecordingConnection] = []

    def connect(self) -> RecordingConnection:
        connection = RecordingConnection(self.cursor)
        self.connections.append(connection)
        return connection


class RecordingSecurity:
    def __init__(self) -> None:
        self.encrypted_values: list[str] = []
        self.decrypted_values: list[str] = []

    def encrypt_secret(self, value: str) -> str:
        self.encrypted_values.append(value)
        return "encrypted-fixture-value"

    def decrypt_secret(self, value: str) -> str:
        self.decrypted_values.append(value)
        return "fixture-personal-credential"


def personal_ai_actor() -> AuthUserSummary:
    return AuthUserSummary(
        userId="user-f13",
        companyId="company-f13",
        userName="F13 User",
        userEmail="f13@example.test",
        roleId="role-user",
        roleName="사용자",
        userType="user",
        status="active",
        permissions=["profile:read"],
    )


def personal_ai_row(**updates: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": "pai-fixture",
        "company_id": "company-f13",
        "user_id": "user-f13",
        "provider_type": "groq",
        "model": "model-a",
        "encrypted_api_key": "encrypted-existing-value",
        "connection_status": "ready",
        "last_test_code": "PERSONAL_AI_CONNECTION_READY",
        "last_tested_at": datetime(2026, 8, 24, tzinfo=UTC),
    }
    row.update(updates)
    return row


class PersonalAiSchemaContractTest(unittest.TestCase):
    def test_config_update_normalizes_provider_and_model_without_serializing_secret(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate

        payload = PersonalAiConfigUpdate(
            provider=" GROQ ",
            model="  llama-3.3-70b-versatile  ",
            apiKey="private-fixture-value",
        )

        self.assertEqual(payload.provider, "groq")
        self.assertEqual(payload.model, "llama-3.3-70b-versatile")
        self.assertNotIn("private-fixture-value", payload.model_dump_json())

    def test_config_update_rejects_unsupported_provider_and_conflicting_key_actions(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate

        with self.assertRaises(ValidationError):
            PersonalAiConfigUpdate(provider="custom", model="model")
        with self.assertRaises(ValidationError):
            PersonalAiConfigUpdate(
                provider="groq",
                model="model",
                apiKey="private-fixture-value",
                clearApiKey=True,
            )

    def test_config_response_contract_has_no_secret_cipher_or_endpoint_fields(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigView

        view = PersonalAiConfigView(
            provider="groq",
            model="model",
            apiKeyConfigured=True,
            connectionStatus="ready",
            lastTestCode="PERSONAL_AI_CONNECTION_READY",
            lastTestedAt=datetime(2026, 8, 24, tzinfo=UTC),
        )

        self.assertEqual(
            set(view.model_dump(mode="json")),
            {
                "provider",
                "model",
                "apiKeyConfigured",
                "connectionStatus",
                "lastTestCode",
                "lastTestedAt",
            },
        )

    def test_chat_request_accepts_only_user_and_assistant_within_all_limits(self) -> None:
        from app.schemas.personal_ai import PersonalAiChatRequest

        request = PersonalAiChatRequest(
            messages=[
                {"role": "user", "content": "가" * 8000},
                {"role": "assistant", "content": "나" * 8000},
                {"role": "user", "content": "다" * 8000},
                {"role": "assistant", "content": "라" * 8000},
            ]
        )

        self.assertEqual(len(request.messages), 4)
        with self.assertRaises(ValidationError):
            PersonalAiChatRequest(messages=[{"role": "system", "content": "hidden"}])
        with self.assertRaises(ValidationError):
            PersonalAiChatRequest(messages=[{"role": "user", "content": "x" * 8001}])
        with self.assertRaises(ValidationError):
            PersonalAiChatRequest(messages=[{"role": "user", "content": "x"}] * 21)
        with self.assertRaises(ValidationError):
            PersonalAiChatRequest(
                messages=[
                    {"role": "user", "content": "x" * 8000},
                    {"role": "assistant", "content": "y" * 8000},
                    {"role": "user", "content": "z" * 8000},
                    {"role": "assistant", "content": "w" * 8000},
                    {"role": "user", "content": "q"},
                ]
            )

    def test_migration_defines_scoped_config_and_atomic_rate_limit_constraints(self) -> None:
        migration = (BACKEND_ROOT / "migrations" / "063_personal_ai.sql").read_text(
            encoding="utf-8"
        )
        normalized = " ".join(migration.lower().split())

        expected_fragments = (
            "create table if not exists personal_ai_configs",
            "company_id text not null references companies(id)",
            "user_id text not null references users(id) on delete cascade",
            "unique (company_id, user_id)",
            "check (connection_status in ('unconfigured', 'untested', 'ready', 'error'))",
            "create table if not exists personal_ai_rate_limits",
            "check (action in ('test', 'chat'))",
            "primary key (company_id, user_id, action, window_started_at)",
        )
        for fragment in expected_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, normalized)


class PersonalAiStoreTest(unittest.TestCase):
    def test_get_config_scopes_by_company_and_user_without_reading_secret(self) -> None:
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb([personal_ai_row()])
        security = RecordingSecurity()
        store = PersonalAiStore(db=db, security_service=security, apply_migrations=False)

        config = store.get_config(personal_ai_actor())

        query, params = db.cursor.executions[0]
        self.assertIn("company_id=%s AND user_id=%s", " ".join(query.split()))
        self.assertEqual(params, ("company-f13", "user-f13"))
        self.assertEqual(config["apiKeyConfigured"], True)
        self.assertEqual(
            set(config),
            {
                "provider",
                "model",
                "apiKeyConfigured",
                "connectionStatus",
                "lastTestCode",
                "lastTestedAt",
            },
        )
        self.assertEqual(security.decrypted_values, [])

    def test_save_config_encrypts_new_key_and_uses_only_parameterized_sql(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb([None])
        security = RecordingSecurity()
        store = PersonalAiStore(db=db, security_service=security, apply_migrations=False)
        payload = PersonalAiConfigUpdate(
            provider="groq",
            model="model-a",
            apiKey="fixture-personal-credential",
        )

        with patch(
            "app.services.personal_ai_store.settings.setup_secret_key",
            "configured-fixture-secret",
        ):
            result = store.save_config(personal_ai_actor(), payload)

        self.assertEqual(security.encrypted_values, ["fixture-personal-credential"])
        self.assertNotIn("apiKey", result)
        self.assertNotIn("encryptedApiKey", result)
        self.assertEqual(result["connectionStatus"], "untested")
        for query, params in db.cursor.executions:
            with self.subTest(query=query):
                self.assertIsNotNone(params)
                self.assertNotIn("company-f13", query)
                self.assertNotIn("user-f13", query)
                self.assertNotIn("fixture-personal-credential", query)
        insert_params = db.cursor.executions[1][1]
        self.assertIsNotNone(insert_params)
        self.assertIn("encrypted-fixture-value", insert_params)
        audit_params = db.cursor.executions[2][1]
        self.assertIsNotNone(audit_params)
        self.assertNotIn("fixture-personal-credential", str(audit_params))
        self.assertNotIn("encrypted-fixture-value", str(audit_params))

    def test_save_config_preserves_key_only_for_unchanged_provider(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb([personal_ai_row()])
        store = PersonalAiStore(
            db=db, security_service=RecordingSecurity(), apply_migrations=False
        )

        store.save_config(
            personal_ai_actor(),
            PersonalAiConfigUpdate(provider="groq", model="model-a"),
        )

        insert_params = db.cursor.executions[1][1]
        self.assertIsNotNone(insert_params)
        self.assertIn("encrypted-existing-value", insert_params)
        self.assertIn("ready", insert_params)

    def test_save_config_removes_old_key_when_provider_changes_or_clear_is_requested(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate
        from app.services.personal_ai_store import PersonalAiStore

        for payload in (
            PersonalAiConfigUpdate(provider="openai", model="model-a"),
            PersonalAiConfigUpdate(
                provider="groq", model="model-a", clearApiKey=True
            ),
        ):
            with self.subTest(payload=payload.model_dump(exclude={"apiKey"})):
                db = RecordingDb([personal_ai_row()])
                store = PersonalAiStore(
                    db=db,
                    security_service=RecordingSecurity(),
                    apply_migrations=False,
                )
                result = store.save_config(personal_ai_actor(), payload)

                insert_params = db.cursor.executions[1][1]
                self.assertIsNotNone(insert_params)
                self.assertIn(None, insert_params)
                self.assertIn("untested", insert_params)
                self.assertEqual(result["apiKeyConfigured"], False)

    def test_save_config_preserves_key_but_resets_status_when_only_model_changes(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb([personal_ai_row()])
        store = PersonalAiStore(
            db=db, security_service=RecordingSecurity(), apply_migrations=False
        )

        result = store.save_config(
            personal_ai_actor(),
            PersonalAiConfigUpdate(provider="groq", model="model-b"),
        )

        insert_params = db.cursor.executions[1][1]
        self.assertIsNotNone(insert_params)
        self.assertIn("encrypted-existing-value", insert_params)
        self.assertEqual(result["apiKeyConfigured"], True)
        self.assertEqual(result["connectionStatus"], "untested")

    def test_save_config_fails_closed_for_default_encryption_setting(self) -> None:
        from app.schemas.personal_ai import PersonalAiConfigUpdate
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb([None])
        store = PersonalAiStore(
            db=db, security_service=RecordingSecurity(), apply_migrations=False
        )

        with self.assertRaises(HTTPException) as captured:
            store.save_config(
                personal_ai_actor(),
                PersonalAiConfigUpdate(
                    provider="groq",
                    model="model-a",
                    apiKey="fixture-personal-credential",
                ),
            )

        self.assertEqual(captured.exception.status_code, 503)
        self.assertEqual(
            captured.exception.detail["code"],
            "PERSONAL_AI_ENCRYPTION_NOT_CONFIGURED",
        )
        self.assertEqual(len(db.cursor.executions), 1)

    def test_record_test_updates_only_actor_scope_and_writes_safe_audit_metadata(self) -> None:
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb()
        store = PersonalAiStore(
            db=db, security_service=RecordingSecurity(), apply_migrations=False
        )

        store.record_test(
            personal_ai_actor(),
            success=False,
            code="PERSONAL_AI_CONNECTION_FAILED",
        )

        update_query, update_params = db.cursor.executions[0]
        self.assertIn("company_id=%s AND user_id=%s", " ".join(update_query.split()))
        self.assertEqual(update_params[-2:], ("company-f13", "user-f13"))
        audit_params = db.cursor.executions[1][1]
        self.assertIsNotNone(audit_params)
        metadata = json.loads(audit_params[-1])
        self.assertEqual(
            metadata,
            {
                "provider": "",
                "code": "PERSONAL_AI_CONNECTION_FAILED",
                "success": False,
            },
        )

    def test_db_rate_limit_allows_boundary_rejects_next_and_resets_next_minute(self) -> None:
        from app.services.personal_ai_store import PersonalAiStore

        db = RecordingDb(
            [
                {"request_count": 5},
                {"request_count": 6},
                {"request_count": 1},
            ]
        )
        store = PersonalAiStore(
            db=db, security_service=RecordingSecurity(), apply_migrations=False
        )
        now = datetime(2026, 8, 24, 3, 14, 59, tzinfo=UTC)

        self.assertEqual(
            store.acquire_rate_limit(
                personal_ai_actor(), "test", limit=5, now=now
            ),
            5,
        )
        with self.assertRaises(HTTPException) as captured:
            store.acquire_rate_limit(
                personal_ai_actor(), "test", limit=5, now=now
            )
        self.assertEqual(captured.exception.status_code, 429)
        self.assertEqual(
            captured.exception.detail["code"], "PERSONAL_AI_RATE_LIMITED"
        )
        self.assertEqual(
            store.acquire_rate_limit(
                personal_ai_actor(), "test", limit=5, now=now + timedelta(minutes=1)
            ),
            1,
        )

        buckets = [execution[1][3] for execution in db.cursor.executions]
        self.assertEqual(buckets[0], buckets[1])
        self.assertNotEqual(buckets[1], buckets[2])
        for query, params in db.cursor.executions:
            self.assertIn("ON CONFLICT", query)
            self.assertIsNotNone(params)


if __name__ == "__main__":
    unittest.main()
