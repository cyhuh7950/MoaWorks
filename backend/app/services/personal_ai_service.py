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
    PersonalAiModelListRequest,
    PersonalAiModelListView,
    PersonalAiProviderListView,
)
from app.services.personal_ai_provider import (
    PersonalAiProviderClient,
    PersonalAiProviderError,
)
from app.services.personal_ai_store import PersonalAiStore
from app.services.translation_operations_store import TranslationOperationsStore
from app.services.translation_provider import PROVIDER_PROFILES, fetch_translation_models


class PersonalAiService:
    def __init__(
        self,
        *,
        store: PersonalAiStore | None = None,
        company_llm_store: TranslationOperationsStore | None = None,
        provider_client: PersonalAiProviderClient | None = None,
    ) -> None:
        self.store = store or PersonalAiStore()
        self.company_llm_store = company_llm_store or TranslationOperationsStore()
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
        return PersonalAiConfigView(**self._effective_config(actor))

    def update_config(
        self, actor: AuthUserSummary, payload: PersonalAiConfigUpdate
    ) -> PersonalAiConfigView:
        if not self._is_model_name(payload.model):
            # 고정 오류만 반환하여 잘못 입력한 자격증명이 응답에 되비치지 않게 한다.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "PERSONAL_AI_MODEL_INVALID",
                    "userMessage": "모델 칸에는 API 키가 아닌 모델 이름을 선택해 주세요.",
                    "adminMessage": "personal AI model name is invalid",
                },
            )
        self.store.save_config(actor, payload)
        return self.get_config(actor)

    def list_models(
        self, actor: AuthUserSummary, payload: PersonalAiModelListRequest
    ) -> PersonalAiModelListView:
        self.store.acquire_rate_limit(actor, "test", limit=5)
        draft_key = payload.apiKey.get_secret_value() if payload.apiKey else ""
        personal = self.store.get_config(actor, include_secret=True)
        company_default = self.company_llm_store.get_policy(
            actor.companyId, include_secret=True
        )
        api_key = draft_key
        api_base_url = str(PROVIDER_PROFILES[payload.provider]["apiBaseUrl"])
        timeout_seconds = 15
        if not api_key and personal.get("provider") == payload.provider:
            api_key = str(personal.get("apiKey") or "")
        if (
            not api_key
            and company_default.get("enabled")
            and company_default.get("provider") == payload.provider
        ):
            api_key = str(company_default.get("apiKey") or "")
            api_base_url = str(company_default.get("apiBaseUrl") or api_base_url)
            timeout_seconds = int(company_default.get("timeoutSeconds") or 15)
        try:
            models = fetch_translation_models(
                payload.provider,
                api_key=api_key,
                api_base_url=api_base_url,
                timeout_seconds=timeout_seconds,
            )
            return PersonalAiModelListView(
                success=True,
                provider=payload.provider,
                models=models,
                code="PERSONAL_AI_MODELS_OK",
                message=f"사용 가능한 모델 {len(models)}개를 불러왔습니다.",
                loadedAt=datetime.now(UTC),
            )
        except Exception:
            return PersonalAiModelListView(
                success=False,
                provider=payload.provider,
                models=[],
                code="PERSONAL_AI_MODELS_FAILED",
                message="모델 목록을 불러오지 못했습니다.",
                loadedAt=datetime.now(UTC),
            )

    def test_connection(
        self, actor: AuthUserSummary
    ) -> PersonalAiConnectionTestView:
        self.store.acquire_rate_limit(actor, "test", limit=5)
        config = self._effective_config(actor, include_secret=True)
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
            if config.get("configSource") == "personal":
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
            if config.get("configSource") == "personal":
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
        if config.get("configSource") == "personal":
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
        config = self._effective_config(actor, include_secret=True)
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

    def _effective_config(
        self, actor: AuthUserSummary, *, include_secret: bool = False
    ) -> dict[str, Any]:
        personal = self.store.get_config(actor, include_secret=include_secret)
        if self._is_configured(personal, include_secret=include_secret):
            return {**personal, "configSource": "personal"}

        company_default = self.company_llm_store.get_policy(
            actor.companyId, include_secret=include_secret
        )
        provider = str(company_default.get("provider") or "")
        model = str(company_default.get("model") or "")
        api_key = str(company_default.get("apiKey") or "") if include_secret else ""
        configured = bool(company_default.get("apiKeyConfigured"))
        if include_secret:
            configured = bool(api_key)
        valid = bool(
            company_default.get("enabled")
            and self._is_configured(company_default, include_secret=include_secret)
        )
        if not valid:
            empty = PersonalAiConfigView().model_dump()
            if include_secret:
                empty["apiKey"] = ""
            return empty
        result: dict[str, Any] = {
            "provider": provider,
            "model": model,
            "apiKeyConfigured": configured,
            "connectionStatus": "ready",
            "lastTestCode": None,
            "lastTestedAt": None,
            "configSource": "admin_default",
        }
        if include_secret:
            result.update(
                {
                    "apiKey": api_key,
                    "apiBaseUrl": str(company_default.get("apiBaseUrl") or ""),
                    "timeoutSeconds": int(company_default.get("timeoutSeconds") or 15),
                }
            )
        return result

    @staticmethod
    def _is_model_name(value: Any) -> bool:
        if not isinstance(value, str) or not value.strip():
            return False
        normalized = value.strip()
        # 알려진 자격증명 형식은 레거시 model 값에서도 화면과 Provider에 전달하지 않는다.
        if normalized.lower().startswith(("csk-", "sk-", "gsk_", "aiza", "bearer ")):
            return False
        # 접두사를 알 수 없는 긴 혼합 영숫자 토큰도 모델명보다 자격증명일 가능성이 높다.
        if (
            len(normalized) >= 32
            and normalized.isalnum()
            and any(character.islower() for character in normalized)
            and any(character.isupper() for character in normalized)
            and any(character.isdigit() for character in normalized)
        ):
            return False
        return True

    @classmethod
    def _is_configured(cls, config: dict[str, Any], *, include_secret: bool) -> bool:
        profile = PROVIDER_PROFILES.get(str(config.get("provider") or ""))
        if profile is None or not cls._is_model_name(config.get("model")):
            return False
        key_present = (
            bool(str(config.get("apiKey") or "").strip())
            if include_secret else bool(config.get("apiKeyConfigured"))
        )
        return not profile["apiKeyRequired"] or key_present

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
