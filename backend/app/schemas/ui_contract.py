from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class UiContractBrand(BaseModel):
    primary: str = "#0f766e"
    secondary: str = "#111827"
    accent: str = "#9a6b2f"
    blocked: str = "#9f1239"

    @field_validator("primary", "secondary", "accent", "blocked")
    @classmethod
    def validate_color(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("color must not be empty")
        return cleaned


class UiContractMessages(BaseModel):
    error: str = "요청 처리 중 오류가 발생했습니다. 다시 시도해 주세요."
    warning: str = "설정값 검토가 필요합니다."
    blocked: str = "권한이 없거나 세션이 만료되었습니다."
    empty: str = "표시할 데이터가 없습니다."
    success: str = "설정이 저장되었습니다."
    sessionExpired: str = "다시 로그인 후 업무를 계속하세요."
    permissionDenied: str = "권한이 없어 현재 작업을 수행할 수 없습니다."


class UiContract(BaseModel):
    brand: UiContractBrand = Field(default_factory=UiContractBrand)
    menuOrder: list[str] = Field(default_factory=lambda: ["메일", "결재", "메신저", "일정", "주소록", "조직도", "파일", "설정"])
    homeCardOrder: list[str] = Field(default_factory=lambda: ["alerts", "approval", "chat", "mail"])
    quickComposeVisible: bool = True
    helpText: str = "Help / 정책 안내 / 설정 > 보관 정책"
    messages: UiContractMessages = Field(default_factory=UiContractMessages)

    @field_validator("menuOrder", "homeCardOrder")
    @classmethod
    def validate_order(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if not cleaned:
            raise ValueError("order list must not be empty")
        return cleaned

    @field_validator("helpText")
    @classmethod
    def validate_help_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("helpText must not be empty")
        return cleaned


class UiContractResponse(UiContract):
    source: str = "server"


class UiContractUpdateRequest(UiContract):
    pass
