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


class FixtureJsonTransport:
    def __init__(
        self,
        responses: list[dict[str, object]] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.responses = list(responses or [])
        self.error = error
        self.requests: list[dict[str, object]] = []

    def post_json(self, **request: object) -> dict[str, object]:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.responses.pop(0) if self.responses else {}


class InMemoryPersonalAiStore:
    def __init__(self, configs: dict[tuple[str, str], dict[str, object]]) -> None:
        self.configs = {key: dict(value) for key, value in configs.items()}
        self.rate_counts: dict[tuple[str, str, str], int] = {}

    @staticmethod
    def _key(actor: AuthUserSummary) -> tuple[str, str]:
        return actor.companyId, actor.userId

    def get_config(
        self, actor: AuthUserSummary, *, include_secret: bool = False
    ) -> dict[str, object]:
        config = dict(
            self.configs.get(
                self._key(actor),
                {
                    "provider": "",
                    "model": "",
                    "apiKeyConfigured": False,
                    "connectionStatus": "unconfigured",
                    "lastTestCode": None,
                    "lastTestedAt": None,
                    "apiKey": "",
                },
            )
        )
        if not include_secret:
            config.pop("apiKey", None)
        return config

    def save_config(self, actor: AuthUserSummary, payload: object) -> dict[str, object]:
        current = self.configs.get(self._key(actor), {})
        raw_key = payload.apiKey.get_secret_value() if payload.apiKey is not None else None
        configured = bool(raw_key) or (
            payload.provider == current.get("provider")
            and bool(current.get("apiKey"))
            and not payload.clearApiKey
        )
        config = {
            "provider": payload.provider,
            "model": payload.model,
            "apiKeyConfigured": configured,
            "connectionStatus": "untested",
            "lastTestCode": None,
            "lastTestedAt": None,
            "apiKey": raw_key or (current.get("apiKey") if configured else ""),
        }
        self.configs[self._key(actor)] = config
        return {key: value for key, value in config.items() if key != "apiKey"}

    def record_test(
        self, actor: AuthUserSummary, success: bool, code: str
    ) -> None:
        config = self.configs[self._key(actor)]
        config["connectionStatus"] = "ready" if success else "error"
        config["lastTestCode"] = code
        config["lastTestedAt"] = datetime(2026, 8, 24, 4, 0, tzinfo=UTC)

    def acquire_rate_limit(
        self,
        actor: AuthUserSummary,
        action: str,
        limit: int,
        now: datetime | None = None,
    ) -> int:
        key = (actor.companyId, actor.userId, action)
        count = self.rate_counts.get(key, 0) + 1
        self.rate_counts[key] = count
        if count > limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "PERSONAL_AI_RATE_LIMITED",
                    "userMessage": "요청이 너무 많습니다.",
                    "adminMessage": "rate limited",
                },
            )
        return count


class InMemoryCompanyLlmStore:
    def __init__(self, policies: dict[str, dict[str, object]]) -> None:
        self.policies = {key: dict(value) for key, value in policies.items()}

    def get_policy(
        self, company_id: str, *, include_secret: bool = False
    ) -> dict[str, object]:
        policy = dict(
            self.policies.get(
                company_id,
                {
                    "provider": "disabled",
                    "enabled": False,
                    "model": "",
                    "apiBaseUrl": "",
                    "apiKeyConfigured": False,
                    "apiKey": "",
                    "timeoutSeconds": 15,
                },
            )
        )
        if not include_secret:
            policy.pop("apiKey", None)
        return policy


class FixturePersonalAiProviderClient:
    def __init__(
        self,
        *,
        output: str = "업무 답변",
        connection_error: Exception | None = None,
        chat_error: Exception | None = None,
    ) -> None:
        self.output = output
        self.connection_error = connection_error
        self.chat_error = chat_error
        self.connection_configs: list[dict[str, object]] = []
        self.chat_configs: list[dict[str, object]] = []

    def test_connection(self, config: dict[str, object]) -> bool:
        self.connection_configs.append(dict(config))
        if self.connection_error is not None:
            raise self.connection_error
        return True

    def chat(self, config: dict[str, object], messages: list[object]) -> str:
        self.chat_configs.append(dict(config))
        if self.chat_error is not None:
            raise self.chat_error
        return self.output


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
                "configSource",
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


class PersonalAiProviderTest(unittest.TestCase):
    def test_openai_compatible_chat_uses_fixed_profile_and_sanitizes_reasoning(self) -> None:
        from app.services.personal_ai_provider import PersonalAiProviderClient

        transport = FixtureJsonTransport(
            [
                {
                    "choices": [
                        {
                            "message": {
                                "content": "<think>internal draft</think>정리된 업무 답변"
                            }
                        }
                    ]
                }
            ]
        )
        client = PersonalAiProviderClient(transport=transport)

        result = client.chat(
            {
                "provider": "groq",
                "model": "model-a",
                "apiKey": "fixture-personal-credential",
                "apiBaseUrl": "http://user-controlled.invalid",
            },
            [{"role": "user", "content": "오늘 업무를 정리해 줘"}],
        )

        self.assertEqual(result, "정리된 업무 답변")
        request = transport.requests[0]
        self.assertTrue(str(request["url"]).endswith("/chat/completions"))
        self.assertNotIn("user-controlled", str(request["url"]))
        self.assertEqual(
            request["headers"],
            {"Authorization": "Bearer fixture-personal-credential"},
        )
        payload = request["payload"]
        self.assertEqual(payload["model"], "model-a")
        self.assertEqual(payload["stream"], False)
        self.assertIn("business assistant", payload["messages"][0]["content"].lower())
        self.assertEqual(payload["messages"][1]["role"], "user")

    def test_anthropic_chat_uses_messages_contract_and_parses_text_blocks(self) -> None:
        from app.services.personal_ai_provider import PersonalAiProviderClient

        transport = FixtureJsonTransport(
            [
                {
                    "content": [
                        {"type": "text", "text": "첫 문장"},
                        {"type": "text", "text": " 둘째 문장"},
                    ]
                }
            ]
        )

        result = PersonalAiProviderClient(transport=transport).chat(
            {
                "provider": "anthropic",
                "model": "model-b",
                "apiKey": "fixture-personal-credential",
            },
            [{"role": "user", "content": "요약해 줘"}],
        )

        self.assertEqual(result, "첫 문장 둘째 문장")
        request = transport.requests[0]
        self.assertTrue(str(request["url"]).endswith("/messages"))
        self.assertEqual(request["headers"]["x-api-key"], "fixture-personal-credential")
        self.assertEqual(request["headers"]["anthropic-version"], "2023-06-01")
        self.assertEqual(request["payload"]["stream"], False)
        self.assertEqual(request["payload"]["messages"][0]["role"], "user")

    def test_sanitizer_rejects_unclosed_empty_and_oversize_reasoning_output(self) -> None:
        from app.services.personal_ai_provider import (
            PersonalAiProviderError,
            sanitize_personal_ai_output,
        )

        self.assertEqual(
            sanitize_personal_ai_output(
                "<analysis>draft</analysis>최종 답변<think>second draft</think>"
            ),
            "최종 답변",
        )
        for value in (
            "<think>unfinished",
            "<analysis>only reasoning</analysis>",
            "   ",
            "x" * (2 * 1024 * 1024 + 1),
        ):
            with self.subTest(length=len(value)):
                with self.assertRaises(PersonalAiProviderError) as captured:
                    sanitize_personal_ai_output(value)
                self.assertEqual(
                    captured.exception.code, "PERSONAL_AI_RESPONSE_INVALID"
                )

    def test_provider_error_does_not_expose_external_failure_or_request_data(self) -> None:
        from app.services.personal_ai_provider import (
            PersonalAiProviderClient,
            PersonalAiProviderError,
        )

        transport = FixtureJsonTransport(
            error=RuntimeError(
                "external-body fixture-personal-credential user-controlled.invalid"
            )
        )
        client = PersonalAiProviderClient(transport=transport)

        with self.assertRaises(PersonalAiProviderError) as captured:
            client.chat(
                {
                    "provider": "groq",
                    "model": "model-a",
                    "apiKey": "fixture-personal-credential",
                },
                [{"role": "user", "content": "private request payload"}],
            )

        rendered = str(captured.exception)
        self.assertEqual(captured.exception.code, "PERSONAL_AI_PROVIDER_REQUEST_FAILED")
        self.assertNotIn("external-body", rendered)
        self.assertNotIn("fixture-personal-credential", rendered)
        self.assertNotIn("user-controlled", rendered)
        self.assertNotIn("private request payload", rendered)

    def test_malformed_provider_response_uses_safe_invalid_response_code(self) -> None:
        from app.services.personal_ai_provider import (
            PersonalAiProviderClient,
            PersonalAiProviderError,
        )

        client = PersonalAiProviderClient(transport=FixtureJsonTransport([{"choices": []}]))

        with self.assertRaises(PersonalAiProviderError) as captured:
            client.chat(
                {
                    "provider": "groq",
                    "model": "model-a",
                    "apiKey": "fixture-personal-credential",
                },
                [{"role": "user", "content": "업무를 정리해 줘"}],
            )

        self.assertEqual(captured.exception.code, "PERSONAL_AI_RESPONSE_INVALID")
        self.assertEqual(
            str(captured.exception), "personal AI provider response is invalid"
        )

    def test_raw_oversize_and_non_object_responses_use_safe_invalid_response_code(
        self,
    ) -> None:
        from app.services.personal_ai_provider import (
            PersonalAiProviderClient,
            PersonalAiProviderError,
        )

        for raw_response in (
            b"x" * (2 * 1024 * 1024 + 1),
            b"[]",
            b'"text"',
        ):
            with self.subTest(response_size=len(raw_response)):
                with (
                    patch(
                        "app.services.translation_provider.socket.getaddrinfo",
                        return_value=[
                            (2, 1, 6, "", ("8.8.8.8", 443)),
                        ],
                    ),
                    patch(
                        "app.services.translation_provider.urllib_request.build_opener"
                    ) as build_opener,
                ):
                    response = build_opener.return_value.open.return_value.__enter__.return_value
                    response.read.return_value = raw_response
                    client = PersonalAiProviderClient()

                    with self.assertRaises(PersonalAiProviderError) as captured:
                        client.chat(
                            {
                                "provider": "openai",
                                "model": "model-a",
                                "apiKey": "fixture-personal-credential",
                            },
                            [{"role": "user", "content": "업무를 정리해 줘"}],
                        )

                self.assertEqual(
                    captured.exception.code, "PERSONAL_AI_RESPONSE_INVALID"
                )
                self.assertEqual(
                    str(captured.exception),
                    "personal AI provider response is invalid",
                )

    def test_connection_uses_nonstream_fixture_request_without_network(self) -> None:
        from app.services.personal_ai_provider import PersonalAiProviderClient

        transport = FixtureJsonTransport(
            [{"choices": [{"message": {"content": "연결 준비 완료"}}]}]
        )

        success = PersonalAiProviderClient(transport=transport).test_connection(
            {
                "provider": "openai",
                "model": "model-a",
                "apiKey": "fixture-personal-credential",
            }
        )

        self.assertEqual(success, True)
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(transport.requests[0]["payload"]["stream"], False)


class PersonalAiServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        company_store_guard = patch(
            "app.services.personal_ai_service.TranslationOperationsStore",
            side_effect=AssertionError("단위 테스트는 company_llm_store를 명시 주입해야 합니다"),
        )
        company_store_guard.start()
        self.addCleanup(company_store_guard.stop)

    def _configured_store(
        self, *, status_value: str = "ready", api_key: str = "fixture-personal-credential"
    ) -> InMemoryPersonalAiStore:
        return InMemoryPersonalAiStore(
            {
                ("company-f13", "user-f13"): {
                    "provider": "groq",
                    "model": "model-a",
                    "apiKeyConfigured": bool(api_key),
                    "connectionStatus": status_value,
                    "lastTestCode": None,
                    "lastTestedAt": None,
                    "apiKey": api_key,
                },
                ("company-f13", "other-user"): {
                    "provider": "anthropic",
                    "model": "other-model",
                    "apiKeyConfigured": True,
                    "connectionStatus": "ready",
                    "lastTestCode": None,
                    "lastTestedAt": None,
                    "apiKey": "other-user-credential",
                },
            }
        )

    @staticmethod
    def _admin_store() -> InMemoryCompanyLlmStore:
        return InMemoryCompanyLlmStore(
            {
                "company-f13": {
                    "provider": "upstage",
                    "enabled": True,
                    "model": "solar-pro4",
                    "apiBaseUrl": "https://api.upstage.ai/v1",
                    "apiKeyConfigured": True,
                    "apiKey": "fixture-admin-credential",
                    "timeoutSeconds": 18,
                }
            }
        )

    def test_catalog_and_config_hide_endpoint_and_secret_for_actor_scope(self) -> None:
        from app.services.personal_ai_service import PersonalAiService

        service = PersonalAiService(
            store=self._configured_store(),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )

        catalog = service.list_providers().model_dump(mode="json")
        config = service.get_config(personal_ai_actor()).model_dump(mode="json")

        self.assertEqual(len(catalog["providers"]), 9)
        self.assertEqual(
            set(catalog["providers"][0]), {"provider", "label", "apiKeyRequired"}
        )
        self.assertEqual(config["provider"], "groq")
        self.assertEqual(config["model"], "model-a")
        rendered = json.dumps({"catalog": catalog, "config": config})
        self.assertNotIn("fixture-personal-credential", rendered)
        self.assertNotIn("other-user-credential", rendered)
        self.assertNotIn("apiBaseUrl", rendered)

    def test_missing_personal_config_uses_same_company_admin_default_without_exposing_secret(self) -> None:
        from app.schemas.personal_ai import PersonalAiChatRequest
        from app.services.personal_ai_service import PersonalAiService

        client = FixturePersonalAiProviderClient(output="관리자 기본 답변")
        service = PersonalAiService(
            store=InMemoryPersonalAiStore({}),
            company_llm_store=self._admin_store(),
            provider_client=client,
        )

        config = service.get_config(personal_ai_actor()).model_dump(mode="json")
        response = service.chat(
            personal_ai_actor(),
            PersonalAiChatRequest(messages=[{"role": "user", "content": "질문"}]),
        )

        self.assertEqual(config["configSource"], "admin_default")
        self.assertEqual(config["provider"], "upstage")
        self.assertEqual(config["model"], "solar-pro4")
        self.assertEqual(config["connectionStatus"], "ready")
        self.assertNotIn("fixture-admin-credential", json.dumps(config))
        self.assertEqual(response.message.content, "관리자 기본 답변")
        self.assertEqual(client.chat_configs[0]["apiKey"], "fixture-admin-credential")
        self.assertEqual(client.chat_configs[0]["apiBaseUrl"], "https://api.upstage.ai/v1")

    def test_personal_config_wins_and_admin_default_is_tenant_scoped(self) -> None:
        from app.services.personal_ai_service import PersonalAiService

        personal_service = PersonalAiService(
            store=self._configured_store(),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )
        self.assertEqual(
            personal_service.get_config(personal_ai_actor()).configSource,
            "personal",
        )
        self.assertEqual(personal_service.get_config(personal_ai_actor()).provider, "groq")

        other_company = personal_ai_actor().model_copy(
            update={"companyId": "company-other", "userId": "user-other"}
        )
        empty_service = PersonalAiService(
            store=InMemoryPersonalAiStore({}),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )
        config = empty_service.get_config(other_company)
        self.assertEqual(config.configSource, "unconfigured")
        self.assertEqual(config.provider, "")

    def test_model_list_uses_personal_key_then_admin_default_without_returning_credentials(self) -> None:
        from app.schemas.personal_ai import PersonalAiModelListRequest
        from app.services.personal_ai_service import PersonalAiService

        service = PersonalAiService(
            store=self._configured_store(),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )
        with patch(
            "app.services.personal_ai_service.fetch_translation_models",
            return_value=["model-a", "model-b"],
        ) as fetch_models:
            result = service.list_models(
                personal_ai_actor(), PersonalAiModelListRequest(provider="groq")
            )

        self.assertTrue(result.success)
        self.assertEqual(result.models, ["model-a", "model-b"])
        self.assertNotIn("credential", result.model_dump_json())
        self.assertEqual(fetch_models.call_args.kwargs["api_key"], "fixture-personal-credential")

        with patch(
            "app.services.personal_ai_service.fetch_translation_models",
            return_value=["solar-pro4"],
        ) as fetch_models:
            result = service.list_models(
                personal_ai_actor(), PersonalAiModelListRequest(provider="upstage")
            )
        self.assertEqual(result.models, ["solar-pro4"])
        self.assertEqual(fetch_models.call_args.kwargs["api_key"], "fixture-admin-credential")
        self.assertEqual(
            fetch_models.call_args.kwargs["api_base_url"],
            "https://api.upstage.ai/v1",
        )

    def test_connection_transitions_to_ready_and_enforces_five_per_minute(self) -> None:
        from app.services.personal_ai_service import PersonalAiService

        store = self._configured_store(status_value="untested")
        service = PersonalAiService(
            store=store,
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )

        results = [service.test_connection(personal_ai_actor()) for _ in range(5)]

        self.assertTrue(all(result.success for result in results))
        self.assertEqual(results[-1].connectionStatus, "ready")
        self.assertEqual(
            store.get_config(personal_ai_actor())["connectionStatus"], "ready"
        )
        with self.assertRaises(HTTPException) as captured:
            service.test_connection(personal_ai_actor())
        self.assertEqual(captured.exception.status_code, 429)

    def test_connection_failure_is_generalized_and_transitions_to_error(self) -> None:
        from app.services.personal_ai_service import PersonalAiService

        store = self._configured_store(status_value="untested")
        service = PersonalAiService(
            store=store,
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(
                connection_error=RuntimeError(
                    "external-body fixture-personal-credential internal-host"
                )
            ),
        )

        result = service.test_connection(personal_ai_actor())

        self.assertEqual(result.success, False)
        self.assertEqual(result.code, "PERSONAL_AI_CONNECTION_FAILED")
        self.assertEqual(result.connectionStatus, "error")
        rendered = result.model_dump_json()
        self.assertNotIn("external-body", rendered)
        self.assertNotIn("fixture-personal-credential", rendered)
        self.assertNotIn("internal-host", rendered)

    def test_connection_invalid_response_preserves_safe_response_code(self) -> None:
        from app.services.personal_ai_provider import PersonalAiProviderError
        from app.services.personal_ai_service import PersonalAiService

        store = self._configured_store(status_value="untested")
        service = PersonalAiService(
            store=store,
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(
                connection_error=PersonalAiProviderError(
                    "PERSONAL_AI_RESPONSE_INVALID",
                    "personal AI provider response is invalid",
                )
            ),
        )

        result = service.test_connection(personal_ai_actor())

        self.assertEqual(result.success, False)
        self.assertEqual(result.code, "PERSONAL_AI_RESPONSE_INVALID")
        self.assertEqual(result.connectionStatus, "error")
        self.assertEqual(
            store.get_config(personal_ai_actor())["lastTestCode"],
            "PERSONAL_AI_RESPONSE_INVALID",
        )

    def test_connection_rejects_missing_required_key(self) -> None:
        from app.services.personal_ai_service import PersonalAiService

        service = PersonalAiService(
            store=self._configured_store(status_value="untested", api_key=""),
            company_llm_store=InMemoryCompanyLlmStore({}),
            provider_client=FixturePersonalAiProviderClient(),
        )

        with self.assertRaises(HTTPException) as captured:
            service.test_connection(personal_ai_actor())

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(
            captured.exception.detail["code"], "PERSONAL_AI_NOT_CONFIGURED"
        )

    def test_chat_requires_ready_config_and_maps_external_failure_safely(self) -> None:
        from app.schemas.personal_ai import PersonalAiChatRequest
        from app.services.personal_ai_service import PersonalAiService

        request = PersonalAiChatRequest(
            messages=[{"role": "user", "content": "업무를 정리해 줘"}]
        )
        not_ready = PersonalAiService(
            store=self._configured_store(status_value="untested"),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(),
        )
        with self.assertRaises(HTTPException) as captured:
            not_ready.chat(personal_ai_actor(), request)
        self.assertEqual(captured.exception.detail["code"], "PERSONAL_AI_NOT_READY")

        failed = PersonalAiService(
            store=self._configured_store(),
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(
                chat_error=RuntimeError(
                    "external-body fixture-personal-credential internal-host"
                )
            ),
        )
        with self.assertRaises(HTTPException) as captured:
            failed.chat(personal_ai_actor(), request)
        self.assertEqual(captured.exception.status_code, 502)
        self.assertEqual(captured.exception.detail["code"], "PERSONAL_AI_CHAT_FAILED")
        rendered = json.dumps(captured.exception.detail)
        self.assertNotIn("external-body", rendered)
        self.assertNotIn("fixture-personal-credential", rendered)
        self.assertNotIn("internal-host", rendered)

    def test_chat_returns_safe_contract_and_enforces_twenty_per_minute(self) -> None:
        from app.schemas.personal_ai import PersonalAiChatRequest
        from app.services.personal_ai_service import PersonalAiService

        store = self._configured_store()
        service = PersonalAiService(
            store=store,
            company_llm_store=self._admin_store(),
            provider_client=FixturePersonalAiProviderClient(output="안전한 업무 답변"),
        )
        request = PersonalAiChatRequest(
            messages=[{"role": "user", "content": "업무를 정리해 줘"}]
        )

        responses = [service.chat(personal_ai_actor(), request) for _ in range(20)]

        latest = responses[-1].model_dump(mode="json")
        self.assertEqual(
            set(latest), {"provider", "model", "message", "generatedAt"}
        )
        self.assertEqual(latest["message"], {"role": "assistant", "content": "안전한 업무 답변"})
        rendered = json.dumps(latest)
        self.assertNotIn("fixture-personal-credential", rendered)
        self.assertNotIn("apiBaseUrl", rendered)
        with self.assertRaises(HTTPException) as captured:
            service.chat(personal_ai_actor(), request)
        self.assertEqual(captured.exception.status_code, 429)


class PersonalAiRouteContractTest(unittest.TestCase):
    def test_routes_expose_exact_contract_with_profile_read_dependency(self) -> None:
        from fastapi import FastAPI
        from fastapi.routing import APIRoute

        from app.api.routes.personal_ai import router

        app = FastAPI()
        app.include_router(router, prefix="/workspace/personal-ai")
        routes = {
            (route.path, next(iter(route.methods))): route
            for route in app.routes
            if isinstance(route, APIRoute)
        }
        expected = {
            ("/workspace/personal-ai/providers", "GET"): "PersonalAiProviderListView",
            ("/workspace/personal-ai/config", "GET"): "PersonalAiConfigView",
            ("/workspace/personal-ai/config", "PUT"): "PersonalAiConfigView",
            ("/workspace/personal-ai/models", "POST"): "PersonalAiModelListView",
            ("/workspace/personal-ai/test", "POST"): "PersonalAiConnectionTestView",
            ("/workspace/personal-ai/chat", "POST"): "PersonalAiChatResponse",
        }

        self.assertEqual(set(routes), set(expected))
        for route_key, response_model_name in expected.items():
            with self.subTest(route=route_key):
                route = routes[route_key]
                self.assertEqual(route.response_model.__name__, response_model_name)
                dependency_values = {
                    cell.cell_contents
                    for dependency in route.dependant.dependencies
                    for cell in (getattr(dependency.call, "__closure__", None) or ())
                    if isinstance(cell.cell_contents, str)
                }
                self.assertIn("profile:read", dependency_values)


if __name__ == "__main__":
    unittest.main()
