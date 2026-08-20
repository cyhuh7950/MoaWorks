from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MessengerMessageListResponse,
    MessengerMessageSendRequest,
    MessengerMessageSendResponse,
    MessengerAttachmentUploadResponse,
    MessengerReadResponse,
    MessengerRoomCreateRequest,
    MessengerRoomDetailResponse,
    MessengerRoomFavoriteRequest,
    MessengerRoomListResponse,
    MessengerRoomParticipantsRequest,
    MessengerRoomTranslationRequest,
    MessengerRoomDeleteResponse,
    MessengerRoomLeaveResponse,
    MessengerRoomOwnerTransferRequest,
)
from app.core.config import settings
from app.services.mail_messenger_service import MailMessengerService, MessengerConflictError
from app.services.messenger_attachment_storage import MessengerAttachmentTooLargeError
from app.services.resource_policy import ResourceNotFoundError, ResourceStateError


router = APIRouter()


def _service() -> MailMessengerService:
    return MailMessengerService()


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, ResourceNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "MESSENGER_NOT_FOUND", "userMessage": "대상을 찾을 수 없습니다.", "adminMessage": str(exc)},
        ) from exc
    if isinstance(exc, MessengerConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "MESSENGER_VERSION_CONFLICT", "userMessage": str(exc)}) from exc
    if isinstance(exc, MessengerAttachmentTooLargeError):
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail={"code": "MESSENGER_ATTACHMENT_TOO_LARGE", "userMessage": str(exc)}) from exc
    if isinstance(exc, ResourceStateError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "MESSENGER_STATE_INVALID", "userMessage": str(exc), "adminMessage": str(exc)},
        ) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "MESSENGER_FORBIDDEN",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "MESSENGER_REQUEST_INVALID",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    raise exc


@router.get("/rooms", response_model=MessengerRoomListResponse)
def list_rooms(user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerRoomListResponse:
    try:
        return _service().list_rooms(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/rooms", response_model=MessengerRoomDetailResponse)
def create_room(
    payload: MessengerRoomCreateRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDetailResponse:
    try:
        return _service().create_room(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/attachments", response_model=MessengerAttachmentUploadResponse)
async def upload_attachment(
    file: UploadFile = File(...),
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerAttachmentUploadResponse:
    try:
        content = await file.read(settings.mail_attachment_max_file_bytes + 1)
        return _service().stage_messenger_attachment(user, file.filename or "attachment.bin", file.content_type or "application/octet-stream", content)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/rooms/{room_id}", response_model=MessengerRoomDetailResponse)
def get_room(room_id: str, user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerRoomDetailResponse:
    try:
        return _service().get_room(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/rooms/{room_id}/favorite", response_model=MessengerRoomDetailResponse)
def update_room_favorite(
    room_id: str,
    payload: MessengerRoomFavoriteRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDetailResponse:
    try:
        return _service().update_room_favorite(user, room_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/rooms/{room_id}/translation", response_model=MessengerRoomDetailResponse)
def update_room_translation(
    room_id: str,
    payload: MessengerRoomTranslationRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDetailResponse:
    try:
        return _service().update_room_translation(user, room_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise

@router.patch("/rooms/{room_id}/participants", response_model=MessengerRoomDetailResponse)
def update_room_participants(
    room_id: str,
    payload: MessengerRoomParticipantsRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDetailResponse:
    try:
        return _service().update_room_participants(user, room_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/rooms/{room_id}/owner", response_model=MessengerRoomDetailResponse)
def transfer_room_owner(
    room_id: str,
    payload: MessengerRoomOwnerTransferRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDetailResponse:
    try:
        return _service().transfer_room_owner(user, room_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/rooms/{room_id}/leave", response_model=MessengerRoomLeaveResponse)
def leave_room(
    room_id: str,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomLeaveResponse:
    try:
        return _service().leave_room(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/rooms/{room_id}", response_model=MessengerRoomDeleteResponse)
def delete_room(
    room_id: str,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerRoomDeleteResponse:
    try:
        return _service().delete_room(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/rooms/{room_id}/messages", response_model=MessengerMessageListResponse)
def list_messages(
    room_id: str,
    limit: int = Query(default=100, ge=1, le=100),
    before: datetime | None = Query(default=None),
    user: AuthUserSummary = Depends(permission_required("messenger:read")),
) -> MessengerMessageListResponse:
    try:
        return _service().list_messages(user, room_id, limit=limit, before=before)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/rooms/{room_id}/messages", response_model=MessengerMessageSendResponse)
def send_message(
    room_id: str,
    payload: MessengerMessageSendRequest,
    user: AuthUserSummary = Depends(permission_required("messenger:write")),
) -> MessengerMessageSendResponse:
    try:
        return _service().send_message(user, room_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/rooms/{room_id}/messages/{message_id}/attachments/{attachment_id}")
def download_attachment(
    room_id: str,
    message_id: str,
    attachment_id: str,
    user: AuthUserSummary = Depends(permission_required("messenger:read")),
) -> FileResponse:
    try:
        item = _service().download_messenger_attachment(user, room_id, message_id, attachment_id)
        return FileResponse(path=item["path"], media_type=item["contentType"], filename=item["fileName"])
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/rooms/{room_id}/read", response_model=MessengerReadResponse)
def mark_room_read(room_id: str, user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerReadResponse:
    try:
        return _service().mark_room_read(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise
