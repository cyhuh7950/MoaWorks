from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse


from app.api.dependencies import permission_required
from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailBulkRequest,
    MailBulkResponse,
    MailCategoryRequest,
    MailAttachmentUploadResponse,
    MailBasicPreferencesResponse,
    MailBasicPreferencesUpdateRequest,
    MailRecentRecipientListResponse,
    MailSignatureBulkDeleteRequest,
    MailSignatureCreateRequest,
    MailSignaturePreferencesResponse,
    MailSignaturePreferencesUpdateRequest,
    MailSignatureUpdateRequest,
    MailSignatureView,
    MailDetailResponse,
    MailDraftRequest,
    MailFolderCreateRequest,
    MailFolderListResponse,
    MailFolderUpdateRequest,
    MailFolderView,
    MailListQuery,
    MailListResponse,
    MailSendRequest,
    MailSendResponse,
    MailStorageResponse,
    MailStatusResponse,
    MailTagCreateRequest,
    MailTagListResponse,
    MailTagUpdateRequest,
    MailTagView,
)
from app.services.mail_messenger_service import MailMessengerService, MailPreferenceConflictError, MailSignatureConflictError


router = APIRouter()


def _service() -> MailMessengerService:
    return MailMessengerService()


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, (MailPreferenceConflictError, MailSignatureConflictError)):
        code = "MAIL_SIGNATURE_CONFLICT" if isinstance(exc, MailSignatureConflictError) else "MAIL_PREFERENCE_CONFLICT"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": code, "userMessage": str(exc), "adminMessage": str(exc)},
        ) from exc
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


@router.get("/preferences/basic", response_model=MailBasicPreferencesResponse)
def get_basic_preferences(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().get_basic_preferences(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/preferences/basic", response_model=MailBasicPreferencesResponse)
def update_basic_preferences(payload: MailBasicPreferencesUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().update_basic_preferences(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/preferences/basic/reset", response_model=MailBasicPreferencesResponse)
def reset_basic_preferences(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().reset_basic_preferences(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/signatures", response_model=MailSignaturePreferencesResponse)
def get_signatures(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().get_signatures(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/signatures", response_model=MailSignatureView, status_code=status.HTTP_201_CREATED)
def create_signature(payload: MailSignatureCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignatureView:
    try:
        return _service().create_signature(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/signatures/bulk-delete", response_model=MailSignaturePreferencesResponse)
def bulk_delete_signatures(payload: MailSignatureBulkDeleteRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().bulk_delete_signatures(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/signatures/preferences", response_model=MailSignaturePreferencesResponse)
def update_signature_preferences(payload: MailSignaturePreferencesUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().update_signature_preferences(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/signatures/{signature_id}", response_model=MailSignatureView)
def update_signature(signature_id: str, payload: MailSignatureUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignatureView:
    try:
        return _service().update_signature(user, signature_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/signatures/{signature_id}", response_model=MailSignaturePreferencesResponse)
def delete_signature(
    signature_id: str,
    expectedVersion: int = Query(ge=1),
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSignaturePreferencesResponse:
    try:
        return _service().delete_signature(user, signature_id, expectedVersion)
    except Exception as exc:
        _handle_error(exc)
        raise


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


@router.get("/folders", response_model=MailFolderListResponse)
def list_mail_folders(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderListResponse:
    try:
        return _service().list_mail_folders(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/folders", response_model=MailFolderView, status_code=status.HTTP_201_CREATED)
def create_mail_folder(payload: MailFolderCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderView:
    try:
        return _service().create_mail_folder(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/folders/{folder_id}", response_model=MailFolderView)
def update_mail_folder(folder_id: str, payload: MailFolderUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderView:
    try:
        return _service().update_mail_folder(user, folder_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mail_folder(folder_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _service().delete_mail_folder(user, folder_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/folders/{folder_id}/messages", response_model=MailListResponse)
def list_folder_messages(folder_id: str, query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_folder_messages(user, folder_id, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/tags", response_model=MailTagListResponse)
def list_mail_tags(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagListResponse:
    try:
        return _service().list_mail_tags(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/tags", response_model=MailTagView, status_code=status.HTTP_201_CREATED)
def create_mail_tag(payload: MailTagCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagView:
    try:
        return _service().create_mail_tag(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/tags/{tag_id}", response_model=MailTagView)
def update_mail_tag(tag_id: str, payload: MailTagUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagView:
    try:
        return _service().update_mail_tag(user, tag_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mail_tag(tag_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _service().delete_mail_tag(user, tag_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/tags/{tag_id}/messages", response_model=MailListResponse)
def list_tag_messages(tag_id: str, query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_tag_messages(user, tag_id, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/spam", response_model=MailListResponse)
def list_spam(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_spam(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/trash", response_model=MailListResponse)
def list_trash(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_trash(user, query)
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
def get_mail(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read")), view: str = Query(default="inbox")) -> MailDetailResponse:
    try:
        return _service().get_mail(user, mail_id, view)
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
