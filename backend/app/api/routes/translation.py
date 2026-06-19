from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, require_admin
from app.schemas.translation import (
    TranslationPolicyRequest,
    TranslationPolicyResponse,
    TranslationRequest,
    TranslationResponse,
    TranslationStatus,
)
from app.services.translation_service import TranslationService


router = APIRouter(prefix="/translation", tags=["translation"])
admin_router = APIRouter(prefix="/translation", tags=["translation-admin"], dependencies=[Depends(require_admin)])


@router.post("/translate", response_model=TranslationResponse)
def translate(payload: TranslationRequest, _: object = Depends(get_current_user)) -> TranslationResponse:
    service = TranslationService()
    return service.translate(payload)


@router.get("/status", response_model=TranslationStatus)
def translation_status() -> TranslationStatus:
    service = TranslationService()
    return service.get_status()


@admin_router.get("/admin", response_model=TranslationPolicyResponse)
def translation_policy() -> TranslationPolicyResponse:
    service = TranslationService()
    payload = service.get_policy()
    return TranslationPolicyResponse(
        provider=payload["provider"],  # type: ignore[index]
        enabled=payload["enabled"],  # type: ignore[index]
        cacheEnabled=payload["cacheEnabled"],  # type: ignore[index]
        supportedSourceLocales=payload["supportedSourceLocales"],  # type: ignore[index]
        supportedTargetLocales=payload["supportedTargetLocales"],  # type: ignore[index]
    )


@admin_router.patch("/admin", response_model=TranslationPolicyResponse)
def update_translation_policy(payload: TranslationPolicyRequest) -> TranslationPolicyResponse:
    service = TranslationService()
    updated = service.update_policy(payload)
    return TranslationPolicyResponse(
        provider=updated["provider"],  # type: ignore[index]
        enabled=updated["enabled"],  # type: ignore[index]
        cacheEnabled=updated["cacheEnabled"],  # type: ignore[index]
        supportedSourceLocales=updated["supportedSourceLocales"],  # type: ignore[index]
        supportedTargetLocales=updated["supportedTargetLocales"],  # type: ignore[index]
    )
