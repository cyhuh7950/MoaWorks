from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranslationProvider:
    """번역 Provider를 통일된 인터페이스로 노출한다."""

    name: str
    available: bool

    def translate(self, text: str, source_locale: str, target_locale: str) -> str:  # pragma: no cover - 인터페이스 기본
        raise NotImplementedError


class DisabledProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="disabled", available=False)

    def translate(self, text: str, source_locale: str, target_locale: str) -> str:
        return text


class NoopProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="noop", available=True)

    def translate(self, text: str, source_locale: str, target_locale: str) -> str:
        if source_locale == target_locale:
            return text
        return f"[{target_locale}] {text}"


class EchoProvider(TranslationProvider):
    def __init__(self) -> None:
        super().__init__(name="echo", available=True)

    def translate(self, text: str, source_locale: str, target_locale: str) -> str:
        return text


def resolve_translation_provider(provider_name: str) -> TranslationProvider:
    provider = (provider_name or "disabled").strip().lower()
    return {
        "disabled": DisabledProvider,
        "noop": NoopProvider,
        "echo": EchoProvider,
    }.get(provider, DisabledProvider)()
