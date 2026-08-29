from fastapi import APIRouter, Depends, Response

from app.api.dependencies import get_current_user, get_optional_current_user
from app.schemas.auth import (
    AdminMfaEnrollmentCompleted,
    AdminMfaRecoveryEmailRequest,
    AdminMfaRecoveryEmailRequested,
    AdminMfaRecoveryEmailVerified,
    AdminMfaRecoveryEmailVerifyRequest,
    AdminMfaRecoveryRequest,
    AdminMfaRecoveryRequested,
    AdminMfaRecoveryVerifyRequest,
    AdminMfaReenrollRequired,
    AdminMfaStatusResponse,
    AdminMfaTotpConfirmRequest,
    AdminMfaTotpQrRequest,
    AdminMfaTotpStartRequest,
    AdminMfaTotpStartResponse,
    AdminMfaVerifyRequest,
    AuthLoginResponse,
    CurrentUserResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
)
from app.schemas.directory import AuthUserSummary
from app.services.auth_service import AuthService
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


router = APIRouter()


@router.post("/login", response_model=AuthLoginResponse)
def login(payload: LoginRequest) -> AuthLoginResponse:
    return AuthService(DirectoryStore(), TokenService()).login(payload)


@router.post("/admin/mfa/verify", response_model=LoginResponse)
def verify_admin_mfa(payload: AdminMfaVerifyRequest) -> LoginResponse:
    return AuthService(DirectoryStore(), TokenService()).verify_admin_mfa(payload)


@router.post("/admin/mfa/recovery/request", response_model=AdminMfaRecoveryRequested)
def request_admin_mfa_recovery(
    payload: AdminMfaRecoveryRequest,
) -> AdminMfaRecoveryRequested:
    return AuthService(DirectoryStore(), TokenService()).request_recovery(payload)


@router.post("/admin/mfa/recovery/verify", response_model=AdminMfaReenrollRequired)
def verify_admin_mfa_recovery(
    payload: AdminMfaRecoveryVerifyRequest,
) -> AdminMfaReenrollRequired:
    return AuthService(DirectoryStore(), TokenService()).verify_recovery(payload)


@router.get("/admin/mfa/status", response_model=AdminMfaStatusResponse)
def get_admin_mfa_status(
    actor: AuthUserSummary = Depends(get_current_user),
) -> AdminMfaStatusResponse:
    return AuthService(DirectoryStore(), TokenService()).get_mfa_status(actor)


@router.post(
    "/admin/mfa/recovery-email/request",
    response_model=AdminMfaRecoveryEmailRequested,
)
def request_admin_mfa_recovery_email(
    payload: AdminMfaRecoveryEmailRequest,
    actor: AuthUserSummary | None = Depends(get_optional_current_user),
) -> AdminMfaRecoveryEmailRequested:
    return AuthService(DirectoryStore(), TokenService()).request_recovery_email(actor, payload)


@router.post(
    "/admin/mfa/recovery-email/verify",
    response_model=AdminMfaRecoveryEmailVerified,
)
def verify_admin_mfa_recovery_email(
    payload: AdminMfaRecoveryEmailVerifyRequest,
    actor: AuthUserSummary | None = Depends(get_optional_current_user),
) -> AdminMfaRecoveryEmailVerified:
    return AuthService(DirectoryStore(), TokenService()).verify_recovery_email(actor, payload)


@router.post("/admin/mfa/totp/start", response_model=AdminMfaTotpStartResponse)
def start_admin_mfa_totp(
    payload: AdminMfaTotpStartRequest,
    actor: AuthUserSummary | None = Depends(get_optional_current_user),
) -> AdminMfaTotpStartResponse:
    return AuthService(DirectoryStore(), TokenService()).start_totp_enrollment(actor, payload)


@router.post("/admin/mfa/totp/qr")
def get_admin_mfa_totp_qr(payload: AdminMfaTotpQrRequest) -> Response:
    qr = AuthService(DirectoryStore(), TokenService()).get_totp_qr(payload)
    return Response(content=qr.pngBytes, media_type="image/png", headers=qr.headers)


@router.post("/admin/mfa/totp/confirm", response_model=AdminMfaEnrollmentCompleted)
def confirm_admin_mfa_totp(
    payload: AdminMfaTotpConfirmRequest,
) -> AdminMfaEnrollmentCompleted:
    return AuthService(DirectoryStore(), TokenService()).confirm_totp_enrollment(payload)


@router.get("/me", response_model=CurrentUserResponse)
def get_me(user: AuthUserSummary = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(user=user)


@router.post("/change-password", response_model=PasswordChangeResponse)
def change_password(payload: PasswordChangeRequest, user: AuthUserSummary = Depends(get_current_user)) -> PasswordChangeResponse:
    return AuthService(DirectoryStore(), TokenService()).change_password(user, payload)
