from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_current_user, get_current_user_with_query_token
from app.schemas.directory import AuthUserSummary
from app.schemas.notification_center import (
    NotificationBulkActionRequest,
    NotificationBulkActionResponse,
    NotificationPreferences,
    NotificationReadAllRequest,
)
from app.schemas.observability import (
    EventEnvelope,
    NotificationEnvelope,
    NotificationListResponse,
    NotificationSummary,
)
from app.services.notification_center_service import NotificationCenterService
from app.services.observability_service import ObservabilityService

router = APIRouter()


def _raise_notification_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "NOTIFICATION_FORBIDDEN",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={
            "code": "NOTIFICATION_NOT_FOUND",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc
    raise exc


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unreadOnly: bool = Query(default=False),
    severity: list[str] | None = Query(default=None),
    category: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    fromAt: datetime | None = Query(default=None),
    toAt: datetime | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationListResponse:
    return NotificationCenterService().list_notifications(
        user_id=user.userId,
        unread_only=unreadOnly,
        severities=severity,
        category=category,
        cursor=cursor,
        from_at=fromAt,
        to_at=toAt,
        limit=limit,
    )


@router.get("/summary", response_model=NotificationSummary)
def get_summary(user: AuthUserSummary = Depends(get_current_user)) -> NotificationSummary:
    return NotificationCenterService().summary(user_id=user.userId)


@router.get("/preferences", response_model=NotificationPreferences)
def get_preferences(user: AuthUserSummary = Depends(get_current_user)) -> NotificationPreferences:
    return NotificationCenterService().get_preferences(user_id=user.userId)


@router.put("/preferences", response_model=NotificationPreferences)
def save_preferences(
    payload: NotificationPreferences,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationPreferences:
    return NotificationCenterService().save_preferences(user_id=user.userId, preferences=payload)


@router.post("/bulk/read", response_model=NotificationBulkActionResponse)
def bulk_read(
    payload: NotificationBulkActionRequest,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationBulkActionResponse:
    try:
        return NotificationCenterService().mark_read(user_id=user.userId, notification_ids=payload.notificationIds)
    except (PermissionError, ValueError) as exc:
        _raise_notification_error(exc)


@router.post("/read-all", response_model=NotificationBulkActionResponse)
def read_all(
    payload: NotificationReadAllRequest,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationBulkActionResponse:
    return NotificationCenterService().mark_all_read(
        user_id=user.userId,
        severities=payload.severities or None,
        category=payload.category,
    )


@router.post("/bulk/archive", response_model=NotificationBulkActionResponse)
def bulk_archive(
    payload: NotificationBulkActionRequest,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationBulkActionResponse:
    try:
        return NotificationCenterService().archive(user_id=user.userId, notification_ids=payload.notificationIds)
    except (PermissionError, ValueError) as exc:
        _raise_notification_error(exc)


@router.get("/stream")
def stream_notifications(
    user: AuthUserSummary = Depends(get_current_user_with_query_token),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
) -> StreamingResponse:
    def event_generator():
        try:
            state = NotificationCenterService().list_notifications(
                user_id=user.userId,
                cursor=cursor,
                limit=limit,
            ).notifications
            for item in state:
                yield f"event: notification\ndata: {item.model_dump_json()}\n\n"
            latest_cursor = state[0].notificationId if state else cursor
            if latest_cursor:
                yield f"event: streammeta\ndata: {{\"type\":\"cursor\",\"value\":\"{latest_cursor}\"}}\n\n"
            yield "event: heartbeat\ndata: {\"type\":\"heartbeat\"}\n\n"
        except Exception:
            yield "event: heartbeat\ndata: {\"type\":\"fallback\",\"reason\":\"polling\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{notification_id}", response_model=NotificationEnvelope)
def get_notification(
    notification_id: str,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationEnvelope:
    try:
        return NotificationCenterService().get_notification(user_id=user.userId, notification_id=notification_id)
    except (PermissionError, ValueError) as exc:
        _raise_notification_error(exc)


@router.post("/{notification_id}/ack", response_model=NotificationEnvelope)
def ack_notification(
    notification_id: str,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationEnvelope:
    try:
        result = NotificationCenterService().mark_read(user_id=user.userId, notification_ids=[notification_id])
        return result.notifications[0]
    except (PermissionError, ValueError) as exc:
        _raise_notification_error(exc)


def emit_internal_event(payload: EventEnvelope) -> dict[str, str]:
    ObservabilityService().emit_event(payload)
    return {"status": "accepted"}
