from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailDetailResponse,
    MailDraftRequest,
    MailListResponse,
    MailSendRequest,
    MailSendResponse,
    MailStorageResponse,
    MailStatusResponse,
)
from app.services.mail_messenger_service import MailMessengerService


router = APIRouter()


def _service() -> MailMessengerService:
    return MailMessengerService()


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "MAIL_FORBIDDEN",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "MAIL_REQUEST_INVALID",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    raise exc


@router.get("/inbox", response_model=MailListResponse)
def list_inbox(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_inbox(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/sent", response_model=MailListResponse)
def list_sent(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_sent(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/drafts", response_model=MailListResponse)
def list_drafts(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_drafts(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/storage", response_model=MailStorageResponse)
def get_mail_storage(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStorageResponse:
    try:
        return _service().get_mail_storage(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/{mail_id}", response_model=MailDetailResponse)
def get_mail(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailDetailResponse:
    try:
        return _service().get_mail(user, mail_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/send", response_model=MailSendResponse)
def send_mail(payload: MailSendRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailSendResponse:
    try:
        return _service().send_mail(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/draft", response_model=MailSendResponse)
def save_draft(payload: MailDraftRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailSendResponse:
    try:
        return _service().save_draft(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/{mail_id}/read", response_model=MailStatusResponse)
def mark_read(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().mark_mail_read(user, mail_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/{mail_id}/star", response_model=MailStatusResponse)
def toggle_star(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().toggle_mail_star(user, mail_id)
    except Exception as exc:
        _handle_error(exc)
        raise
