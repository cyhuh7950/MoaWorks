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

    def get_json(self, *, url: str, headers: dict[str, str], timeout_seconds: float) -> dict:
        self.calls.append({"url": url, "headers": headers, "timeout": timeout_seconds})
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

    def test_split_token_cost_migration_is_additive(self) -> None:
        sql = (ROOT / "migrations" / "053_translation_split_token_costs.sql").read_text(encoding="utf-8")
        self.assertIn("input_cost_per_million_tokens", sql)
        self.assertIn("output_cost_per_million_tokens", sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("TRUNCATE", upper)
        self.assertNotIn("DELETE FROM", upper)


class Stage03ProviderContractTest(unittest.TestCase):
    def test_supported_llm_provider_catalog_is_exact_and_excludes_deepl(self) -> None:
        from app.services.translation_provider import PROVIDER_PROFILES

        self.assertEqual(
            set(PROVIDER_PROFILES),
            {"cerebras", "groq", "mistral", "openai", "upstage", "gemini", "openrouter", "anthropic", "ollama"},
        )
        self.assertEqual(PROVIDER_PROFILES["openai"]["apiBaseUrl"], "https://api.openai.com/v1")
        self.assertEqual(PROVIDER_PROFILES["gemini"]["apiBaseUrl"], "https://generativelanguage.googleapis.com/v1beta/openai")
        self.assertFalse(PROVIDER_PROFILES["ollama"]["apiKeyRequired"])
        self.assertNotIn("deepl", PROVIDER_PROFILES)

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
        self.assertEqual(transport.calls[0]["payload"]["max_completion_tokens"], 2048)
        self.assertFalse(transport.calls[0]["payload"]["stream"])
        self.assertNotIn("secret-value", json.dumps(result.metadata))

    def test_openai_compatible_provider_returns_only_translation_without_reasoning(self) -> None:
        from app.services.translation_provider import OpenAICompatibleProvider

        transport = _RecordingTransport(
            {
                "choices": [{"message": {"content": "<think>internal reasoning</think>\n<think>more reasoning</think>\nHi, send me the order form."}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 18},
            }
        )
        provider = OpenAICompatibleProvider(
            api_key="secret-value",
            api_base_url="https://llm.example.test/v1",
            model="reasoning-model",
            transport=transport,
        )

        result = provider.translate("주문서를 보내줘", "auto", "en")

        self.assertEqual(result.translated_text, "Hi, send me the order form.")
        system_prompt = transport.calls[0]["payload"]["messages"][0]["content"]
        self.assertIn("Never reveal reasoning", system_prompt)
        self.assertIn("Return exactly and only", system_prompt)
        self.assertIn("business communication translation engine", system_prompt)
        self.assertIn("<translation>", system_prompt)
        self.assertNotIn("mail translation engine", system_prompt)

    def test_unclosed_reasoning_is_hidden_when_tagged_translation_exists(self) -> None:
        from app.services.translation_provider import sanitize_translation_output

        raw = "<think>unfinished private reasoning\nOutput draft\n<translation>원래 정보 요구사항을 해결하는 기존 질문의 순위 목록이 유용합니다.</translation>\nProceeds."

        self.assertEqual(
            sanitize_translation_output(raw),
            "원래 정보 요구사항을 해결하는 기존 질문의 순위 목록이 유용합니다.",
        )

    def test_unclosed_reasoning_without_translation_is_rejected(self) -> None:
        from app.services.translation_provider import sanitize_translation_output

        with self.assertRaisesRegex(ValueError, "no final translated text"):
            sanitize_translation_output("<think>unfinished private reasoning\nOutput draft only")

    def test_unclosed_translation_tag_returns_only_its_final_text(self) -> None:
        from app.services.translation_provider import sanitize_translation_output

        source = "We believe that computing a ranked list of existing questions can help the user until another user provides an exact answer."
        raw = "` tags.)*\nFinal string: `<translation>기존 질문의 순위 목록은 정확한 답변이 제공되기 전까지 사용자에게 유용할 수 있습니다."

        self.assertEqual(
            sanitize_translation_output(raw, source),
            "기존 질문의 순위 목록은 정확한 답변이 제공되기 전까지 사용자에게 유용할 수 있습니다.",
        )

    def test_long_source_rejects_tiny_format_residue(self) -> None:
        from app.services.translation_provider import sanitize_translation_output

        source = "This is a deliberately long source message containing enough meaningful text to prove that a two-character provider response is not a valid translation result."
        with self.assertRaisesRegex(ValueError, "no final translated text"):
            sanitize_translation_output("` and `", source)

    def test_short_source_still_allows_short_translation(self) -> None:
        from app.services.translation_provider import sanitize_translation_output

        self.assertEqual(sanitize_translation_output("and", "그리고"), "and")

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

    def test_anthropic_provider_uses_messages_contract_without_exposing_key(self) -> None:
        from app.services.translation_provider import AnthropicProvider

        transport = _RecordingTransport({"content": [{"type": "text", "text": "Hello"}], "usage": {"input_tokens": 4, "output_tokens": 1}})
        provider = AnthropicProvider(
            api_key="anthropic-secret", api_base_url="https://api.anthropic.com/v1",
            model="claude-test", transport=transport, timeout_seconds=5,
        )

        result = provider.translate("안녕하세요", "auto", "en")

        self.assertEqual(result.translated_text, "Hello")
        self.assertEqual(transport.calls[0]["url"], "https://api.anthropic.com/v1/messages")
        self.assertEqual(transport.calls[0]["headers"]["x-api-key"], "anthropic-secret")
        self.assertEqual(transport.calls[0]["headers"]["anthropic-version"], "2023-06-01")
        self.assertNotIn("anthropic-secret", json.dumps(result.metadata))

    def test_ollama_provider_allows_optional_key_and_omits_authorization(self) -> None:
        from app.services.translation_provider import resolve_translation_provider

        transport = _RecordingTransport({"choices": [{"message": {"content": "Hello"}}], "usage": {"total_tokens": 3}})
        provider = resolve_translation_provider(
            "ollama", api_base_url="http://ollama:11434/v1", model="qwen3:8b", transport=transport,
        )

        self.assertTrue(provider.available)
        self.assertEqual(provider.name, "ollama")
        provider.translate("안녕하세요", "auto", "en")
        self.assertNotIn("Authorization", transport.calls[0]["headers"])

    def test_provider_model_catalog_is_loaded_from_live_models_endpoint(self) -> None:
        from app.services.translation_provider import fetch_translation_models

        transport = _RecordingTransport({"data": [{"id": "llama-3.3-70b-versatile"}, {"id": "llama-3.1-8b-instant"}]})

        models = fetch_translation_models(
            "groq", api_key="secret-value", api_base_url="https://api.groq.com/openai/v1",
            transport=transport, timeout_seconds=7,
        )

        self.assertEqual(models, ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"])
        self.assertEqual(transport.calls[0]["url"], "https://api.groq.com/openai/v1/models")
        self.assertEqual(transport.calls[0]["headers"]["Authorization"], "Bearer secret-value")


class Stage03SchemaContractTest(unittest.TestCase):
    def test_connection_test_accepts_llm_draft_and_protects_api_key(self) -> None:
        from app.schemas.translation import TranslationConnectionTestRequest

        request = TranslationConnectionTestRequest(
            provider="groq", model="llama-test", apiBaseUrl="https://api.groq.com/openai/v1", apiKey="secret-value",
        )
        self.assertEqual(request.provider, "groq")
        self.assertEqual(request.apiKey.get_secret_value(), "secret-value")
        self.assertNotIn("secret-value", str(request))

        ollama = TranslationConnectionTestRequest(
            provider="ollama", model="qwen3:8b", apiBaseUrl="http://ollama:11434/v1",
        )
        self.assertIsNone(ollama.apiKey)

    def test_connection_test_can_reuse_saved_key_for_same_provider(self) -> None:
        from app.schemas.translation import TranslationConnectionTestRequest

        request = TranslationConnectionTestRequest(
            provider="openai", model="gpt-test", apiBaseUrl="https://api.openai.com/v1",
        )

        self.assertIsNone(request.apiKey)

    def test_non_ollama_provider_rejects_internal_or_plain_http_url(self) -> None:
        from pydantic import ValidationError
        from app.schemas.translation import TranslationConnectionTestRequest

        for unsafe in ("http://api.example.test/v1", "https://127.0.0.1/v1", "https://10.0.0.5/v1"):
            with self.assertRaises(ValidationError):
                TranslationConnectionTestRequest(provider="openai", model="model", apiBaseUrl=unsafe, apiKey="key")

    def test_translation_route_exposes_admin_connection_test_only(self) -> None:
        route = (ROOT / "app" / "api" / "routes" / "translation.py").read_text(encoding="utf-8")
        self.assertIn('@admin_router.post("/admin/test-connection"', route)
        self.assertIn('@admin_router.post("/admin/models"', route)
        self.assertNotIn('@router.post("/test-connection"', route)
        self.assertNotIn('@router.post("/models"', route)

    def test_user_translation_status_is_authenticated_and_tenant_scoped(self) -> None:
        route = (ROOT / "app" / "api" / "routes" / "translation.py").read_text(encoding="utf-8")
        self.assertIn(
            "def translation_status(user: AuthUserSummary = Depends(get_current_user))",
            route,
        )
        self.assertIn("return service.get_status(user)", route)

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

    def test_admin_policy_requires_split_token_costs_as_a_pair(self) -> None:
        from pydantic import ValidationError
        from app.schemas.translation import TranslationPolicyRequest

        request = TranslationPolicyRequest(
            inputCostPerMillionTokens=10.0,
            outputCostPerMillionTokens=30.0,
        )
        self.assertEqual(request.inputCostPerMillionTokens, 10.0)
        self.assertEqual(request.outputCostPerMillionTokens, 30.0)
        with self.assertRaises(ValidationError):
            TranslationPolicyRequest(inputCostPerMillionTokens=10.0)

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
        return ProviderResult("Hello", "ko", model="fixture-model", metadata={"usage": {"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5}, "billableUnits": 5, "costUnit": "tokens"})


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

    def test_split_input_output_token_costs_take_priority_over_legacy_rate(self) -> None:
        from app.schemas.translation import TranslationRequest
        from app.services.translation_service import TranslationService

        store = _FixtureStore(self.policy(
            costPerMillionUnits=999.0,
            inputCostPerMillionTokens=10.0,
            outputCostPerMillionTokens=30.0,
        ))
        provider = _FixtureProvider()
        service = TranslationService(store=store)
        service._resolve_provider = lambda _: provider
        request = TranslationRequest(texts=[{"text": "비용 분리", "sourceLocale": "ko", "targetLocale": "en"}], useCache=False)

        response = service.translate(request, self.actor())

        self.assertEqual(response.items[0].estimatedCost, 0.00007)

    def test_cached_translation_hides_legacy_reasoning_blocks(self) -> None:
        import hashlib
        from app.schemas.translation import TranslationRequest
        from app.services.translation_service import TranslationService

        store = _FixtureStore(self.policy())
        source_text = "주문서를 보내줘"
        source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        store.cache[("company-a", source_hash, "ko", "en", "fixture-provider", "fixture-model")] = {
            "translated_text": "<think>legacy cached reasoning</think>\nHi, send me the order form.",
            "estimated_cost": 0.0001,
        }
        provider = _FixtureProvider()
        service = TranslationService(store=store)
        service._resolve_provider = lambda _: provider

        response = service.translate(
            TranslationRequest(texts=[{"text": source_text, "sourceLocale": "ko", "targetLocale": "en"}]),
            self.actor(),
        )

        self.assertEqual(response.items[0].translatedText, "Hi, send me the order form.")
        self.assertTrue(response.items[0].cacheHit)
        self.assertEqual(provider.calls, 0)
    def test_reasoning_only_cache_is_ignored_and_refreshed_from_provider(self) -> None:
        import hashlib
        from app.schemas.translation import TranslationRequest
        from app.services.translation_service import TranslationService

        store = _FixtureStore(self.policy())
        source_text = "주문서를 보내줘"
        source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        store.cache[("company-a", source_hash, "ko", "en", "fixture-provider", "fixture-model")] = {
            "translated_text": "<think>legacy cached reasoning only</think>",
            "estimated_cost": 0.0001,
        }
        provider = _FixtureProvider()
        service = TranslationService(store=store)
        service._resolve_provider = lambda _: provider

        response = service.translate(
            TranslationRequest(texts=[{"text": source_text, "sourceLocale": "ko", "targetLocale": "en"}]),
            self.actor(),
        )

        self.assertEqual(response.items[0].translatedText, "Hello")
        self.assertFalse(response.items[0].cacheHit)
        self.assertEqual(provider.calls, 1)
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

    def test_connection_failure_preserves_safe_http_status_without_response_body(self) -> None:
        from urllib.error import HTTPError
        from app.services.translation_service import TranslationService

        error = HTTPError("https://api.groq.com/openai/v1/chat/completions", 403, "Forbidden", {}, None)

        self.assertEqual(TranslationService._safe_error_code(error), "provider_http_403")


if __name__ == "__main__":
    unittest.main()
