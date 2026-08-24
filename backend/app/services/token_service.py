from __future__ import annotations

from typing import Any
import json
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status

from app.schemas.directory import AuthUserSummary
from app.services.security_service import SecurityService


class TokenService:
    def __init__(self) -> None:
        self.security = SecurityService()

    def issue_access_token(self, user: AuthUserSummary, expires_in: int = 3600) -> str:
        payload = {
            "subject": user.userId,
            "sessionVersion": getattr(user, "authSessionVersion", 0),
            "exp": (datetime.now(UTC) + timedelta(seconds=expires_in)).isoformat(),
        }
        return self.security.encrypt_secret(json.dumps(payload, ensure_ascii=True))

    def decode_access_token(self, token: str) -> dict[str, Any]:
        try:
            raw = self.security.decrypt_secret(token)
            payload = json.loads(raw)
            expires_at = datetime.fromisoformat(payload["exp"])
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_TOKEN_INVALID",
                    "userMessage": "로그인 세션이 올바르지 않습니다.",
                    "adminMessage": f"토큰 해독 실패: {exc}",
                },
            ) from exc

        if expires_at <= datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_TOKEN_EXPIRED",
                    "userMessage": "로그인 세션이 만료되었습니다.",
                    "adminMessage": "만료된 access token 사용",
                },
            )

        return payload
