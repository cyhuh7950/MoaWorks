from fastapi import HTTPException, status

from app.schemas.auth import LoginRequest, LoginResponse
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


class AuthService:
    def __init__(self, store: DirectoryStore, token_service: TokenService) -> None:
        self.store = store
        self.token_service = token_service

    def login(self, payload: LoginRequest) -> LoginResponse:
        try:
            user = self.store.authenticate(payload.email, payload.password)
        except PermissionError as exc:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail={
                    "code": "AUTH_ACCOUNT_LOCKED",
                    "userMessage": str(exc),
                    "adminMessage": str(exc),
                },
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_LOGIN_FAILED",
                    "userMessage": str(exc),
                    "adminMessage": str(exc),
                },
            ) from exc

        expires_in = 3600
        token = self.token_service.issue_access_token(user, expires_in=expires_in)
        return LoginResponse(
            accessToken=token,
            tokenType="bearer",
            expiresIn=expires_in,
            user=user,
        )

