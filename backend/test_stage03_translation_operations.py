from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


class _RecordingTransport:
    def __init__(self, response: dict) -> None:
        self.response = response
        self.calls: list[dict] = []

    def post_json(self, *, url: str, headers: dict[str, str], payload: dict, timeout_seconds: float) -> dict:
        self.calls.append({"url": url, "headers": headers, "payload": payload, "timeout": timeout_seconds})
        return self.response


class Stage03TranslationMigrationTest(unittest.TestCase):
    def test_migration_is_additive_and_tenant_scoped(self) -> None:
        sql = (ROOT / "migrations" / "052_translation_operations.sql").read_text(encoding="utf-8")
        for token in (
            "translation_provider_configs",
            "translation_cache_entries",
            "translation_review_items",
            "translation_review_events",
            "company_id",
            "source_hash",
            "encrypted_api_key",
            "estimated_cost",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("TRUNCATE", upper)
        self.assertNotIn("DELETE FROM", upper)


class Stage03ProviderContractTest(unittest.TestCase):
    def test_openai_compatible_provider_uses_chat_completion_contract(self) -> None:
        from app.services.translation_provider import OpenAICompatibleProvider

        transport = _RecordingTransport(
            {
                "choices": [{"message": {"content": "Hello"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 1},
            }
        )
        provider = OpenAICompatibleProvider(
            api_key="secret-value",
            api_base_url="https://llm.example.test/v1",
            model="translation-model",
            transport=transport,
            timeout_seconds=7,
        )

        result = provider.translate("안녕하세요", "auto", "en")

        self.assertEqual(result.translated_text, "Hello")
        self.assertEqual(result.detected_source_locale, "auto")
        self.assertEqual(result.model, "translation-model")
        self.assertEqual(transport.calls[0]["url"], "https://llm.example.test/v1/chat/completions")
        self.assertEqual(transport.calls[0]["headers"]["Authorization"], "Bearer secret-value")
        self.assertNotIn("secret-value", json.dumps(result.metadata))

    def test_deepl_provider_uses_professional_translation_contract(self) -> None:
        from app.services.translation_provider import DeepLProvider

        transport = _RecordingTransport(
            {"translations": [{"detected_source_language": "KO", "text": "Hello"}]}
        )
        provider = DeepLProvider(
            api_key="deepl-secret",
            api_base_url="https://api-free.deepl.com/v2",
            transport=transport,
            timeout_seconds=9,
        )

        result = provider.translate("안녕하세요", "auto", "en")

        self.assertEqual(result.translated_text, "Hello")
        self.assertEqual(result.detected_source_locale, "ko")
        self.assertEqual(transport.calls[0]["url"], "https://api-free.deepl.com/v2/translate")
        self.assertEqual(transport.calls[0]["headers"]["Authorization"], "DeepL-Auth-Key deepl-secret")


class Stage03SchemaContractTest(unittest.TestCase):
    def test_admin_policy_accepts_masked_provider_configuration(self) -> None:
        from app.schemas.translation import TranslationPolicyRequest

        request = TranslationPolicyRequest(
            enabled=True,
            provider="openai-compatible",
            model="translation-model",
            apiBaseUrl="https://llm.example.test/v1",
            apiKey="secret-value",
            timeoutSeconds=12,
            maxRetries=2,
        )
        self.assertEqual(request.provider, "openai-compatible")
        self.assertEqual(request.apiKey.get_secret_value(), "secret-value")

    def test_review_contract_supports_edit_approve_and_retranslate(self) -> None:
        from app.schemas.translation import TranslationReviewActionRequest

        edit = TranslationReviewActionRequest(action="edit", translatedText="수정된 번역")
        approve = TranslationReviewActionRequest(action="approve")
        retranslate = TranslationReviewActionRequest(action="retranslate")
        self.assertEqual(edit.translatedText, "수정된 번역")
        self.assertEqual(approve.action, "approve")
        self.assertEqual(retranslate.action, "retranslate")

    def test_provider_url_rejects_internal_or_insecure_targets(self) -> None:
        from pydantic import ValidationError
        from app.schemas.translation import TranslationPolicyRequest

        for unsafe in ("http://provider.example.test/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.5/v1"):
            with self.subTest(url=unsafe), self.assertRaises(ValidationError):
                TranslationPolicyRequest(apiBaseUrl=unsafe)


class _FixtureStore:
    def __init__(self, policy: dict) -> None:
        self.policy = policy
        self.cache: dict[tuple, dict] = {}
        self.reviews: list[dict] = []

    def get_policy(self, company_id: str, *, include_secret: bool = False) -> dict:
        return dict(self.policy)

    def read_cache(self, company_id: str, **keys):
        return self.cache.get((company_id, keys["source_hash"], keys["source_locale"], keys["target_locale"], keys["provider"], keys["model"]))

    def write_cache(self, company_id: str, **values) -> None:
        key = (company_id, values["source_hash"], values["source_locale"], values["target_locale"], values["provider"], values["model"])
        self.cache[key] = {"translated_text": values["translated_text"], "estimated_cost": values["estimated_cost"]}

    def create_review(self, actor, **values):
        review = {"id": f"review-{len(self.reviews) + 1}", **values}
        self.reviews.append(review)
        return review


class _FixtureProvider:
    name = "fixture-provider"
    available = True

    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.calls = 0

    def translate(self, text: str, source_locale: str, target_locale: str):
        from app.services.translation_provider import ProviderResult

        self.calls += 1
        if self.calls <= self.failures:
            raise TimeoutError("provider timeout with no secret")
        return ProviderResult("Hello", "ko", model="fixture-model", metadata={"usage": {"total_tokens": 5}, "billableUnits": 5, "costUnit": "tokens"})


class Stage03ResilienceTest(unittest.TestCase):
    def setUp(self) -> None:
        from app.services.translation_service import TranslationService

        TranslationService._failure_state.clear()
        TranslationService._rate_state.clear()

    @staticmethod
    def actor():
        from app.schemas.directory import AuthUserSummary

        return AuthUserSummary(userId="user-a", companyId="company-a", userName="관리자", userEmail="admin@example.test", roleId="role-a", roleName="관리자", userType="admin", status="active", permissions=["admin:*"])

    @staticmethod
    def policy(**overrides):
        return {
            "provider": "fixture-provider", "enabled": True, "cacheEnabled": True, "model": "fixture-model",
            "apiKey": "not-returned", "apiBaseUrl": "https://provider.example.test", "timeoutSeconds": 1,
            "maxRetries": 1, "rateLimitPerMinute": 60, "circuitFailureThreshold": 2, "circuitRecoverySeconds": 60,
            "costPerMillionUnits": 20.0, "costUnit": "tokens",
            **overrides,
        }

    def test_retry_then_postgres_cache_hit_and_review_creation(self) -> None:
        from app.schemas.translation import TranslationRequest
        from app.services.translation_service import TranslationService

        store = _FixtureStore(self.policy())
        provider = _FixtureProvider(failures=1)
        service = TranslationService(store=store)
        service._resolve_provider = lambda _: provider
        request = TranslationRequest(texts=[{"text": "안녕하세요", "sourceLocale": "auto", "targetLocale": "en"}])

        first = service.translate(request, self.actor())
        second = service.translate(request, self.actor())

        self.assertEqual(provider.calls, 2)
        self.assertEqual(first.items[0].translatedText, "Hello")
        self.assertFalse(first.items[0].cacheHit)
        self.assertEqual(first.items[0].estimatedCost, 0.0001)
        self.assertTrue(second.items[0].cacheHit)
        self.assertEqual(len(store.reviews), 1)

    def test_open_circuit_falls_back_to_source_without_extra_provider_call(self) -> None:
        from app.schemas.translation import TranslationRequest
        from app.services.translation_service import TranslationService

        store = _FixtureStore(self.policy(maxRetries=0, circuitFailureThreshold=1))
        provider = _FixtureProvider(failures=10)
        service = TranslationService(store=store)
        service._resolve_provider = lambda _: provider
        request = TranslationRequest(texts=[{"text": "원문 유지", "sourceLocale": "ko", "targetLocale": "en"}], useCache=False)

        first = service.translate(request, self.actor())
        second = service.translate(request, self.actor())

        self.assertEqual(provider.calls, 1)
        self.assertTrue(first.fallbackUsed)
        self.assertEqual(first.items[0].translatedText, "원문 유지")
        self.assertEqual(second.items[0].statusMessage, "circuit_open")


if __name__ == "__main__":
    unittest.main()
