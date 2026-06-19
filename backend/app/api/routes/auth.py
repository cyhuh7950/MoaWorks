from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user
from app.schemas.auth import CurrentUserResponse, LoginRequest, LoginResponse
from app.schemas.directory import AuthUserSummary
from app.services.auth_service import AuthService
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    return AuthService(DirectoryStore(), TokenService()).login(payload)


@router.get("/me", response_model=CurrentUserResponse)
def get_me(user: AuthUserSummary = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(user=user)
