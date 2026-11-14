from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, require_admin, require_permission
from app.api.routes.auth import router as auth_router
from app.core.config import settings
from app.schemas.auth import LoginRequest
from app.schemas.directory import AuthUserSummary
from app.services.auth_service import AuthService
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


def _user(*, admin: bool) -> AuthUserSummary:
    return AuthUserSummary(
        userId="portal-test-user",
        companyId="portal-test-company",
        userName="Portal Test",
        userEmail="portal@moaworks.invalid",
        roleId="portal-test-role",
        roleName="관리자" if admin else "일반사용자",
        userType="admin" if admin else "employee",
        status="active",
        permissions=["admin:*", "approval:force"] if admin else ["mail:read"],
        authSessionVersion=3,
    )


def _store(user: AuthUserSummary) -> MagicMock:
    store = MagicMock(spec=DirectoryStore)
    store.get_login_domain.return_value = "moaworks.invalid"
    store.authenticate.return_value = user
    store.get_user_summary.return_value = user
    return store


def test_admin_can_sign_in_to_user_portal_without_mfa_but_cannot_use_admin_api() -> None:
    admin = _user(admin=True)
    store = _store(admin)
    token_service = TokenService()

    response = AuthService(store, token_service).login_user_portal(
        LoginRequest(email=admin.userEmail, password="password")
    )

    assert response.nextAction == "authenticated"
    assert response.user.userId == admin.userId
    assert "admin:*" not in response.user.permissions
    assert "mail:read" in response.user.permissions
    assert token_service.decode_access_token(response.accessToken)["portal"] == "user"

    with patch("app.api.dependencies.DirectoryStore", return_value=store), patch.object(
        settings, "admin_mfa_enforcement", "required"
    ):
        actor = get_current_user(f"Bearer {response.accessToken}")

    assert "mail:read" in actor.permissions
    assert require_permission("mail:read", actor) == actor
    with pytest.raises(HTTPException) as admin_denied:
        require_admin(actor)
    assert admin_denied.value.status_code == 403
    with pytest.raises(HTTPException) as force_denied:
        require_permission("approval:force", actor)
    assert force_denied.value.status_code == 403


def test_regular_user_keeps_own_permissions_on_user_portal() -> None:
    user = _user(admin=False)
    response = AuthService(_store(user), TokenService()).login_user_portal(
        LoginRequest(email=user.userEmail, password="password")
    )
    assert response.user.permissions == user.permissions


def test_pending_admin_cannot_bypass_inactive_account_through_user_portal() -> None:
    admin = _user(admin=True)
    store = _store(admin)
    store.authenticate.side_effect = PermissionError("계정이 비활성 상태입니다.")
    with pytest.raises(HTTPException) as denied:
        AuthService(store, TokenService()).login_user_portal(
            LoginRequest(email=admin.userEmail, password="password")
        )
    assert denied.value.status_code == 423


def test_user_portal_http_login_and_me_return_standard_user_view() -> None:
    admin = _user(admin=True)
    store = _store(admin)
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")

    with patch("app.api.routes.auth.DirectoryStore", return_value=store), patch(
        "app.api.dependencies.DirectoryStore", return_value=store
    ), patch.object(settings, "admin_mfa_enforcement", "required"):
        client = TestClient(app)
        login_response = client.post(
            "/auth/user/login", json={"email": admin.userEmail, "password": "password"}
        )
        assert login_response.status_code == 200
        body = login_response.json()
        assert body["nextAction"] == "authenticated"
        me_response = client.get(
            "/auth/me", headers={"Authorization": f"Bearer {body['accessToken']}"}
        )

    assert me_response.status_code == 200
    assert "mail:read" in me_response.json()["user"]["permissions"]
    assert "admin:*" not in me_response.json()["user"]["permissions"]


def test_password_change_required_session_cannot_open_business_api() -> None:
    user = _user(admin=False).model_copy(update={"mustChangePassword": True})
    store = _store(user)
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")

    @app.get("/business")
    def business(actor: AuthUserSummary = Depends(get_current_user)) -> dict:
        return {"userId": actor.userId}

    with patch("app.api.routes.auth.DirectoryStore", return_value=store), patch(
        "app.api.dependencies.DirectoryStore", return_value=store
    ):
        client = TestClient(app)
        login_response = client.post(
            "/auth/user/login", json={"email": user.userEmail, "password": "portal-test-user"}
        )
        token = login_response.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/auth/me", headers=headers).status_code == 200
        denied = client.get("/business", headers=headers)
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "AUTH_PASSWORD_CHANGE_REQUIRED"
