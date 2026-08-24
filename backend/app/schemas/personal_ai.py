from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator


PersonalAiProvider = Literal[
    "cerebras",
    "groq",
    "mistral",
    "openai",
    "upstage",
    "gemini",
    "openrouter",
    "anthropic",
    "ollama",
]
PersonalAiConnectionStatus = Literal["unconfigured", "untested", "ready", "error"]


class PersonalAiConfigUpdate(BaseModel):
    provider: PersonalAiProvider
    model: str = Field(min_length=1, max_length=200)
    apiKey: SecretStr | None = Field(default=None, min_length=1, max_length=1000)
    clearApiKey: bool = False

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_provider(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("model must not be empty")
        return normalized

    @model_validator(mode="after")
    def reject_conflicting_key_actions(self) -> "PersonalAiConfigUpdate":
        if self.apiKey is not None and self.clearApiKey:
            raise ValueError("apiKey and clearApiKey cannot be used together")
        return self


class PersonalAiConfigView(BaseModel):
    provider: str = ""
    model: str = ""
    apiKeyConfigured: bool = False
    connectionStatus: PersonalAiConnectionStatus = "unconfigured"
    lastTestCode: str | None = None
    lastTestedAt: datetime | None = None


class PersonalAiProviderOption(BaseModel):
    provider: str
    label: str
    apiKeyRequired: bool


class PersonalAiProviderListView(BaseModel):
    providers: list[PersonalAiProviderOption]


class PersonalAiConnectionTestView(BaseModel):
    success: bool
    provider: str
    model: str
    code: str
    message: str
    connectionStatus: PersonalAiConnectionStatus
    testedAt: datetime


class PersonalAiChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class PersonalAiChatRequest(BaseModel):
    messages: list[PersonalAiChatMessage] = Field(min_length=1, max_length=20)

    @field_validator("messages")
    @classmethod
    def validate_total_content_limit(
        cls, value: list[PersonalAiChatMessage]
    ) -> list[PersonalAiChatMessage]:
        if sum(len(message.content) for message in value) > 32000:
            raise ValueError("chat content exceeds the total limit")
        return value


class PersonalAiChatResponse(BaseModel):
    provider: str
    model: str
    message: PersonalAiChatMessage
    generatedAt: datetime
