from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MessengerMessageListResponse,
    MessengerMessageSendRequest,
    MessengerMessageSendResponse,
    MessengerReadResponse,
    MessengerRoomCreateRequest,
    MessengerRoomDetailResponse,
    MessengerRoomListResponse,
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


@router.get("/rooms/{room_id}", response_model=MessengerRoomDetailResponse)
def get_room(room_id: str, user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerRoomDetailResponse:
    try:
        return _service().get_room(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/rooms/{room_id}/messages", response_model=MessengerMessageListResponse)
def list_messages(room_id: str, user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerMessageListResponse:
    try:
        return _service().list_messages(user, room_id)
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


@router.post("/rooms/{room_id}/read", response_model=MessengerReadResponse)
def mark_room_read(room_id: str, user: AuthUserSummary = Depends(permission_required("messenger:read"))) -> MessengerReadResponse:
    try:
        return _service().mark_room_read(user, room_id)
    except Exception as exc:
        _handle_error(exc)
        raise
