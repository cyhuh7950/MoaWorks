from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class TranslationTextRequest(BaseModel):
    text: str = Field(min_length=1)
    sourceLocale: str = Field(default="ko")
    targetLocale: str = Field(default="en")

    @field_validator("sourceLocale", "targetLocale")
    @classmethod
    def normalize_locale(cls, value: str) -> str:
        normalized = value.strip().replace("_", "-").lower()
        if not normalized:
            raise ValueError("locale must not be empty")
        return normalized


class TranslationRequest(BaseModel):
    texts: list[TranslationTextRequest]
    includeSource: bool = True
    useCache: bool = True

    @field_validator("texts")
    @classmethod
    def validate_payload_limit(cls, value: list[TranslationTextRequest]) -> list[TranslationTextRequest]:
        if len(value) == 0:
            raise ValueError("요청 텍스트는 1개 이상이어야 합니다.")
        if len(value) > 64:
            raise ValueError("요청 텍스트는 64개 이하로 제한됩니다.")
        return value


class TranslationItem(BaseModel):
    sourceLocale: str
    targetLocale: str
    originalText: str
    translatedText: str
    provider: str
    source: str
    cacheHit: bool
    translated: bool
    statusMessage: str | None = None


class TranslationResponse(BaseModel):
    requestId: str
    provider: str
    providerAvailable: bool
    fallbackUsed: bool
    items: list[TranslationItem]
    executedAt: datetime


class TranslationStatus(BaseModel):
    provider: str
    available: bool
    enabled: bool
    supportedSourceLocales: list[str]
    supportedTargetLocales: list[str]
    cacheEnabled: bool
    fallbackMessage: str | None = None


class TranslationPolicyRequest(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    cacheEnabled: bool | None = None

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()


class TranslationPolicyResponse(BaseModel):
    provider: str
    enabled: bool
    cacheEnabled: bool
    supportedSourceLocales: list[str]
    supportedTargetLocales: list[str]
