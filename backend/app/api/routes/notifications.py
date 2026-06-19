from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_current_user, get_current_user_with_query_token
from app.schemas.directory import AuthUserSummary
from app.schemas.observability import (
    EventEnvelope,
    MonitoringCategory,
    NotificationListResponse,
    NotificationEnvelope,
    NotificationSummary,
)
from app.services.observability_service import ObservabilityService

router = APIRouter()


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unreadOnly: bool = Query(default=False),
    severity: list[str] | None = Query(default=None),
    category: MonitoringCategory | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationListResponse:
    include_admin = "admin:*" in user.permissions
    return ObservabilityService().list_notifications(
        user_id=user.userId,
        include_admin=include_admin,
        unread_only=unreadOnly,
        severities=severity,
        category=category.value if category else None,
        cursor=cursor,
        limit=limit,
    )


@router.get("/summary", response_model=NotificationSummary)
def get_summary(user: AuthUserSummary = Depends(get_current_user)) -> NotificationSummary:
    include_admin = "admin:*" in user.permissions
    return ObservabilityService().get_notification_summary(user.userId, include_admin=include_admin)


@router.get("/stream")
def stream_notifications(
    user: AuthUserSummary = Depends(get_current_user_with_query_token),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
) -> StreamingResponse:
    include_admin = "admin:*" in user.permissions
    print(f"notification.stream.connect: userId={user.userId}, cursor={cursor}, limit={limit}")

    def event_generator() -> str:
        try:
            state = ObservabilityService().list_notifications(
                user_id=user.userId,
                include_admin=include_admin,
                unread_only=False,
                severities=None,
                category=None,
                cursor=cursor,
                limit=limit,
            ).notifications

            for item in state:
                yield f"event: notification\ndata: {item.model_dump_json()}\n\n"
            latest_cursor = state[0].notificationId if state else cursor
            if latest_cursor:
                yield f"event: streammeta\ndata: {{\"type\":\"cursor\",\"value\":\"{latest_cursor}\"}}\n\n"
            yield "event: heartbeat\ndata: {\"type\":\"heartbeat\"}\n\n"
        except Exception as exc:
            print(f"stream failed: {exc}")
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
    include_admin = "admin:*" in user.permissions
    try:
        return ObservabilityService().get_notification(user.userId, notification_id, include_admin=include_admin)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "NOTIFICATION_FORBIDDEN",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={
            "code": "NOTIFICATION_NOT_FOUND",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc


@router.post("/{notification_id}/ack", response_model=NotificationEnvelope)
def ack_notification(
    notification_id: str,
    user: AuthUserSummary = Depends(get_current_user),
) -> NotificationEnvelope:
    include_admin = "admin:*" in user.permissions
    try:
        return ObservabilityService().ack_notification(notification_id, user.userId, include_admin)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "NOTIFICATION_FORBIDDEN",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={
            "code": "NOTIFICATION_NOT_FOUND",
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }) from exc


def emit_internal_event(payload: EventEnvelope) -> dict[str, str]:
    ObservabilityService().emit_event(payload)
    return {"status": "accepted"}
