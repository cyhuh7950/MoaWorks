from fastapi import Depends, Header, HTTPException, Query, status

from app.schemas.directory import AuthUserSummary
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


def _resolve_token(authorization: str | None = None, query_token: str | None = None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()
    if query_token:
        if query_token.startswith("Bearer "):
            return query_token.removeprefix("Bearer ").strip()
        return query_token.strip()
    return None


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
        return DirectoryStore().get_user_summary(user_id)
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


def get_current_user_with_query_token(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None, alias="token"),
) -> AuthUserSummary:
    raw_token = _resolve_token(authorization=authorization, query_token=token)
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_REQUIRED",
                "userMessage": "로그인이 필요합니다.",
                "adminMessage": "Authorization 헤더 및 token 파라미터가 모두 없음",
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
        return DirectoryStore().get_user_summary(user_id)
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
