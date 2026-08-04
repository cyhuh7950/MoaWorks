from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, require_admin
from app.schemas.translation import (
    TranslationPolicyRequest,
    TranslationPolicyResponse,
    TranslationRequest,
    TranslationResponse,
    TranslationStatus,
    TranslationReviewActionRequest,
    TranslationReviewItem,
    TranslationReviewListResponse,
)
from app.schemas.directory import AuthUserSummary
from app.services.translation_operations_store import TranslationOperationsStore
from app.services.translation_service import TranslationService


router = APIRouter(prefix="/translation", tags=["translation"])
admin_router = APIRouter(prefix="/translation", tags=["translation-admin"], dependencies=[Depends(require_admin)])


@router.post("/translate", response_model=TranslationResponse)
def translate(payload: TranslationRequest, user: AuthUserSummary = Depends(get_current_user)) -> TranslationResponse:
    service = TranslationService()
    return service.translate(payload, user)


@router.get("/status", response_model=TranslationStatus)
def translation_status() -> TranslationStatus:
    service = TranslationService()
    return service.get_status()


@admin_router.get("/admin/status", response_model=TranslationStatus)
def admin_translation_status(user: AuthUserSummary = Depends(require_admin)) -> TranslationStatus:
    return TranslationService().get_status(user)


@admin_router.get("/admin", response_model=TranslationPolicyResponse)
def translation_policy(user: AuthUserSummary = Depends(require_admin)) -> TranslationPolicyResponse:
    service = TranslationService()
    return TranslationPolicyResponse(**service.get_policy(user))


@admin_router.patch("/admin", response_model=TranslationPolicyResponse)
def update_translation_policy(payload: TranslationPolicyRequest, user: AuthUserSummary = Depends(require_admin)) -> TranslationPolicyResponse:
    service = TranslationService()
    return TranslationPolicyResponse(**service.update_policy(payload, user))


@admin_router.get("/reviews", response_model=TranslationReviewListResponse)
def list_translation_reviews(reviewStatus: str | None = None, user: AuthUserSummary = Depends(require_admin)) -> TranslationReviewListResponse:
    return TranslationReviewListResponse(**TranslationOperationsStore().list_reviews(user, review_status=reviewStatus))


@admin_router.post("/reviews/{review_id}/actions", response_model=TranslationReviewItem)
def apply_translation_review_action(review_id: str, payload: TranslationReviewActionRequest, user: AuthUserSummary = Depends(require_admin)) -> TranslationReviewItem:
    if payload.action == "retranslate":
        return TranslationReviewItem(**TranslationService().retranslate_review(user, review_id))
    return TranslationReviewItem(**TranslationOperationsStore().apply_review_action(user, review_id, payload))
