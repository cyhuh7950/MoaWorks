from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.schemas.notification_center import (
    NotificationBulkActionResponse,
    NotificationPreferences,
)
from app.schemas.observability import NotificationEnvelope, NotificationListResponse, NotificationSummary, SeverityLevel
from app.services.observability_service import ObservabilityService
from app.services.postgres_service import PostgresService

_DEFAULT_CATEGORIES = {
    "mail": {"enabled": True, "importantOnly": False},
    "approval": {"enabled": True, "importantOnly": False},
    "messenger": {"enabled": True, "importantOnly": False},
    "schedule": {"enabled": True, "importantOnly": False},
    "file": {"enabled": True, "importantOnly": False},
    "notice": {"enabled": True, "importantOnly": False},
    "system": {"enabled": True, "importantOnly": False},
}


def _now() -> datetime:
    return datetime.now(UTC)


class NotificationCenterService:
    def __init__(self, db_service: PostgresService | None = None) -> None:
        self.db = db_service or PostgresService()
        self.observability = ObservabilityService(db_service=self.db)

    def list_notifications(
        self,
        *,
        user_id: str,
        unread_only: bool = False,
        severities: list[str] | None = None,
        category: str | None = None,
        cursor: str | None = None,
        from_at: datetime | None = None,
        to_at: datetime | None = None,
        limit: int = 30,
    ) -> NotificationListResponse:
        self.db.ensure_migrations_applied()
        base = self.observability.list_notifications(
            user_id=user_id,
            include_admin=False,
            unread_only=False,
            severities=severities,
            category=category,
            cursor=cursor,
            limit=1000,
        )
        states = self._load_states(user_id, [item.notificationId for item in base.notifications])
        visible: list[NotificationEnvelope] = []
        for item in base.notifications:
            current = self._apply_state(item, states.get(item.notificationId))
            if current.status == "archived":
                continue
            if unread_only and current.status != "unread":
                continue
            if from_at is not None and current.occurredAt < from_at:
                continue
            if to_at is not None and current.occurredAt > to_at:
                continue
            visible.append(current)
        page = visible[:limit]
        return NotificationListResponse(
            notifications=page,
            nextCursor=page[-1].createdAt.isoformat() if page else None,
            hasMore=len(visible) > len(page),
        )

    def get_notification(self, *, user_id: str, notification_id: str) -> NotificationEnvelope:
        self.db.ensure_migrations_applied()
        item = self.observability.get_notification(user_id, notification_id, include_admin=False)
        state = self._load_states(user_id, [notification_id]).get(notification_id)
        current = self._apply_state(item, state)
        if current.status == "archived":
            raise ValueError("대상 알림을 찾을 수 없습니다.")
        return current

    def summary(self, *, user_id: str) -> NotificationSummary:
        items = self.list_notifications(user_id=user_id, limit=1000).notifications
        counts = {level.value: 0 for level in SeverityLevel}
        latest_critical = None
        latest_warn = None
        for item in items:
            counts[item.severity.value] = counts.get(item.severity.value, 0) + 1
            if item.severity == SeverityLevel.CRITICAL:
                latest_critical = item.occurredAt if latest_critical is None else max(latest_critical, item.occurredAt)
            if item.severity == SeverityLevel.WARN:
                latest_warn = item.occurredAt if latest_warn is None else max(latest_warn, item.occurredAt)
        return NotificationSummary(
            unreadCount=sum(1 for item in items if item.status == "unread"),
            severityCount=counts,
            latestCriticalAt=latest_critical,
            latestWarnAt=latest_warn,
        )

    def mark_read(self, *, user_id: str, notification_ids: list[str], reason: str = "user_ack") -> NotificationBulkActionResponse:
        items = self._validate_targets(user_id, notification_ids)
        states = self._load_states(user_id, [item.notificationId for item in items])
        changed = [item for item in items if states.get(item.notificationId, {}).get("status") != "read"]
        now = _now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                for item in changed:
                    cursor.execute(
                        """
                        INSERT INTO notification_user_states (
                            notification_id, user_id, status, read_at, archived_at, updated_at
                        ) VALUES (%s, %s, 'read', %s, NULL, %s)
                        ON CONFLICT (notification_id, user_id) DO UPDATE
                        SET status = 'read', read_at = EXCLUDED.read_at,
                            archived_at = NULL, updated_at = EXCLUDED.updated_at
                        """,
                        (item.notificationId, user_id, now, now),
                    )
                    self._insert_audit(cursor, user_id, item.notificationId, "notification.read", reason)
            connection.commit()
        updated = [
            item.model_copy(update={
                "status": "read",
                "readAt": states.get(item.notificationId, {}).get("read_at") or now,
                "acknowledgedAt": states.get(item.notificationId, {}).get("read_at") or now,
                "archivedAt": None,
            })
            for item in items
        ]
        return NotificationBulkActionResponse(updatedCount=len(changed), notifications=updated)

    def mark_all_read(
        self,
        *,
        user_id: str,
        severities: list[str] | None = None,
        category: str | None = None,
    ) -> NotificationBulkActionResponse:
        items = self.list_notifications(
            user_id=user_id,
            unread_only=True,
            severities=severities,
            category=category,
            limit=1000,
        ).notifications
        if not items:
            return NotificationBulkActionResponse(updatedCount=0, notifications=[])
        return self.mark_read(
            user_id=user_id,
            notification_ids=[item.notificationId for item in items],
            reason="user_read_all",
        )

    def archive(self, *, user_id: str, notification_ids: list[str]) -> NotificationBulkActionResponse:
        items = self._validate_targets(user_id, notification_ids, include_archived=True)
        states = self._load_states(user_id, [item.notificationId for item in items])
        changed = [item for item in items if states.get(item.notificationId, {}).get("status") != "archived"]
        now = _now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                for item in changed:
                    cursor.execute(
                        """
                        INSERT INTO notification_user_states (
                            notification_id, user_id, status, read_at, archived_at, updated_at
                        ) VALUES (%s, %s, 'archived', %s, %s, %s)
                        ON CONFLICT (notification_id, user_id) DO UPDATE
                        SET status = 'archived', read_at = COALESCE(notification_user_states.read_at, EXCLUDED.read_at),
                            archived_at = EXCLUDED.archived_at, updated_at = EXCLUDED.updated_at
                        """,
                        (item.notificationId, user_id, now, now, now),
                    )
                    self._insert_audit(cursor, user_id, item.notificationId, "notification.archived", "user_soft_delete")
            connection.commit()
        updated = [item.model_copy(update={
            "status": "archived",
            "readAt": states.get(item.notificationId, {}).get("read_at") or item.readAt or now,
            "archivedAt": states.get(item.notificationId, {}).get("archived_at") or now,
        }) for item in items]
        return NotificationBulkActionResponse(updatedCount=len(changed), notifications=updated)

    def get_preferences(self, *, user_id: str) -> NotificationPreferences:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM notification_preferences WHERE user_id = %s", (user_id,))
                row = cursor.fetchone()
        if row is None:
            return NotificationPreferences(categories=_DEFAULT_CATEGORIES)
        categories = dict(_DEFAULT_CATEGORIES)
        categories.update(row.get("categories") or {})
        return NotificationPreferences(
            enabled=row["enabled"],
            quietHoursEnabled=row["quiet_hours_enabled"],
            quietHoursStart=row["quiet_hours_start"],
            quietHoursEnd=row["quiet_hours_end"],
            categories=categories,
            updatedAt=row["updated_at"],
        )

    def save_preferences(self, *, user_id: str, preferences: NotificationPreferences) -> NotificationPreferences:
        self.db.ensure_migrations_applied()
        now = _now()
        editable_fields = {
            "enabled",
            "quietHoursEnabled",
            "quietHoursStart",
            "quietHoursEnd",
            "categories",
        }
        changed_fields = editable_fields.intersection(preferences.model_fields_set)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM notification_preferences WHERE user_id = %s FOR UPDATE", (user_id,))
                row = cursor.fetchone()
                if row is None:
                    current = NotificationPreferences(categories=_DEFAULT_CATEGORIES)
                else:
                    current_categories = dict(_DEFAULT_CATEGORIES)
                    current_categories.update(row.get("categories") or {})
                    current = NotificationPreferences(
                        enabled=row["enabled"],
                        quietHoursEnabled=row["quiet_hours_enabled"],
                        quietHoursStart=row["quiet_hours_start"],
                        quietHoursEnd=row["quiet_hours_end"],
                        categories=current_categories,
                        updatedAt=row["updated_at"],
                    )
                updates = {field: getattr(preferences, field) for field in changed_fields if field != "categories"}
                if "categories" in changed_fields:
                    merged_categories = dict(current.categories)
                    merged_categories.update(preferences.categories)
                    updates["categories"] = merged_categories
                saved = current.model_copy(update=updates)
                categories = {key: value.model_dump() for key, value in saved.categories.items()}
                cursor.execute(
                    """
                    INSERT INTO notification_preferences (
                        user_id, enabled, quiet_hours_enabled, quiet_hours_start,
                        quiet_hours_end, categories, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        enabled = EXCLUDED.enabled,
                        quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
                        quiet_hours_start = EXCLUDED.quiet_hours_start,
                        quiet_hours_end = EXCLUDED.quiet_hours_end,
                        categories = EXCLUDED.categories,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        user_id,
                        saved.enabled,
                        saved.quietHoursEnabled,
                        saved.quietHoursStart,
                        saved.quietHoursEnd,
                        Jsonb(categories),
                        now,
                    ),
                )
                self._insert_audit(
                    cursor,
                    user_id,
                    user_id,
                    "notification.preferences.updated",
                    "user_save",
                    {"changedFields": sorted(changed_fields), "categories": list(categories)},
                )
            connection.commit()
        return saved.model_copy(update={"updatedAt": now})

    def _validate_targets(self, user_id: str, notification_ids: list[str], *, include_archived: bool = False) -> list[NotificationEnvelope]:
        unique_ids = list(dict.fromkeys(notification_ids))
        if not include_archived:
            return [self.get_notification(user_id=user_id, notification_id=item_id) for item_id in unique_ids]
        items = [self.observability.get_notification(user_id, item_id, include_admin=False) for item_id in unique_ids]
        states = self._load_states(user_id, unique_ids)
        return [self._apply_state(item, states.get(item.notificationId)) for item in items]

    def _load_states(self, user_id: str, notification_ids: list[str]) -> dict[str, dict]:
        if not notification_ids:
            return {}
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM notification_user_states WHERE user_id = %s AND notification_id = ANY(%s)",
                    (user_id, notification_ids),
                )
                return {row["notification_id"]: row for row in cursor.fetchall()}

    @staticmethod
    def _apply_state(item: NotificationEnvelope, state: dict | None) -> NotificationEnvelope:
        if state is None:
            return item
        return item.model_copy(update={
            "status": state["status"],
            "readAt": state.get("read_at"),
            "acknowledgedAt": state.get("read_at"),
            "archivedAt": state.get("archived_at"),
        })

    @staticmethod
    def _insert_audit(cursor, actor_user_id: str, target_id: str, event_type: str, reason: str, payload: dict | None = None) -> None:
        cursor.execute(
            """
            INSERT INTO notification_action_audit (
                audit_id, actor_user_id, target_type, target_id,
                event_type, status, reason, payload, created_at
            ) VALUES (%s, %s, 'notification', %s, %s, 'success', %s, %s, %s)
            """,
            (f"na_{uuid4().hex}", actor_user_id, target_id, event_type, reason, Jsonb(payload or {}), _now()),
        )
