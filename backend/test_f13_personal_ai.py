from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import unittest

from pydantic import ValidationError


BACKEND_ROOT = Path(__file__).resolve().parent


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


if __name__ == "__main__":
    unittest.main()
