from fastapi import APIRouter, HTTPException, status

from app.schemas.setup import (
    SetupInitializeRequest,
    SetupInitializeResponse,
    SetupValidateRequest,
    SetupValidateResponse,
)
from app.services.directory_store import DirectoryStore
from app.services.setup_service import SetupService


router = APIRouter()


@router.post("/validate", response_model=SetupValidateResponse)
def validate_setup(payload: SetupValidateRequest) -> SetupValidateResponse:
    return SetupService().validate(payload)


@router.post("/initialize", response_model=SetupInitializeResponse)
def initialize_setup(payload: SetupInitializeRequest) -> SetupInitializeResponse:
    if DirectoryStore().is_initialized():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 초기 설정이 완료되었습니다.",
        )
    return SetupService().initialize(payload)
