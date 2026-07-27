from fastapi import HTTPException, status

from app.schemas.auth import LoginRequest, LoginResponse, PasswordChangeRequest, PasswordChangeResponse
from app.schemas.directory import AuthUserSummary
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

    def change_password(self, user: AuthUserSummary, payload: PasswordChangeRequest) -> PasswordChangeResponse:
        with self.store.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT password_hash,status FROM users WHERE id=%s AND company_id=%s FOR UPDATE",
                (user.userId, user.companyId),
            )
            account = cursor.fetchone()
            if account is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "AUTH_REQUIRED", "userMessage": "로그인이 필요합니다."})
            if account["status"] != "active":
                raise HTTPException(status_code=status.HTTP_423_LOCKED, detail={"code": "AUTH_ACCOUNT_LOCKED", "userMessage": "사용할 수 없는 계정입니다."})

            cursor.execute(
                "SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=%s AND event='auth.password.change_failed' AND created_at >= NOW() - INTERVAL '15 minutes'",
                (user.userId,),
            )
            if int(cursor.fetchone()["count"]) >= 5:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"code": "AUTH_PASSWORD_RATE_LIMITED", "userMessage": "비밀번호 확인 시도가 많습니다. 잠시 후 다시 시도하세요."})

            if not self.store.security.verify_password(payload.currentPassword, account["password_hash"]):
                self.store._insert_audit(
                    cursor=cursor, company_id=user.companyId, actor_user_id=user.userId, actor_user_name=user.userName,
                    target_type="user", target_id=user.userId, event="auth.password.change_failed",
                    status_before="active", status_after="active", reason="current_password_mismatch",
                )
                connection.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "AUTH_CURRENT_PASSWORD_INVALID", "userMessage": "현재 비밀번호가 올바르지 않습니다."})

            password_hash = self.store.security.hash_password(payload.newPassword)
            cursor.execute("UPDATE users SET password_hash=%s,updated_at=NOW() WHERE id=%s AND company_id=%s", (password_hash, user.userId, user.companyId))
            self.store._insert_audit(
                cursor=cursor, company_id=user.companyId, actor_user_id=user.userId, actor_user_name=user.userName,
                target_type="user", target_id=user.userId, event="auth.password.changed",
                status_before="active", status_after="active", reason="self_service",
            )
            connection.commit()
        return PasswordChangeResponse(message="비밀번호를 변경했습니다.", user=user)

