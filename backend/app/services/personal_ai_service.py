from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status

from app.schemas.directory import AuthUserSummary
from app.schemas.personal_ai import (
    PersonalAiChatRequest,
    PersonalAiChatResponse,
    PersonalAiConfigUpdate,
    PersonalAiConfigView,
    PersonalAiConnectionTestView,
    PersonalAiProviderListView,
)
from app.services.personal_ai_provider import (
    PersonalAiProviderClient,
    PersonalAiProviderError,
)
from app.services.personal_ai_store import PersonalAiStore
from app.services.translation_provider import PROVIDER_PROFILES


class PersonalAiService:
    def __init__(
        self,
        *,
        store: PersonalAiStore | None = None,
        provider_client: PersonalAiProviderClient | None = None,
    ) -> None:
        self.store = store or PersonalAiStore()
        self.provider_client = provider_client or PersonalAiProviderClient()

    def list_providers(self) -> PersonalAiProviderListView:
        return PersonalAiProviderListView(
            providers=[
                {
                    "provider": provider,
                    "label": str(profile["label"]),
                    "apiKeyRequired": bool(profile["apiKeyRequired"]),
                }
                for provider, profile in PROVIDER_PROFILES.items()
            ]
        )

    def get_config(self, actor: AuthUserSummary) -> PersonalAiConfigView:
        return PersonalAiConfigView(**self.store.get_config(actor))

    def update_config(
        self, actor: AuthUserSummary, payload: PersonalAiConfigUpdate
    ) -> PersonalAiConfigView:
        return PersonalAiConfigView(**self.store.save_config(actor, payload))

    def test_connection(
        self, actor: AuthUserSummary
    ) -> PersonalAiConnectionTestView:
        self.store.acquire_rate_limit(actor, "test", limit=5)
        config = self.store.get_config(actor, include_secret=True)
        self._require_configured(config)
        tested_at = datetime.now(UTC)
        try:
            self.provider_client.test_connection(config)
        except PersonalAiProviderError as exc:
            code = (
                "PERSONAL_AI_RESPONSE_INVALID"
                if exc.code == "PERSONAL_AI_RESPONSE_INVALID"
                else "PERSONAL_AI_CONNECTION_FAILED"
            )
            self.store.record_test(actor, False, code)
            return PersonalAiConnectionTestView(
                success=False,
                provider=str(config["provider"]),
                model=str(config["model"]),
                code=code,
                message="개인 AI Provider 연결에 실패했습니다.",
                connectionStatus="error",
                testedAt=tested_at,
            )
        except Exception:
            code = "PERSONAL_AI_CONNECTION_FAILED"
            self.store.record_test(actor, False, code)
            return PersonalAiConnectionTestView(
                success=False,
                provider=str(config["provider"]),
                model=str(config["model"]),
                code=code,
                message="개인 AI Provider 연결에 실패했습니다.",
                connectionStatus="error",
                testedAt=tested_at,
            )

        code = "PERSONAL_AI_CONNECTION_READY"
        self.store.record_test(actor, True, code)
        return PersonalAiConnectionTestView(
            success=True,
            provider=str(config["provider"]),
            model=str(config["model"]),
            code=code,
            message="개인 AI Provider 연결이 준비되었습니다.",
            connectionStatus="ready",
            testedAt=tested_at,
        )

    def chat(
        self, actor: AuthUserSummary, payload: PersonalAiChatRequest
    ) -> PersonalAiChatResponse:
        self.store.acquire_rate_limit(actor, "chat", limit=20)
        config = self.store.get_config(actor, include_secret=True)
        self._require_configured(config)
        if config.get("connectionStatus") != "ready":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "PERSONAL_AI_NOT_READY",
                    "userMessage": "먼저 개인 AI 연결 시험을 완료해 주세요.",
                    "adminMessage": "personal AI configuration is not ready",
                },
            )
        try:
            output = self.provider_client.chat(config, payload.messages)
        except PersonalAiProviderError as exc:
            code = (
                "PERSONAL_AI_RESPONSE_INVALID"
                if exc.code == "PERSONAL_AI_RESPONSE_INVALID"
                else "PERSONAL_AI_CHAT_FAILED"
            )
            raise self._chat_failure(code) from exc
        except Exception as exc:
            raise self._chat_failure("PERSONAL_AI_CHAT_FAILED") from exc

        return PersonalAiChatResponse(
            provider=str(config["provider"]),
            model=str(config["model"]),
            message={"role": "assistant", "content": output},
            generatedAt=datetime.now(UTC),
        )

    @staticmethod
    def _require_configured(config: dict[str, Any]) -> None:
        provider = str(config.get("provider") or "")
        profile = PROVIDER_PROFILES.get(provider)
        if profile is None:
            code = (
                "PERSONAL_AI_NOT_CONFIGURED"
                if not provider
                else "PERSONAL_AI_PROVIDER_INVALID"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": code,
                    "userMessage": "개인 AI Provider 설정을 확인해 주세요.",
                    "adminMessage": "personal AI provider configuration is invalid",
                },
            )
        if not str(config.get("model") or "") or (
            profile["apiKeyRequired"] and not str(config.get("apiKey") or "")
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "PERSONAL_AI_NOT_CONFIGURED",
                    "userMessage": "개인 AI Provider와 모델, API 키를 설정해 주세요.",
                    "adminMessage": "personal AI model or credential is missing",
                },
            )

    @staticmethod
    def _chat_failure(code: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": code,
                "userMessage": "개인 AI 응답을 생성하지 못했습니다.",
                "adminMessage": "personal AI provider request failed safely",
            },
        )
