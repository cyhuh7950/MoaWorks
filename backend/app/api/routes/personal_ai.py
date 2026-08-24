from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.personal_ai import (
    PersonalAiChatRequest,
    PersonalAiChatResponse,
    PersonalAiConfigUpdate,
    PersonalAiConfigView,
    PersonalAiConnectionTestView,
    PersonalAiProviderListView,
)
from app.services.personal_ai_service import PersonalAiService


router = APIRouter()


def _service() -> PersonalAiService:
    return PersonalAiService()


@router.get("/providers", response_model=PersonalAiProviderListView)
def list_personal_ai_providers(
    _user: AuthUserSummary = Depends(permission_required("profile:read")),
) -> PersonalAiProviderListView:
    return _service().list_providers()


@router.get("/config", response_model=PersonalAiConfigView)
def get_personal_ai_config(
    user: AuthUserSummary = Depends(permission_required("profile:read")),
) -> PersonalAiConfigView:
    return _service().get_config(user)


@router.put("/config", response_model=PersonalAiConfigView)
def update_personal_ai_config(
    payload: PersonalAiConfigUpdate,
    user: AuthUserSummary = Depends(permission_required("profile:read")),
) -> PersonalAiConfigView:
    return _service().update_config(user, payload)


@router.post("/test", response_model=PersonalAiConnectionTestView)
def test_personal_ai_connection(
    user: AuthUserSummary = Depends(permission_required("profile:read")),
) -> PersonalAiConnectionTestView:
    return _service().test_connection(user)


@router.post("/chat", response_model=PersonalAiChatResponse)
def personal_ai_chat(
    payload: PersonalAiChatRequest,
    user: AuthUserSummary = Depends(permission_required("profile:read")),
) -> PersonalAiChatResponse:
    return _service().chat(user, payload)
