from __future__ import annotations

from datetime import datetime

from typing import Literal
from ipaddress import ip_address
from urllib.parse import urlparse

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator


class TranslationTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50000)
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
        if sum(len(item.text.encode("utf-8")) for item in value) > 128 * 1024:
            raise ValueError("요청 텍스트 전체 크기는 128KiB 이하로 제한됩니다.")
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
    detectedSourceLocale: str | None = None
    model: str = ""
    estimatedCost: float | None = None
    reviewId: str | None = None


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
    model: str | None = Field(default=None, max_length=200)
    apiBaseUrl: str | None = Field(default=None, max_length=500)
    apiKey: SecretStr | None = Field(default=None, min_length=1, max_length=1000)
    timeoutSeconds: int | None = Field(default=None, ge=1, le=120)
    maxRetries: int | None = Field(default=None, ge=0, le=5)
    rateLimitPerMinute: int | None = Field(default=None, ge=1, le=10000)
    circuitFailureThreshold: int | None = Field(default=None, ge=1, le=100)
    circuitRecoverySeconds: int | None = Field(default=None, ge=1, le=3600)
    costPerMillionUnits: float | None = Field(default=None, ge=0)
    costUnit: Literal["tokens", "characters"] | None = None

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()

    @field_validator("apiBaseUrl")
    @classmethod
    def validate_api_base_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return value
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("API Base URL은 사용자 정보가 없는 HTTPS 주소여야 합니다.")
        if parsed.hostname.lower() == "localhost":
            raise ValueError("내부 주소는 Provider URL로 사용할 수 없습니다.")
        try:
            address = ip_address(parsed.hostname)
        except ValueError:
            return normalized
        if not address.is_global:
            raise ValueError("공인 IP만 Provider URL로 사용할 수 있습니다.")
        return normalized


class TranslationPolicyResponse(BaseModel):
    provider: str
    enabled: bool
    cacheEnabled: bool
    supportedSourceLocales: list[str]
    supportedTargetLocales: list[str]
    model: str = ""
    apiBaseUrl: str = ""
    apiKeyConfigured: bool = False
    apiKeyMasked: str | None = None
    timeoutSeconds: int = 15
    maxRetries: int = 2
    rateLimitPerMinute: int = 60
    circuitFailureThreshold: int = 5
    circuitRecoverySeconds: int = 60
    costPerMillionUnits: float | None = None
    costUnit: Literal["tokens", "characters"] = "tokens"


class TranslationReviewActionRequest(BaseModel):
    action: Literal["edit", "approve", "retranslate"]
    translatedText: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_text_for_edit(self):
        if self.action == "edit" and not self.translatedText:
            raise ValueError("edit 작업에는 translatedText가 필요합니다.")
        return self


class TranslationReviewItem(BaseModel):
    id: str
    companyId: str
    sourceLocale: str
    targetLocale: str
    sourceText: str
    translatedText: str
    provider: str
    model: str
    status: str
    estimatedCost: float | None = None
    createdByUserId: str
    approvedByUserId: str | None = None
    approvedAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime


class TranslationReviewListResponse(BaseModel):
    items: list[TranslationReviewItem]
    total: int
