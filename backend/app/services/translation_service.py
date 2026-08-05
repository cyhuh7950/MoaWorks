from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import replace
import hashlib
import json
import logging
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError

from fastapi import HTTPException, status

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.translation import TranslationConnectionTestRequest, TranslationConnectionTestResponse, TranslationItem, TranslationPolicyRequest, TranslationRequest, TranslationResponse, TranslationStatus
from app.services.translation_operations_store import DEFAULT_POLICY, TranslationOperationsStore
from app.services.translation_provider import PROVIDER_PROFILES, ProviderResult, TranslationProvider, resolve_translation_provider

logger = logging.getLogger(__name__)

_SUPPORTED_LOCALES = ["en", "ko", "ja", "zh-cn", "es", "fr", "de"]
_SUPPORTED_SOURCE_LOCALES = sorted(set(_SUPPORTED_LOCALES + ["auto"]))
_SUPPORTED_TARGET_LOCALES = _SUPPORTED_LOCALES


def _normalize_locale(value: str) -> str:
    return value.strip().replace("_", "-").lower()


class TranslationService:
    _failure_state: dict[str, tuple[int, float | None]] = {}
    _rate_state: dict[str, deque[float]] = defaultdict(deque)

    def __init__(self, state_path: Path | None = None, cache_path: Path | None = None, *, store: TranslationOperationsStore | None = None) -> None:
        self.state_path = state_path or settings.translation_state_file
        self.cache_path = cache_path or settings.translation_cache_file
        self.store = store

    def _operations_store(self) -> TranslationOperationsStore:
        if self.store is None:
            self.store = TranslationOperationsStore()
        return self.store

    def get_status(self, actor: AuthUserSummary | None = None) -> TranslationStatus:
        config = self._policy(actor, include_secret=True)
        provider = self._resolve_provider(config)
        enabled = bool(config.get("enabled", settings.translation_enabled))
        provider_available = enabled and provider.available
        fallback_message = "translation disabled" if not enabled else None
        if enabled and not provider.available:
            fallback_message = "provider unavailable"
        return TranslationStatus(
            provider=provider.name, available=provider_available, enabled=enabled,
            supportedSourceLocales=_SUPPORTED_SOURCE_LOCALES, supportedTargetLocales=_SUPPORTED_TARGET_LOCALES,
            cacheEnabled=bool(config.get("cacheEnabled", True)), fallbackMessage=fallback_message,
        )

    def get_policy(self, actor: AuthUserSummary | None = None) -> dict[str, object]:
        config = self._policy(actor)
        return {
            **{key: config.get(key, default) for key, default in DEFAULT_POLICY.items()},
            "supportedSourceLocales": _SUPPORTED_SOURCE_LOCALES,
            "supportedTargetLocales": _SUPPORTED_TARGET_LOCALES,
            "providerOptions": self._provider_options(),
        }

    def update_policy(self, payload: TranslationPolicyRequest, actor: AuthUserSummary | None = None) -> dict[str, object]:
        if actor is not None:
            updated = self._operations_store().update_policy(actor, payload)
            return {**updated, "supportedSourceLocales": _SUPPORTED_SOURCE_LOCALES, "supportedTargetLocales": _SUPPORTED_TARGET_LOCALES, "providerOptions": self._provider_options()}
        if payload.provider is not None and payload.provider not in {"disabled", "noop", "echo"}:
            raise HTTPException(status_code=400, detail={"code": "TRANSLATION_PROVIDER_INVALID", "userMessage": "지원하지 않는 번역 Provider입니다.", "adminMessage": f"unsupported legacy provider: {payload.provider}"})
        config = self._load_config()
        for field, key in (("enabled", "enabled"), ("provider", "provider"), ("cacheEnabled", "cacheEnabled")):
            value = getattr(payload, field)
            if value is not None:
                config[key] = value
        self._save_state(config)
        return self.get_policy()

    def test_connection(self, payload: TranslationConnectionTestRequest, actor: AuthUserSummary) -> TranslationConnectionTestResponse:
        saved = self._operations_store().get_policy(actor.companyId, include_secret=True)
        draft_key = payload.apiKey.get_secret_value() if payload.apiKey is not None else ""
        api_key = draft_key or (str(saved.get("apiKey", "")) if saved.get("provider") == payload.provider else "")
        provider = resolve_translation_provider(
            payload.provider, api_key=api_key, api_base_url=payload.apiBaseUrl,
            model=payload.model, timeout_seconds=payload.timeoutSeconds,
        )
        success = False
        code = "TRANSLATION_PROVIDER_CONFIGURATION_REQUIRED"
        message = "Provider 설정을 확인하세요."
        if provider.available:
            try:
                result = provider.translate("Connection test", "en", "ko")
                success = bool(result.translated_text.strip())
                code = "TRANSLATION_PROVIDER_CONNECTION_OK" if success else "TRANSLATION_PROVIDER_EMPTY_RESPONSE"
                message = "LLM Provider 연결에 성공했습니다." if success else "Provider 응답이 비어 있습니다."
            except Exception as exc:
                code = self._safe_error_code(exc)
                message = "LLM Provider 연결에 실패했습니다. 키, 모델, API 주소를 확인하세요."
        self._operations_store().record_connection_test(actor, provider=payload.provider, success=success, code=code)
        return TranslationConnectionTestResponse(success=success, provider=payload.provider, model=payload.model, code=code, message=message, testedAt=datetime.now(UTC))

    def translate(self, request: TranslationRequest, actor: AuthUserSummary | None = None, *, create_reviews: bool = True) -> TranslationResponse:
        config = self._policy(actor, include_secret=True)
        provider = self._resolve_provider(config)
        cache_enabled = bool(config.get("cacheEnabled", True)) and request.useCache
        enabled = bool(config.get("enabled", settings.translation_enabled))
        request_id = f"tr_{id(self):x}_{datetime.now().timestamp():.0f}"
        items: list[TranslationItem] = []
        fallback_used = not enabled

        for text_request in request.texts:
            source_locale = _normalize_locale(text_request.sourceLocale)
            target_locale = _normalize_locale(text_request.targetLocale)
            if source_locale not in _SUPPORTED_SOURCE_LOCALES:
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "validation", "지원하지 않는 sourceLocale입니다."))
                continue
            if target_locale not in _SUPPORTED_TARGET_LOCALES:
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "validation", "지원하지 않는 targetLocale입니다."))
                continue
            if not enabled or not provider.available:
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "provider-disabled", "번역 비활성 상태"))
                continue

            source_hash = hashlib.sha256(text_request.text.encode("utf-8")).hexdigest()
            model = str(config.get("model", ""))
            cached = self._read_cache(actor, source_hash, text_request.text, source_locale, target_locale, provider.name, model) if cache_enabled else None
            if cached is not None:
                fallback_used = False
                items.append(TranslationItem(
                    sourceLocale=source_locale, targetLocale=target_locale, originalText=text_request.text,
                    translatedText=cached["translatedText"], provider=provider.name, source="cache", cacheHit=True,
                    translated=cached["translatedText"] != text_request.text, model=model,
                    estimatedCost=cached.get("estimatedCost"),
                ))
                continue

            try:
                result = self._invoke_with_resilience(provider, text_request.text, source_locale, target_locale, config, actor)
                rate = config.get("costPerMillionUnits")
                units = result.metadata.get("billableUnits")
                if isinstance(rate, (int, float)) and isinstance(units, (int, float)) and rate >= 0:
                    result = replace(result, estimated_cost=float(rate) * float(units) / 1_000_000)
            except Exception as exc:
                logger.warning("translation_provider_error", extra={"provider": provider.name, "sourceLocale": source_locale, "targetLocale": target_locale, "errorType": type(exc).__name__})
                fallback_used = True
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "fallback", self._safe_error_code(exc), provider.name))
                continue

            fallback_used = False
            review_id = None
            if cache_enabled:
                self._write_cache(actor, source_hash, text_request.text, source_locale, target_locale, provider.name, result)
            if actor is not None and create_reviews:
                review = self._operations_store().create_review(
                    actor, source_hash=source_hash, source_locale=source_locale, target_locale=target_locale,
                    source_text=text_request.text, translated_text=result.translated_text, provider=provider.name,
                    model=result.model, estimated_cost=result.estimated_cost,
                )
                review_id = review["id"]
            items.append(TranslationItem(
                sourceLocale=source_locale, targetLocale=target_locale, originalText=text_request.text,
                translatedText=result.translated_text, provider=provider.name, source="provider", cacheHit=False,
                translated=result.translated_text != text_request.text, detectedSourceLocale=result.detected_source_locale,
                model=result.model, estimatedCost=result.estimated_cost, reviewId=review_id,
            ))

        return TranslationResponse(requestId=request_id, provider=provider.name, providerAvailable=provider.available, fallbackUsed=fallback_used, items=items, executedAt=datetime.now(UTC))

    def retranslate_review(self, actor: AuthUserSummary, review_id: str) -> dict[str, object]:
        store = self._operations_store()
        review = store.get_review(actor, review_id)
        request = TranslationRequest(
            texts=[{"text": review["source_text"], "sourceLocale": review["source_locale"], "targetLocale": review["target_locale"]}],
            useCache=False,
        )
        response = self.translate(request, actor, create_reviews=False)
        item = response.items[0]
        if response.fallbackUsed or not item.translated:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "TRANSLATION_RETRANSLATE_FAILED", "userMessage": "재번역에 실패해 기존 번역을 유지했습니다.", "adminMessage": item.statusMessage or "provider fallback"},
            )
        return store.apply_retranslation(
            actor, review_id, translated_text=item.translatedText, provider=item.provider,
            model=item.model, estimated_cost=item.estimatedCost,
        )

    def _invoke_with_resilience(self, provider: TranslationProvider, text: str, source_locale: str, target_locale: str, config: dict[str, object], actor: AuthUserSummary | None) -> ProviderResult:
        key = f"{actor.companyId if actor else 'legacy'}:{provider.name}"
        now = time.monotonic()
        failures, opened_at = self._failure_state.get(key, (0, None))
        recovery = int(config.get("circuitRecoverySeconds", 60))
        if opened_at is not None and now - opened_at < recovery:
            raise RuntimeError("circuit_open")
        if opened_at is not None:
            failures = 0
        rate_limit = int(config.get("rateLimitPerMinute", 60))
        recent = self._rate_state[key]
        while recent and now - recent[0] >= 60:
            recent.popleft()
        if len(recent) >= rate_limit:
            raise RuntimeError("rate_limited")
        recent.append(now)

        attempts = int(config.get("maxRetries", 2)) + 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                result = provider.translate(text, source_locale, target_locale)
                self._failure_state[key] = (0, None)
                return result
            except Exception as exc:
                last_error = exc
                if isinstance(exc, HTTPError) and exc.code < 500 and exc.code != 429:
                    break
                if attempt + 1 < attempts:
                    time.sleep(min(0.1 * (2**attempt), 0.5))
        failures += 1
        threshold = int(config.get("circuitFailureThreshold", 5))
        self._failure_state[key] = (failures, time.monotonic() if failures >= threshold else None)
        raise last_error or RuntimeError("provider_error")

    def _policy(self, actor: AuthUserSummary | None, *, include_secret: bool = False) -> dict[str, object]:
        if actor is not None:
            return self._operations_store().get_policy(actor.companyId, include_secret=include_secret)
        config = self._load_config()
        return {**DEFAULT_POLICY, **config}

    def _resolve_provider(self, config: dict[str, object]) -> TranslationProvider:
        return resolve_translation_provider(
            str(config.get("provider", settings.translation_provider)), api_key=str(config.get("apiKey", "")),
            api_base_url=str(config.get("apiBaseUrl", "")), model=str(config.get("model", "")),
            timeout_seconds=float(config.get("timeoutSeconds", 15)),
        )

    @staticmethod
    def _provider_options() -> list[dict[str, object]]:
        return [
            {"provider": key, "label": profile["label"], "apiBaseUrl": profile["apiBaseUrl"], "apiKeyRequired": profile["apiKeyRequired"]}
            for key, profile in PROVIDER_PROFILES.items()
        ]

    def _read_cache(self, actor: AuthUserSummary | None, source_hash: str, source_text: str, source_locale: str, target_locale: str, provider: str, model: str) -> dict[str, object] | None:
        if actor is not None:
            row = self._operations_store().read_cache(actor.companyId, source_hash=source_hash, source_locale=source_locale, target_locale=target_locale, provider=provider, model=model)
            return {"translatedText": row["translated_text"], "estimatedCost": float(row["estimated_cost"]) if row and row.get("estimated_cost") is not None else None} if row else None
        value = self._read_legacy_cache(self._legacy_cache_key(source_text, source_locale, target_locale, provider))
        return {"translatedText": value} if value is not None else None

    def _write_cache(self, actor: AuthUserSummary | None, source_hash: str, source_text: str, source_locale: str, target_locale: str, provider: str, result: ProviderResult) -> None:
        if actor is not None:
            self._operations_store().write_cache(actor.companyId, source_hash=source_hash, source_locale=source_locale, target_locale=target_locale, source_text=source_text, translated_text=result.translated_text, provider=provider, model=result.model, metadata=result.metadata, estimated_cost=result.estimated_cost)
            return
        cache = self._load_cache()
        cache[self._legacy_cache_key(source_text, source_locale, target_locale, provider)] = {"translatedText": result.translated_text, "createdAt": datetime.now(UTC).isoformat()}
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _safe_error_code(exc: Exception) -> str:
        message = str(exc)
        if message in {"circuit_open", "rate_limited"}:
            return message
        if isinstance(exc, TimeoutError):
            return "provider_timeout"
        if isinstance(exc, HTTPError) and exc.code == 429:
            return "provider_rate_limited"
        return "provider_error"

    @staticmethod
    def _disabled_item(text: str, source_locale: str, target_locale: str, source: str, status_message: str, provider: str = "disabled") -> TranslationItem:
        return TranslationItem(sourceLocale=source_locale, targetLocale=target_locale, originalText=text, translatedText=text, provider=provider, source=source, cacheHit=False, translated=False, statusMessage=status_message)

    def _load_config(self) -> dict[str, object]:
        if not self.state_path.exists():
            return {"enabled": settings.translation_enabled, "provider": settings.translation_provider, "cacheEnabled": True}
        payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}

    def _save_state(self, payload: dict[str, object]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(self.state_path.parent), prefix=".translation-state-", suffix=".tmp", delete=False) as temp_file:
            temp_file.write(json.dumps(payload, ensure_ascii=False, indent=2))
            temp_path = temp_file.name
        Path(temp_path).replace(self.state_path)

    def _load_cache(self) -> dict[str, object]:
        if not self.cache_path.exists():
            return {}
        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _legacy_cache_key(text: str, source_locale: str, target_locale: str, provider: str) -> str:
        return hashlib.sha256(f"{provider}:{source_locale}:{target_locale}:{text}".encode("utf-8")).hexdigest()

    def _read_legacy_cache(self, key: str) -> str | None:
        entry = self._load_cache().get(key)
        value = entry.get("translatedText") if isinstance(entry, dict) else None
        return value if isinstance(value, str) and value.strip() else None
