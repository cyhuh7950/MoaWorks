from fastapi import Depends, Header, HTTPException, status

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


def _resolve_token(authorization: str | None = None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()
    return None


def _validate_admin_mfa_claims(
    payload: dict,
    user: AuthUserSummary,
    store: DirectoryStore,
) -> None:
    is_privileged = getattr(user, "userType", None) == "admin" or "admin:*" in user.permissions
    if settings.admin_mfa_enforcement != "required" or not is_privileged:
        return
    with store.db.connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT profile.profile_version,
                       profile.status AS profile_status,
                       policy.required_epoch
                FROM admin_mfa_policy AS policy
                LEFT JOIN admin_mfa_profiles AS profile
                  ON profile.user_id = %s
                WHERE policy.singleton = TRUE
                """,
                (user.userId,),
            )
            current = cursor.fetchone()
    valid = (
        current is not None
        and current["profile_status"] == "active"
        and payload.get("amr") == ["pwd", "otp"]
        and isinstance(payload.get("mfaProfileVersion"), int)
        and payload["mfaProfileVersion"] == current["profile_version"]
        and isinstance(payload.get("mfaPolicyEpoch"), int)
        and payload["mfaPolicyEpoch"] == current["required_epoch"]
    )
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_MFA_SESSION_STALE",
                "userMessage": "관리자 인증이 만료되었습니다. 다시 로그인하세요.",
                "adminMessage": "관리자 MFA claim 또는 현재 profile/policy version 불일치",
            },
        )


def get_current_user(authorization: str | None = Header(default=None)) -> AuthUserSummary:
    raw_token = _resolve_token(authorization=authorization)
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_REQUIRED",
                "userMessage": "로그인이 필요합니다.",
                "adminMessage": "Authorization Bearer 헤더 누락",
            },
        )
    payload = TokenService().decode_access_token(raw_token)
    user_id = payload.get("subject")
    if not isinstance(user_id, str):
        user_payload = payload.get("user")
        if isinstance(user_payload, dict):
            candidate = user_payload.get("userId")
            if isinstance(candidate, str):
                user_id = candidate

    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_TOKEN_INVALID",
                "userMessage": "로그인 세션이 올바르지 않습니다.",
                "adminMessage": "토큰에 사용자 식별자가 없습니다.",
            },
        )

    try:
        store = DirectoryStore()
        user = store.get_user_summary(user_id)
        token_version = payload.get("sessionVersion", 0)
        if not isinstance(token_version, int) or token_version != getattr(user, "authSessionVersion", 0):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_SESSION_REVOKED",
                    "userMessage": "세션이 종료되었습니다. 다시 로그인하세요.",
                    "adminMessage": "비밀번호 재설정으로 기존 세션이 폐기되었습니다.",
                },
            )
        _validate_admin_mfa_claims(payload, user, store)
        return user
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "AUTH_ACCESS_BLOCKED",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_TOKEN_INVALID",
                "userMessage": "로그인 세션이 올바르지 않습니다.",
                "adminMessage": str(exc),
            },
        ) from exc


def get_optional_current_user(
    authorization: str | None = Header(default=None),
) -> AuthUserSummary | None:
    if _resolve_token(authorization=authorization) is None:
        return None
    return get_current_user(authorization)


def require_admin(user: AuthUserSummary = Depends(get_current_user)) -> AuthUserSummary:
    if "admin:*" not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ADMIN_ONLY",
                "userMessage": "관리자 권한이 필요합니다.",
                "adminMessage": f"관리자 API 접근 거부: userId={user.userId}",
            },
        )
    return user


def require_permission(permission: str, user: AuthUserSummary = Depends(get_current_user)) -> AuthUserSummary:
    if "admin:*" in user.permissions or permission in user.permissions:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "FORBIDDEN",
            "userMessage": "요청한 기능을 수행할 권한이 없습니다.",
            "adminMessage": f"권한 누락: {permission}, userId={user.userId}",
        },
    )


def permission_required(permission: str):
    def dependency(user: AuthUserSummary = Depends(get_current_user)) -> AuthUserSummary:
        return require_permission(permission, user)

    return dependency
