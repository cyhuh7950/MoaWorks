from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse


from app.api.dependencies import permission_required
from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailBulkRequest,
    MailBulkResponse,
    MailCategoryRequest,
    MailAttachmentUploadResponse,
    MailRecentRecipientListResponse,
    MailDetailResponse,
    MailDraftRequest,
    MailListQuery,
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
def list_inbox(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_inbox(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/sent", response_model=MailListResponse)
def list_sent(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_sent(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/drafts", response_model=MailListResponse)
def list_drafts(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_drafts(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/bulk", response_model=MailBulkResponse)
def bulk_mail(payload: MailBulkRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBulkResponse:
    try:
        return _service().bulk_mail(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/{mail_id}/category", response_model=MailStatusResponse)
def set_category(mail_id: str, payload: MailCategoryRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().set_mail_category(user, mail_id, payload)
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


@router.post("/attachments", response_model=MailAttachmentUploadResponse)
async def upload_attachment(
    file: UploadFile = File(...),
    user: AuthUserSummary = Depends(permission_required("mail:send")),
) -> MailAttachmentUploadResponse:
    try:
        content = await file.read(settings.mail_attachment_max_file_bytes + 1)
        return _service().stage_attachment(
            user,
            file.filename or "attachment.bin",
            file.content_type or "application/octet-stream",
            content,
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/recent-recipients", response_model=MailRecentRecipientListResponse)
def recent_recipients(
    limit: int = Query(default=20, ge=1, le=50),
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailRecentRecipientListResponse:
    try:
        return _service().list_recent_recipients(user, limit)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/{mail_id}/attachments/{attachment_id}")
def download_attachment(
    mail_id: str,
    attachment_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> FileResponse:
    try:
        item = _service().download_attachment(user, mail_id, attachment_id)
        return FileResponse(
            path=item["path"],
            media_type=item["contentType"],
            filename=item["fileName"],
        )
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
