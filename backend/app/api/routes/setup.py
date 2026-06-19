from fastapi import APIRouter, HTTPException, status

from app.schemas.setup import (
    SetupInitializeRequest,
    SetupInitializeResponse,
    SetupValidateRequest,
    SetupValidateResponse,
)
from app.services.settings_store import SettingsStore
from app.services.setup_service import SetupService


router = APIRouter()


@router.post("/validate", response_model=SetupValidateResponse)
def validate_setup(payload: SetupValidateRequest) -> SetupValidateResponse:
    return SetupService(SettingsStore()).validate(payload)


@router.post("/initialize", response_model=SetupInitializeResponse)
def initialize_setup(payload: SetupInitializeRequest) -> SetupInitializeResponse:
    store = SettingsStore()
    if store.is_initialized():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 초기 설정이 완료되었습니다.",
        )
    return SetupService(store).initialize(payload)
