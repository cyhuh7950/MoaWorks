from __future__ import annotations

import hashlib
import json
import logging
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, status

from app.core.config import settings
from app.schemas.translation import (
    TranslationItem,
    TranslationPolicyRequest,
    TranslationRequest,
    TranslationResponse,
    TranslationStatus,
)
from app.services.translation_provider import TranslationProvider, resolve_translation_provider

logger = logging.getLogger(__name__)


_SUPPORTED_LOCALES = ["en", "ko", "ja", "zh-cn", "es", "fr", "de"]
_SUPPORTED_SOURCE_LOCALES = sorted(set(_SUPPORTED_LOCALES + ["auto"]))
_SUPPORTED_TARGET_LOCALES = _SUPPORTED_LOCALES


def _normalize_locale(value: str) -> str:
    return value.strip().replace("_", "-").lower()


def _is_locale_supported(locales: list[str], value: str) -> bool:
    return _normalize_locale(value) in locales
class TranslationService:
    def __init__(self, state_path: Path | None = None, cache_path: Path | None = None) -> None:
        self.state_path = state_path or settings.translation_state_file
        self.cache_path = cache_path or settings.translation_cache_file

    def get_status(self) -> TranslationStatus:
        config = self._load_config()
        provider = self._resolve_provider(config.get("provider"))
        enabled = bool(config.get("enabled", settings.translation_enabled))
        provider_available = enabled and provider.available
        fallback_message = "translation disabled" if not enabled else None
        if enabled and not provider.available:
            fallback_message = "provider unavailable"
        return TranslationStatus(
            provider=provider.name,
            available=provider_available,
            enabled=enabled,
            supportedSourceLocales=_SUPPORTED_SOURCE_LOCALES,
            supportedTargetLocales=_SUPPORTED_TARGET_LOCALES,
            cacheEnabled=bool(config.get("cacheEnabled", True)),
            fallbackMessage=fallback_message,
        )

    def get_policy(self) -> dict[str, object]:
        config = self._load_config()
        return {
            "provider": _normalize_locale(str(config.get("provider", settings.translation_provider))),
            "enabled": bool(config.get("enabled", settings.translation_enabled)),
            "cacheEnabled": bool(config.get("cacheEnabled", True)),
            "supportedSourceLocales": _SUPPORTED_SOURCE_LOCALES,
            "supportedTargetLocales": _SUPPORTED_TARGET_LOCALES,
        }

    def update_policy(self, payload: TranslationPolicyRequest) -> dict[str, object]:
        if payload.provider is not None:
            provider = payload.provider.strip().lower()
            if provider not in {"disabled", "noop", "echo"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "TRANSLATION_PROVIDER_INVALID",
                        "userMessage": "지원하지 않는 번역 Provider입니다.",
                        "adminMessage": f"unsupported provider: {provider}",
                    },
                )

        config = self._load_config()
        if payload.enabled is not None:
            config["enabled"] = payload.enabled
        if payload.provider is not None:
            config["provider"] = payload.provider.strip().lower()
        if payload.cacheEnabled is not None:
            config["cacheEnabled"] = payload.cacheEnabled
        self._save_state(config)
        return self.get_policy()

    def translate(self, request: TranslationRequest) -> TranslationResponse:
        config = self._load_config()
        provider = self._resolve_provider(config.get("provider"))
        cache_enabled = bool(config.get("cacheEnabled", True)) and request.useCache
        translation_enabled = bool(config.get("enabled", settings.translation_enabled))

        items: list[TranslationItem] = []
        request_id = f"tr_{id(self):x}_{datetime.now().timestamp():.0f}"
        fallback_used = not translation_enabled

        for text_request in request.texts:
            source_locale = _normalize_locale(text_request.sourceLocale)
            target_locale = _normalize_locale(text_request.targetLocale)
            if not _is_locale_supported(_SUPPORTED_SOURCE_LOCALES, source_locale):
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "validation", "지원하지 않는 sourceLocale입니다."))
                continue
            if not _is_locale_supported(_SUPPORTED_TARGET_LOCALES, target_locale):
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "validation", "지원하지 않는 targetLocale입니다."))
                continue

            if not translation_enabled or not provider.available:
                items.append(self._disabled_item(text_request.text, source_locale, target_locale, "provider-disabled", "번역 비활성 상태"))
                continue

            fallback_used = False
            cache_key = self._cache_key(text_request.text, source_locale, target_locale, provider.name)
            cache_hit = False
            translated = None
            source = "provider"
            status_message: str | None = None

            if cache_enabled:
                translated = self._read_cache(cache_key)
                if translated is not None:
                    cache_hit = True
                    source = "cache"

            if translated is None:
                try:
                    translated = provider.translate(text_request.text, source_locale, target_locale)
                except Exception as exc:
                    logger.warning(
                        "translation_provider_error",
                        extra={
                            "provider": provider.name,
                            "sourceLocale": source_locale,
                            "targetLocale": target_locale,
                            "error": str(exc),
                        },
                    )
                    status_message = "provider_error"
                    translated = text_request.text
                    source = "fallback"
                    fallback_used = True
                else:
                    if cache_enabled:
                        self._write_cache(cache_key, translated, source_locale, target_locale, provider.name)

            is_translated = translated != text_request.text and source != "fallback"
            items.append(
                TranslationItem(
                    sourceLocale=source_locale,
                    targetLocale=target_locale,
                    originalText=text_request.text,
                    translatedText=translated,
                    provider=provider.name,
                    source=source,
                    cacheHit=cache_hit,
                    translated=is_translated,
                    statusMessage=status_message,
                )
            )

        return TranslationResponse(
            requestId=request_id,
            provider=provider.name,
            providerAvailable=provider.available,
            fallbackUsed=fallback_used,
            items=items,
            executedAt=datetime.now(UTC),
        )

    def _disabled_item(self, text: str, source_locale: str, target_locale: str, source: str, status_message: str) -> TranslationItem:
        return TranslationItem(
            sourceLocale=source_locale,
            targetLocale=target_locale,
            originalText=text,
            translatedText=text,
            provider="disabled",
            source=source,
            cacheHit=False,
            translated=False,
            statusMessage=status_message,
        )

    def _resolve_provider(self, provider_name: str | None) -> TranslationProvider:
        provider = provider_name or settings.translation_provider
        return resolve_translation_provider(provider)

    def _load_config(self) -> dict[str, object]:
        if not self.state_path.exists():
            return {
                "enabled": settings.translation_enabled,
                "provider": settings.translation_provider,
                "cacheEnabled": True,
            }
        payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
        return {
            "enabled": settings.translation_enabled,
            "provider": settings.translation_provider,
            "cacheEnabled": True,
        }

    def _save_state(self, payload: dict[str, object]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=str(self.state_path.parent),
            prefix=".translation-state-",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_file.write(json.dumps(payload, ensure_ascii=False, indent=2))
            temp_path = temp_file.name
        Path(temp_path).replace(self.state_path)

    def _load_cache(self) -> dict[str, object]:
        if not self.cache_path.exists():
            return {}
        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
        return {}

    def _cache_key(self, text: str, source_locale: str, target_locale: str, provider: str) -> str:
        return hashlib.sha256(f"{provider}:{source_locale}:{target_locale}:{text}".encode("utf-8")).hexdigest()

    def _read_cache(self, key: str) -> str | None:
        cache = self._load_cache()
        entry = cache.get(key)
        if isinstance(entry, dict):
            value = entry.get("translatedText")
            if isinstance(value, str) and value.strip():
                return value
        return None

    def _write_cache(self, key: str, translated_text: str, source_locale: str, target_locale: str, provider: str) -> None:
        cache = self._load_cache()
        cache[key] = {
            "translatedText": translated_text,
            "sourceLocale": source_locale,
            "targetLocale": target_locale,
            "provider": provider,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
