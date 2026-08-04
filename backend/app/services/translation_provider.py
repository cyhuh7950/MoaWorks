from __future__ import annotations

from dataclasses import dataclass, field
import json
from ipaddress import ip_address
import socket
from typing import Any, Protocol
from urllib import request as urllib_request
from urllib.parse import urlparse


@dataclass(frozen=True)
class ProviderResult:
    translated_text: str
    detected_source_locale: str
    model: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    estimated_cost: float | None = None


class JsonTransport(Protocol):
    def post_json(self, *, url: str, headers: dict[str, str], payload: dict, timeout_seconds: float) -> dict: ...


class UrllibJsonTransport:
    def post_json(self, *, url: str, headers: dict[str, str], payload: dict, timeout_seconds: float) -> dict:
        self._validate_public_https_url(url)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib_request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"}, method="POST")
        opener = urllib_request.build_opener(_NoRedirectHandler())
        with opener.open(req, timeout=timeout_seconds) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("translation provider response is too large")
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("translation provider response must be an object")
        return parsed

    @staticmethod
    def _validate_public_https_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("translation provider URL must be public HTTPS")
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
        except socket.gaierror as exc:
            raise ValueError("translation provider host cannot be resolved") from exc
        if not addresses or any(not ip_address(address).is_global for address in addresses):
            raise ValueError("translation provider host resolved to a non-public address")


class _NoRedirectHandler(urllib_request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class TranslationProvider:
    name: str
    available: bool

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        raise NotImplementedError


class DisabledProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="disabled", available=False)

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        return ProviderResult(text, source_locale)


class NoopProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="noop", available=True)

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        translated = text if source_locale == target_locale else f"[{target_locale}] {text}"
        return ProviderResult(translated, source_locale, model="noop")


class EchoProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="echo", available=True)

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        return ProviderResult(text, source_locale, model="echo")


class OpenAICompatibleProvider(TranslationProvider):
    def __init__(self, *, api_key: str, api_base_url: str, model: str, transport: JsonTransport | None = None, timeout_seconds: float = 15) -> None:
        super().__init__(name="openai-compatible", available=bool(api_key and api_base_url and model))
        self.api_key = api_key
        self.api_base_url = api_base_url.rstrip("/")
        self.model = model
        self.transport = transport or UrllibJsonTransport()
        self.timeout_seconds = timeout_seconds

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": "Translate faithfully. Return only the translated text."},
                {"role": "user", "content": f"source={source_locale}; target={target_locale}\n{text}"},
            ],
        }
        response = self.transport.post_json(
            url=f"{self.api_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            payload=payload,
            timeout_seconds=self.timeout_seconds,
        )
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("OpenAI compatible response has no choices")
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        translated = message.get("content") if isinstance(message, dict) else None
        if not isinstance(translated, str) or not translated.strip():
            raise ValueError("OpenAI compatible response has no translated text")
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        billable_units = usage.get("total_tokens") if isinstance(usage, dict) else None
        if not isinstance(billable_units, (int, float)) and isinstance(usage, dict):
            prompt = usage.get("prompt_tokens", 0)
            completion = usage.get("completion_tokens", 0)
            billable_units = prompt + completion if isinstance(prompt, (int, float)) and isinstance(completion, (int, float)) else None
        return ProviderResult(translated.strip(), source_locale, model=self.model, metadata={"usage": usage, "billableUnits": billable_units, "costUnit": "tokens"})


class DeepLProvider(TranslationProvider):
    def __init__(self, *, api_key: str, api_base_url: str, transport: JsonTransport | None = None, timeout_seconds: float = 15) -> None:
        super().__init__(name="deepl", available=bool(api_key and api_base_url))
        self.api_key = api_key
        self.api_base_url = api_base_url.rstrip("/")
        self.transport = transport or UrllibJsonTransport()
        self.timeout_seconds = timeout_seconds

    def translate(self, text: str, source_locale: str, target_locale: str) -> ProviderResult:
        target_code = "ZH-HANS" if target_locale == "zh-cn" else target_locale.upper()
        payload: dict[str, Any] = {"text": [text], "target_lang": target_code}
        if source_locale != "auto":
            payload["source_lang"] = "ZH" if source_locale == "zh-cn" else source_locale.upper()
        response = self.transport.post_json(
            url=f"{self.api_base_url}/translate",
            headers={"Authorization": f"DeepL-Auth-Key {self.api_key}"},
            payload=payload,
            timeout_seconds=self.timeout_seconds,
        )
        translations = response.get("translations")
        if not isinstance(translations, list) or not translations or not isinstance(translations[0], dict):
            raise ValueError("DeepL response has no translations")
        translated = translations[0].get("text")
        detected = translations[0].get("detected_source_language", source_locale)
        if not isinstance(translated, str) or not translated.strip():
            raise ValueError("DeepL response has no translated text")
        billed = translations[0].get("billed_characters")
        return ProviderResult(translated.strip(), str(detected).lower(), model="deepl", metadata={"billableUnits": billed, "costUnit": "characters"})


def resolve_translation_provider(
    provider_name: str,
    *,
    api_key: str = "",
    api_base_url: str = "",
    model: str = "",
    timeout_seconds: float = 15,
    transport: JsonTransport | None = None,
) -> TranslationProvider:
    provider = (provider_name or "disabled").strip().lower()
    if provider == "openai-compatible":
        return OpenAICompatibleProvider(api_key=api_key, api_base_url=api_base_url, model=model, transport=transport, timeout_seconds=timeout_seconds)
    if provider == "deepl":
        return DeepLProvider(api_key=api_key, api_base_url=api_base_url, transport=transport, timeout_seconds=timeout_seconds)
    return {"disabled": DisabledProvider, "noop": NoopProvider, "echo": EchoProvider}.get(provider, DisabledProvider)()
