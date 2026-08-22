from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.core.config import settings
from app.schemas.observability import (
    AlertStatus,
    EventEnvelope,
    MonitoringAlert,
    MonitoringAlertListResponse,
    MonitoringEvent,
    MonitoringEventListResponse,
    MonitoringOverview,
    MonitoringRule,
    MonitoringRuleUpdate,
    MonitoringCategory,
    NotificationEnvelope,
    NotificationListResponse,
    NotificationSummary,
    SeverityLevel,
    Visibility,
)
from app.services.postgres_service import PostgresService

logger = logging.getLogger(__name__)

_MAX_EVENTS = 500
_MAX_NOTIFICATIONS = 500
_DUP_WINDOW = timedelta(minutes=2)


def _now() -> datetime:
    return datetime.now(UTC)


class ObservabilityService:
    _state_lock = threading.RLock()

    def __init__(self, state_file: Path | None = None, db_service: PostgresService | None = None) -> None:
        self.state_file = state_file or settings.observability_state_file
        self.db = db_service or PostgresService()
        self._use_file_backend = state_file is not None
        self._state_cache: dict[str, Any] | None = None
        self._state_cache_mtime: float | None = None

    def emit_event(self, event: EventEnvelope) -> NotificationEnvelope:
        if not self._use_file_backend:
            return self._emit_event_db(event)
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state()
                state["events"] = [item for item in state["events"] if self._is_not_expired(item)]
                payload = event.model_dump(mode="json")
                notification = self._build_notification_record(event)
                merged = self._merge_duplicate_notification(state["notifications"], notification, _now())
                if not merged:
                    state["notifications"].append(notification)
                state["events"].append(payload)
                self._upsert_rules_and_alerts(state, event)
                self._enforce_limits(state)
                self._store_state(state)
                return self._inflate_notification(merged if merged else notification)

    def record_metrics(self, *, company_id: str, metrics: dict[str, float], source: str = "operations-monitor") -> None:
        event = EventEnvelope(
            eventId=f"evt_{uuid4().hex}",
            eventType="system.operational.metrics",
            category=MonitoringCategory.SYSTEM,
            severity=SeverityLevel.INFO,
            resourceType="operational_metrics",
            resourceId=company_id,
            requestId=f"req_{uuid4().hex}",
            dedupKey=f"system.operational.metrics:{company_id}",
            title="운영 지표 수집",
            message="운영 감시 지표를 수집했습니다.",
            source=source,
            companyId=company_id,
            targets=["admin"],
            visibility=Visibility.ADMIN,
            payload={"metrics": metrics},
        )
        if self._use_file_backend:
            with self._state_lock:
                with self._process_state_lock():
                    state = self._load_state()
                    state["events"].append(event.model_dump(mode="json"))
                    self._upsert_rules_and_alerts(state, event)
                    self._enforce_limits(state)
                    self._store_state(state)
            return
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._insert_monitoring_event_row(cursor, event.model_dump(mode="json"))
            connection.commit()
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state()
                self._upsert_rules_and_alerts(state, event)
                self._store_state(state)

    def list_notifications(
        self,
        user_id: str,
        include_admin: bool,
        unread_only: bool = False,
        severities: list[str] | None = None,
        category: str | None = None,
        cursor: str | None = None,
        limit: int = 30,
    ) -> NotificationListResponse:
        if not self._use_file_backend:
            return self._list_notifications_db(
                user_id=user_id,
                include_admin=include_admin,
                unread_only=unread_only,
                severities=severities,
                category=category,
                cursor=cursor,
                limit=limit,
            )
        state = self._load_state()
        cursor_time = datetime.fromisoformat(cursor) if cursor else None
        candidate_items = []
        for item in state["notifications"]:
            if not self._is_visible(item, user_id=user_id, include_admin=include_admin):
                continue
            if unread_only and item.get("status") != "unread":
                continue
            if category and item.get("category") != category:
                continue
            if severities and item.get("severity") not in severities:
                continue
            created_at = datetime.fromisoformat(item["createdAt"])
            if cursor_time is not None and created_at >= cursor_time:
                continue
            candidate_items.append(item)
        candidate_items.sort(key=lambda item: item["createdAt"], reverse=True)

        page = candidate_items[:limit]
        has_more = len(candidate_items) > len(page)
        next_cursor = page[-1]["createdAt"] if page else None
        return NotificationListResponse(
            notifications=[self._inflate_notification(item) for item in page],
            nextCursor=next_cursor,
            hasMore=has_more,
        )

    def get_notification(self, user_id: str, notification_id: str, include_admin: bool) -> NotificationEnvelope:
        if not self._use_file_backend:
            return self._get_notification_db(user_id=user_id, notification_id=notification_id, include_admin=include_admin)
        state = self._load_state()
        for item in state["notifications"]:
            if item["notificationId"] != notification_id:
                continue
            if not self._is_visible(item, user_id=user_id, include_admin=include_admin):
                raise PermissionError("해당 알림에 접근할 권한이 없습니다.")
            return self._inflate_notification(item)
        raise ValueError("대상 알림을 찾을 수 없습니다.")

    def ack_notification(self, notification_id: str, actor_user_id: str, include_admin: bool) -> NotificationEnvelope:
        if not self._use_file_backend:
            return self._ack_notification_db(
                notification_id=notification_id,
                actor_user_id=actor_user_id,
                include_admin=include_admin,
            )
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state()
                for item in state["notifications"]:
                    if item["notificationId"] != notification_id:
                        continue
                    if not self._is_visible(item, user_id=actor_user_id, include_admin=include_admin):
                        raise PermissionError("해당 알림을 읽음 처리할 권한이 없습니다.")
                    item["status"] = "read"
                    now = _now().isoformat()
                    item["readAt"] = now
                    item["acknowledgedAt"] = now
                    self._store_state(state)
                    return self._inflate_notification(item)
                raise ValueError("대상 알림을 찾을 수 없습니다.")

    def get_notification_summary(self, user_id: str, include_admin: bool) -> NotificationSummary:
        if not self._use_file_backend:
            return self._get_notification_summary_db(user_id=user_id, include_admin=include_admin)
        state = self._load_state()
        unread_count = 0
        latest_critical: datetime | None = None
        latest_warn: datetime | None = None
        severity_count = {item.value: 0 for item in SeverityLevel}

        for item in state["notifications"]:
            if not self._is_visible(item, user_id=user_id, include_admin=include_admin):
                continue
            severity_count[item["severity"]] = severity_count.get(item["severity"], 0) + 1
            if item.get("status") == "unread":
                unread_count += 1
            occurred_at = datetime.fromisoformat(item["occurredAt"])
            if item["severity"] == SeverityLevel.CRITICAL.value:
                latest_critical = occurred_at if latest_critical is None else max(latest_critical, occurred_at)
            if item["severity"] == SeverityLevel.WARN.value:
                latest_warn = occurred_at if latest_warn is None else max(latest_warn, occurred_at)

        return NotificationSummary(
            unreadCount=unread_count,
            severityCount=severity_count,
            latestCriticalAt=latest_critical,
            latestWarnAt=latest_warn,
        )

    def stream_notifications(self, user_id: str, include_admin: bool, limit: int = 20):
        items = self.list_notifications(user_id=user_id, include_admin=include_admin, limit=limit).notifications
        for item in items:
            yield f"event: notification\ndata: {item.model_dump_json()}\n\n"
        yield "event: heartbeat\ndata: {\"type\":\"heartbeat\"}\n\n"

    def list_monitoring_events(
        self,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
        severities: list[str] | None = None,
        category: str | None = None,
        resolved: bool | None = None,
    ) -> MonitoringEventListResponse:
        if not self._use_file_backend:
            return self._list_monitoring_events_db(
                from_dt=from_dt,
                to_dt=to_dt,
                severities=severities,
                category=category,
                resolved=resolved,
            )
        state = self._load_state()
        events: list[dict[str, Any]] = []
        for item in state["events"]:
            occurred_at = datetime.fromisoformat(item["occurredAt"])
            if from_dt and occurred_at < from_dt:
                continue
            if to_dt and occurred_at > to_dt:
                continue
            if severities and item.get("severity") not in severities:
                continue
            if category and item.get("category") != category:
                continue
            if resolved is not None and bool(item.get("resolved", False)) != resolved:
                continue
            events.append(item)
        events.sort(key=lambda item: item["occurredAt"], reverse=True)
        return MonitoringEventListResponse(
            events=[MonitoringEvent(**item) for item in events],
            total=len(events),
        )

    def get_monitoring_overview(self, user_is_admin: bool = True) -> MonitoringOverview:
        _ = user_is_admin
        state = self._load_state()
        now = _now()
        if self._use_file_backend:
            events = [item for item in state["events"] if self._is_not_expired(item)]
        else:
            events = self._fetch_events_for_window(window_seconds=72 * 60 * 60)
        mail_events_24h = [
            item
            for item in events
            if item.get("category") == MonitoringCategory.MAIL.value
            and datetime.fromisoformat(item["occurredAt"]) >= now - timedelta(hours=24)
        ]
        mail_failures_24h = [
            item
            for item in mail_events_24h
            if (
                str(item.get("eventType", "")).endswith("fail")
                or str(item.get("eventType", "")) == "mail.relay.fail"
            )
        ]
        mail_events_1h = [
            item
            for item in events
            if item.get("category") == MonitoringCategory.MAIL.value
            and datetime.fromisoformat(item["occurredAt"]) >= now - timedelta(hours=1)
            and (
                str(item.get("eventType", "")).endswith("fail")
                or str(item.get("eventType", "")) == "mail.relay.fail"
            )
        ]
        approval_backlog = (
            sum(
                1
                for item in events
                if item.get("category") == MonitoringCategory.APPROVAL.value
                and str(item.get("eventType", "")) in {"approval.status.changed", "approval.submit"}
            )
            if self._use_file_backend
            else self._count_submitted_approval_documents()
        )
        disk_status = next(
            (
                item.get("payload", {}).get("diskUsagePercent", 0.0)
                for item in sorted(events, key=lambda item: item["occurredAt"], reverse=True)
                if isinstance(item.get("payload"), dict) and "diskUsagePercent" in item["payload"]
            ),
            0.0,
        )
        alert_open = sum(1 for item in state["alerts"] if item.get("status") == AlertStatus.OPEN.value)
        return MonitoringOverview(
            mailFailureRate24h=(
                float(len(mail_failures_24h)) / float(len(mail_events_24h)) * 100.0
                if mail_events_24h
                else 0.0
            ),
            approvalBacklogCount=approval_backlog,
            relayFailureCount1h=len(mail_events_1h),
            diskUsagePercent=float(disk_status),
            alertOpenCount=alert_open,
        )

    def list_rules(self) -> list[MonitoringRule]:
        state = self._load_state()
        return [MonitoringRule(**item) for item in state["rules"]]

    def list_alerts(self) -> MonitoringAlertListResponse:
        state = self._load_state()
        alerts = sorted(state["alerts"], key=lambda item: item.get("detectedAt", ""), reverse=True)
        return MonitoringAlertListResponse(
            alerts=[self._inflate_alert(item) for item in alerts],
            total=len(alerts),
        )

    def update_rule(self, rule_id: str, payload: MonitoringRuleUpdate) -> MonitoringRule:
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state()
                updates = payload.model_dump(exclude_none=True, exclude_unset=True)
                if not updates:
                    return MonitoringRule(**next(item for item in state["rules"] if item["ruleId"] == rule_id))
                for item in state["rules"]:
                    if item["ruleId"] != rule_id:
                        continue
                    if "level" in updates and updates["level"] is not None:
                        item["level"] = str(updates["level"]) if isinstance(updates["level"], SeverityLevel) else str(updates["level"])
                    if "enabled" in updates:
                        item["enabled"] = bool(updates["enabled"])
                    for key in ("metric", "operator", "threshold", "windowSec", "targetAudience", "notifyChannels"):
                        if updates.get(key) is not None:
                            item[key] = updates[key]
                    item["updatedAt"] = _now().isoformat()
                    self._store_state(state)
                    return MonitoringRule(**item)
                raise ValueError("대상 규칙이 존재하지 않습니다.")

    def ack_alert(self, alert_id: str, actor=None) -> MonitoringAlert:
        alert = self._set_alert_status(alert_id, AlertStatus.ACKNOWLEDGED)
        self._audit_alert_transition(alert, actor, "monitoring.alert.acknowledged")
        return alert

    def resolve_alert(self, alert_id: str, actor=None) -> MonitoringAlert:
        alert = self._set_alert_status(alert_id, AlertStatus.RESOLVED)
        self._audit_alert_transition(alert, actor, "monitoring.alert.resolved")
        return alert

    def _audit_alert_transition(self, alert: MonitoringAlert, actor, event: str) -> None:
        if actor is None or self._use_file_backend:
            return
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                    status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,'monitoring_alert',%s,%s,NULL,%s,%s,%s)""",
                    (f"audit_{uuid4().hex}", actor.companyId, actor.userId, actor.userName, alert.alertId, event,
                     alert.status.value, "관리자 운영 경고 처리", _now()),
                )
            connection.commit()

    def _set_alert_status(self, alert_id: str, status: AlertStatus) -> MonitoringAlert:
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state()
                for item in state["alerts"]:
                    if item["alertId"] != alert_id:
                        continue
                    if item["status"] == status.value:
                        return self._inflate_alert(item)
                    item["status"] = status.value
                    now = _now().isoformat()
                    if status == AlertStatus.RESOLVED:
                        item["resolvedAt"] = now
                    else:
                        item["acknowledgedAt"] = now
                    self._store_state(state)
                    return self._inflate_alert(item)
                raise ValueError("대상 경고를 찾을 수 없습니다.")

    def _build_notification_record(self, event: EventEnvelope) -> dict[str, Any]:
        return {
            "schemaVersion": event.schemaVersion,
            "eventId": event.eventId,
            "notificationId": event.eventId,
            "eventType": event.eventType,
            "category": event.category.value,
            "severity": event.severity.value,
            "resourceType": event.resourceType,
            "resourceId": event.resourceId,
            "requestId": event.requestId,
            "dedupKey": event.dedupKey,
            "title": event.title,
            "message": event.message,
            "source": event.source,
            "companyId": event.companyId,
            "actorUserId": event.actorUserId,
            "occurrenceCount": 1,
            "occurredAt": event.occurredAt.isoformat(),
            "createdAt": event.createdAt.isoformat(),
            "ttlMinutes": event.ttlMinutes,
            "payload": event.payload,
            "status": "unread",
            "readAt": None,
            "acknowledgedAt": None,
            "archivedAt": None,
            "deliveryChannels": list(event.delivery.get("channels", ["inbox"])),
            "delivery": event.delivery,
            "links": event.links,
            "auditing": event.auditing,
            "visibility": event.visibility.value if isinstance(event.visibility, Visibility) else str(event.visibility),
            "recipientUserIds": list(event.targets or []),
            "targetAudience": event.targetAudience,
            "lastNotifiedAt": _now().isoformat(),
        }

    def _emit_event_db(self, event: EventEnvelope) -> NotificationEnvelope:
        self.db.ensure_migrations_applied()
        payload = event.model_dump(mode="json")
        payload["resolved"] = bool(payload.get("resolved", False))
        notification = self._build_notification_record(event)
        now = _now()

        with self._state_lock:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    merged = self._find_recent_notification_row(cursor, notification, now)
                    if merged is not None:
                        merged["occurrenceCount"] = int(merged.get("occurrenceCount", 1)) + 1
                        merged["payload"] = self._merge_payload(merged.get("payload", {}), notification.get("payload", {}))
                        merged["lastNotifiedAt"] = now.isoformat()
                        self._update_notification_row(cursor, merged)
                        stored_notification = merged
                    else:
                        self._insert_notification_row(cursor, notification)
                        stored_notification = notification
                    self._insert_monitoring_event_row(cursor, payload)
                connection.commit()

            with self._process_state_lock():
                state = self._load_state()
                self._upsert_rules_and_alerts(state, event)
                self._store_state(state)

        return self._inflate_notification(stored_notification)

    def _list_notifications_db(
        self,
        *,
        user_id: str,
        include_admin: bool,
        unread_only: bool,
        severities: list[str] | None,
        category: str | None,
        cursor: str | None,
        limit: int,
    ) -> NotificationListResponse:
        self.db.ensure_migrations_applied()
        rows = self._fetch_notification_rows(cursor=cursor, unread_only=unread_only, severities=severities, category=category)
        filtered: list[dict[str, Any]] = []
        for row in rows:
            record = self._notification_row_to_record(row)
            if not self._is_visible(record, user_id=user_id, include_admin=include_admin):
                continue
            filtered.append(record)
        page = filtered[:limit]
        has_more = len(filtered) > len(page)
        next_cursor = page[-1]["createdAt"] if page else None
        return NotificationListResponse(
            notifications=[self._inflate_notification(item) for item in page],
            nextCursor=next_cursor,
            hasMore=has_more,
        )

    def _get_notification_db(self, *, user_id: str, notification_id: str, include_admin: bool) -> NotificationEnvelope:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM notifications WHERE notification_id = %s", (notification_id,))
                row = cursor.fetchone()
        if row is None:
            raise ValueError("대상 알림을 찾을 수 없습니다.")
        record = self._notification_row_to_record(row)
        if not self._is_visible(record, user_id=user_id, include_admin=include_admin):
            raise PermissionError("해당 알림에 접근할 권한이 없습니다.")
        return self._inflate_notification(record)

    def _ack_notification_db(self, *, notification_id: str, actor_user_id: str, include_admin: bool) -> NotificationEnvelope:
        self.db.ensure_migrations_applied()
        with self._state_lock:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT * FROM notifications WHERE notification_id = %s", (notification_id,))
                    row = cursor.fetchone()
                    if row is None:
                        raise ValueError("대상 알림을 찾을 수 없습니다.")
                    record = self._notification_row_to_record(row)
                    if not self._is_visible(record, user_id=actor_user_id, include_admin=include_admin):
                        raise PermissionError("해당 알림을 읽음 처리할 권한이 없습니다.")
                    now = _now().isoformat()
                    record["status"] = "read"
                    record["readAt"] = now
                    record["acknowledgedAt"] = now
                    self._update_notification_row(cursor, record)
                connection.commit()
        return self._inflate_notification(record)

    def _get_notification_summary_db(self, *, user_id: str, include_admin: bool) -> NotificationSummary:
        result = self._list_notifications_db(
            user_id=user_id,
            include_admin=include_admin,
            unread_only=False,
            severities=None,
            category=None,
            cursor=None,
            limit=1000,
        )
        unread_count = 0
        latest_critical: datetime | None = None
        latest_warn: datetime | None = None
        severity_count = {item.value: 0 for item in SeverityLevel}
        for item in result.notifications:
            severity_count[item.severity.value] = severity_count.get(item.severity.value, 0) + 1
            if item.status == "unread":
                unread_count += 1
            occurred_at = item.occurredAt
            if item.severity == SeverityLevel.CRITICAL:
                latest_critical = occurred_at if latest_critical is None else max(latest_critical, occurred_at)
            if item.severity == SeverityLevel.WARN:
                latest_warn = occurred_at if latest_warn is None else max(latest_warn, occurred_at)
        return NotificationSummary(
            unreadCount=unread_count,
            severityCount=severity_count,
            latestCriticalAt=latest_critical,
            latestWarnAt=latest_warn,
        )

    def _list_monitoring_events_db(
        self,
        *,
        from_dt: datetime | None,
        to_dt: datetime | None,
        severities: list[str] | None,
        category: str | None,
        resolved: bool | None,
    ) -> MonitoringEventListResponse:
        self.db.ensure_migrations_applied()
        clauses: list[str] = []
        params: list[Any] = []
        if from_dt is not None:
            clauses.append("occurred_at >= %s")
            params.append(from_dt)
        if to_dt is not None:
            clauses.append("occurred_at <= %s")
            params.append(to_dt)
        if severities:
            clauses.append("severity = ANY(%s)")
            params.append(severities)
        if category:
            clauses.append("category = %s")
            params.append(category)
        if resolved is not None:
            clauses.append("resolved = %s")
            params.append(resolved)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        query = f"SELECT * FROM monitoring_events {where_sql} ORDER BY occurred_at DESC LIMIT 1000"
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
        events = [self._monitoring_event_from_row(row) for row in rows]
        return MonitoringEventListResponse(events=events, total=len(events))

    def _merge_duplicate_notification(
        self,
        notifications: list[dict[str, Any]],
        event_payload: dict[str, Any],
        now: datetime,
    ) -> dict[str, Any] | None:
        for item in notifications:
            if item.get("dedupKey") != event_payload["dedupKey"]:
                continue
            if item["resourceType"] != event_payload["resourceType"] or item["resourceId"] != event_payload["resourceId"]:
                continue
            try:
                last_notified = datetime.fromisoformat(item.get("lastNotifiedAt"))
            except Exception:
                last_notified = now
            if now - last_notified > _DUP_WINDOW:
                continue
            item["occurrenceCount"] = int(item.get("occurrenceCount", 1)) + 1
            item["payload"] = self._merge_payload(item.get("payload", {}), event_payload.get("payload", {}))
            item["lastNotifiedAt"] = now.isoformat()
            return item
        return None

    @staticmethod
    def _merge_payload(existing: dict[str, Any], latest: dict[str, Any]) -> dict[str, Any]:
        merged = dict(existing)
        if latest:
            merged["latestEventPayload"] = latest
            merged["lastMergedAt"] = _now().isoformat()
        return merged

    def _fetch_notification_rows(
        self,
        *,
        cursor: str | None,
        unread_only: bool,
        severities: list[str] | None,
        category: str | None,
        limit_scan: int = 1000,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if cursor:
            clauses.append("created_at < %s")
            params.append(datetime.fromisoformat(cursor))
        if unread_only:
            clauses.append("status = 'unread'")
        if severities:
            clauses.append("severity = ANY(%s)")
            params.append(severities)
        if category:
            clauses.append("category = %s")
            params.append(category)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        query = f"SELECT * FROM notifications {where_sql} ORDER BY created_at DESC LIMIT %s"
        params.append(limit_scan)
        with self.db.connect() as connection:
            with connection.cursor() as cursor_db:
                cursor_db.execute(query, params)
                return cursor_db.fetchall()

    def _find_recent_notification_row(self, cursor, notification: dict[str, Any], now: datetime) -> dict[str, Any] | None:
        cursor.execute(
            """
            SELECT *
            FROM notifications
            WHERE dedup_key = %s
              AND resource_type = %s
              AND resource_id = %s
            ORDER BY last_notified_at DESC
            LIMIT 1
            """,
            (notification["dedupKey"], notification["resourceType"], notification["resourceId"]),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        record = self._notification_row_to_record(row)
        last_notified = datetime.fromisoformat(record["lastNotifiedAt"])
        if now - last_notified > _DUP_WINDOW:
            return None
        return record

    def _insert_notification_row(self, cursor, record: dict[str, Any]) -> None:
        cursor.execute(
            """
            INSERT INTO notifications (
                notification_id, event_id, schema_version, event_type, category, severity,
                resource_type, resource_id, request_id, dedup_key, title, message, source,
                company_id, actor_user_id, occurrence_count, occurred_at, created_at, ttl_minutes,
                payload, status, read_at, acknowledged_at, archived_at, delivery_channels,
                delivery, links, auditing, visibility, recipient_user_ids, target_audience,
                last_notified_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s
            )
            """,
            self._notification_sql_values(record),
        )

    def _update_notification_row(self, cursor, record: dict[str, Any]) -> None:
        cursor.execute(
            """
            UPDATE notifications
            SET event_id = %s,
                schema_version = %s,
                event_type = %s,
                category = %s,
                severity = %s,
                resource_type = %s,
                resource_id = %s,
                request_id = %s,
                dedup_key = %s,
                title = %s,
                message = %s,
                source = %s,
                company_id = %s,
                actor_user_id = %s,
                occurrence_count = %s,
                occurred_at = %s,
                created_at = %s,
                ttl_minutes = %s,
                payload = %s,
                status = %s,
                read_at = %s,
                acknowledged_at = %s,
                archived_at = %s,
                delivery_channels = %s,
                delivery = %s,
                links = %s,
                auditing = %s,
                visibility = %s,
                recipient_user_ids = %s,
                target_audience = %s,
                last_notified_at = %s
            WHERE notification_id = %s
            """,
            self._notification_sql_values(record, include_primary_key=False) + [record["notificationId"]],
        )

    def _insert_monitoring_event_row(self, cursor, payload: dict[str, Any]) -> None:
        cursor.execute(
            """
            INSERT INTO monitoring_events (
                event_id, schema_version, event_type, category, severity, resource_type,
                resource_id, request_id, dedup_key, title, message, source, company_id,
                actor_user_id, occurrence_count, occurred_at, created_at, ttl_minutes,
                payload, resolved, visibility, targets, links, delivery, auditing, target_audience
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (event_id) DO NOTHING
            """,
            [
                payload["eventId"],
                payload["schemaVersion"],
                payload["eventType"],
                payload["category"],
                payload["severity"],
                payload["resourceType"],
                payload["resourceId"],
                payload["requestId"],
                payload["dedupKey"],
                payload["title"],
                payload["message"],
                payload.get("source", "backend"),
                payload["companyId"],
                payload.get("actorUserId"),
                payload.get("occurrenceCount", 1),
                payload["occurredAt"],
                payload["createdAt"],
                payload.get("ttlMinutes", 4320),
                Jsonb(payload.get("payload", {})),
                bool(payload.get("resolved", False)),
                payload.get("visibility", Visibility.BOTH.value),
                Jsonb(payload.get("targets", [])),
                Jsonb(payload.get("links", {})),
                Jsonb(payload.get("delivery", {})),
                Jsonb(payload.get("auditing", {})),
                payload.get("targetAudience", "both"),
            ],
        )

    def _notification_sql_values(self, record: dict[str, Any], include_primary_key: bool = True) -> list[Any]:
        values = [
            record["notificationId"],
            record["eventId"],
            record["schemaVersion"],
            record["eventType"],
            record["category"],
            record["severity"],
            record["resourceType"],
            record["resourceId"],
            record["requestId"],
            record["dedupKey"],
            record["title"],
            record["message"],
            record.get("source", "backend"),
            record["companyId"],
            record.get("actorUserId"),
            record.get("occurrenceCount", 1),
            datetime.fromisoformat(record["occurredAt"]),
            datetime.fromisoformat(record["createdAt"]),
            record.get("ttlMinutes", 4320),
            Jsonb(record.get("payload", {})),
            record.get("status", "unread"),
            datetime.fromisoformat(record["readAt"]) if record.get("readAt") else None,
            datetime.fromisoformat(record["acknowledgedAt"]) if record.get("acknowledgedAt") else None,
            datetime.fromisoformat(record["archivedAt"]) if record.get("archivedAt") else None,
            Jsonb(record.get("deliveryChannels", ["inbox"])),
            Jsonb(record.get("delivery", {})),
            Jsonb(record.get("links", {})),
            Jsonb(record.get("auditing", {})),
            record.get("visibility", Visibility.BOTH.value),
            Jsonb(record.get("recipientUserIds", [])),
            record.get("targetAudience", "both"),
            datetime.fromisoformat(record["lastNotifiedAt"]),
        ]
        if include_primary_key:
            return values
        return values[1:]

    def _notification_row_to_record(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "schemaVersion": row["schema_version"],
            "eventId": row["event_id"],
            "notificationId": row["notification_id"],
            "eventType": row["event_type"],
            "category": row["category"],
            "severity": row["severity"],
            "resourceType": row["resource_type"],
            "resourceId": row["resource_id"],
            "requestId": row["request_id"],
            "dedupKey": row["dedup_key"],
            "title": row["title"],
            "message": row["message"],
            "source": row["source"],
            "companyId": row["company_id"],
            "actorUserId": row["actor_user_id"],
            "occurrenceCount": row["occurrence_count"],
            "occurredAt": row["occurred_at"].isoformat(),
            "createdAt": row["created_at"].isoformat(),
            "ttlMinutes": row["ttl_minutes"],
            "payload": row.get("payload") or {},
            "status": row["status"],
            "readAt": row["read_at"].isoformat() if row.get("read_at") else None,
            "acknowledgedAt": row["acknowledged_at"].isoformat() if row.get("acknowledged_at") else None,
            "archivedAt": row["archived_at"].isoformat() if row.get("archived_at") else None,
            "deliveryChannels": row.get("delivery_channels") or ["inbox"],
            "delivery": row.get("delivery") or {},
            "links": row.get("links") or {},
            "auditing": row.get("auditing") or {},
            "visibility": row["visibility"],
            "recipientUserIds": row.get("recipient_user_ids") or [],
            "targetAudience": row.get("target_audience") or "both",
            "lastNotifiedAt": row["last_notified_at"].isoformat(),
        }

    def _monitoring_event_from_row(self, row: dict[str, Any]) -> MonitoringEvent:
        return MonitoringEvent(
            schemaVersion=row["schema_version"],
            eventId=row["event_id"],
            eventType=row["event_type"],
            category=row["category"],
            severity=row["severity"],
            resourceType=row["resource_type"],
            resourceId=row["resource_id"],
            requestId=row["request_id"],
            dedupKey=row["dedup_key"],
            title=row["title"],
            message=row["message"],
            source=row["source"],
            companyId=row["company_id"],
            actorUserId=row["actor_user_id"],
            occurrenceCount=row["occurrence_count"],
            occurredAt=row["occurred_at"],
            createdAt=row["created_at"],
            ttlMinutes=row["ttl_minutes"],
            payload=row.get("payload") or {},
            resolved=bool(row.get("resolved", False)),
        )

    def _fetch_events_for_window(self, *, window_seconds: int) -> list[dict[str, Any]]:
        self.db.ensure_migrations_applied()
        threshold = _now() - timedelta(seconds=window_seconds)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM monitoring_events WHERE occurred_at >= %s ORDER BY occurred_at DESC LIMIT 1000",
                    (threshold,),
                )
                rows = cursor.fetchall()
        return [
            {
                "eventType": row["event_type"],
                "category": row["category"],
                "severity": row["severity"],
                "resourceType": row["resource_type"],
                "resourceId": row["resource_id"],
                "occurredAt": row["occurred_at"].isoformat(),
                "payload": row.get("payload") or {},
                "resolved": bool(row.get("resolved", False)),
            }
            for row in rows
        ]

    def _count_submitted_approval_documents(self) -> int:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) AS count FROM approval_documents WHERE status = 'submitted'")
                row = cursor.fetchone()
        return int(row["count"] if row else 0)

    def _is_visible(self, item: dict[str, Any], user_id: str, include_admin: bool) -> bool:
        visibility = item.get("visibility", Visibility.BOTH.value)
        recipients = item.get("recipientUserIds") or []
        if visibility == Visibility.ADMIN.value:
            if not include_admin:
                return False
            return not recipients or user_id in recipients
        if visibility == Visibility.USER.value:
            return not recipients or user_id in recipients
        if not recipients:
            return True
        return user_id in recipients

    def _upsert_rules_and_alerts(self, state: dict[str, Any], event: EventEnvelope) -> None:
        recent_events = state["events"] if self._use_file_backend else self._fetch_events_for_window(window_seconds=72 * 60 * 60)
        for rule in state["rules"]:
            if not rule.get("enabled", True):
                continue
            if rule["ruleId"] == "rule_approval_stale_count_72h":
                self._upsert_alert_if_metric_exceeded(
                    state=state,
                    rule=rule,
                    metric="approval_stale_count_72h",
                    recent_events=recent_events,
                    event_predicate=lambda item: item.get("category") == MonitoringCategory.APPROVAL.value,
                )
            elif rule["ruleId"] == "rule_mail_relay_fail_count_1h":
                self._upsert_alert_if_metric_exceeded(
                    state=state,
                    rule=rule,
                    metric="mail_relay_fail_count_1h",
                    recent_events=recent_events,
                    event_predicate=lambda item: item.get("category") == MonitoringCategory.MAIL.value
                    and (
                        str(item.get("eventType", "")).endswith("fail")
                        or str(item.get("eventType", "")) == "mail.relay.fail"
                    ),
                )
            elif rule["ruleId"] == "rule_disk_usage_percent":
                self._upsert_alert_if_disk(state=state, rule=rule, event=event)
            else:
                self._upsert_alert_if_payload_metric(state=state, rule=rule, event=event)

    def _upsert_alert_if_payload_metric(self, state: dict[str, Any], rule: dict[str, Any], event: EventEnvelope) -> None:
        payload = event.payload if isinstance(event.payload, dict) else {}
        metrics = payload.get("metrics", {})
        if not isinstance(metrics, dict) or rule["metric"] not in metrics:
            return
        try:
            current_value = float(metrics[rule["metric"]])
            threshold = float(rule["threshold"])
        except (TypeError, ValueError):
            return
        if not self._operator_matches(current_value, threshold, str(rule.get("operator", "gte"))):
            return
        self._append_or_update_alert(
            state=state,
            rule=rule,
            metric=rule["metric"],
            current_value=current_value,
            threshold=threshold,
            event=event,
        )

    @staticmethod
    def _operator_matches(current: float, threshold: float, operator: str) -> bool:
        return {
            "gt": current > threshold,
            "gte": current >= threshold,
            "lt": current < threshold,
            "lte": current <= threshold,
            "eq": current == threshold,
            "neq": current != threshold,
        }.get(operator, False)

    def _upsert_alert_if_metric_exceeded(
        self,
        state: dict[str, Any],
        rule: dict[str, Any],
        metric: str,
        recent_events: list[dict[str, Any]],
        event_predicate,
    ) -> None:
        window = int(rule["windowSec"])
        threshold = float(rule["threshold"])
        now = _now()
        recent = [
            item
            for item in recent_events
            if datetime.fromisoformat(item["occurredAt"]) >= now - timedelta(seconds=window)
        ]
        current_value = float(sum(1 for item in recent if event_predicate(item)))
        if current_value <= threshold:
            return
        self._append_or_update_alert(
            state=state,
            rule=rule,
            metric=metric,
            current_value=current_value,
            threshold=threshold,
            event=None,
        )

    def _upsert_alert_if_disk(self, state: dict[str, Any], rule: dict[str, Any], event: EventEnvelope) -> None:
        payload = event.payload if isinstance(event.payload, dict) else {}
        raw = payload.get("diskUsagePercent")
        if raw is None:
            return
        try:
            current_value = float(raw)
        except (TypeError, ValueError):
            return
        if current_value < float(rule["threshold"]):
            return
        self._append_or_update_alert(
            state=state,
            rule=rule,
            metric="disk_usage_percent",
            current_value=current_value,
            threshold=float(rule["threshold"]),
            event=event,
        )

    def _append_or_update_alert(
        self,
        state: dict[str, Any],
        rule: dict[str, Any],
        metric: str,
        current_value: float,
        threshold: float,
        event: EventEnvelope | None,
    ) -> None:
        rule_id = rule["ruleId"]
        now = _now().isoformat()
        window = int(rule["windowSec"])
        level = str(rule.get("level", SeverityLevel.WARN.value))
        alert = next((item for item in state["alerts"] if item.get("ruleId") == rule_id and item.get("status") != AlertStatus.RESOLVED.value), None)
        payload = event.payload if event is not None and isinstance(event.payload, dict) else {}
        resource_type = event.resourceType if event else "system"
        resource_id = event.resourceId if event else "system_health"

        if alert:
            alert["currentValue"] = current_value
            alert["threshold"] = threshold
            alert["windowSec"] = window
            alert["severity"] = level
            alert["message"] = payload.get("message", alert.get("message", f"{rule_id} 임계치 초과"))
            alert["detectedAt"] = now
            return

        state["alerts"].append(
            MonitoringAlert(
                alertId=f"alert_{rule_id}_{uuid4().hex[:12]}",
                ruleId=rule_id,
                metric=metric,
                category=rule_metric_to_category(rule_id),
                severity=SeverityLevel(level) if level in {item.value for item in SeverityLevel} else SeverityLevel.ERROR,
                status=AlertStatus.OPEN,
                currentValue=current_value,
                threshold=threshold,
                windowSec=window,
                resourceType=resource_type,
                resourceId=resource_id,
                message=payload.get("message", f"감시 규칙 {rule_id} 임계치 초과"),
                requestId=(event.requestId if event else "system"),
                detectedAt=_now(),
            ).model_dump(mode="json")
        )

    @staticmethod
    def _is_not_expired(event: dict[str, Any]) -> bool:
        ttl = int(event.get("ttlMinutes", 0) or 0)
        return datetime.fromisoformat(event["occurredAt"]) + timedelta(minutes=ttl) >= _now()

    @staticmethod
    def _inflate_notification(item: dict[str, Any]) -> NotificationEnvelope:
        return NotificationEnvelope(
            schemaVersion=item["schemaVersion"],
            eventId=item["eventId"],
            eventType=item["eventType"],
            category=item["category"],
            severity=item["severity"],
            resourceType=item["resourceType"],
            resourceId=item["resourceId"],
            requestId=item["requestId"],
            dedupKey=item["dedupKey"],
            title=item["title"],
            message=item["message"],
            source=item.get("source", "backend"),
            companyId=item["companyId"],
            actorUserId=item.get("actorUserId"),
            occurrenceCount=item.get("occurrenceCount", 1),
            occurredAt=datetime.fromisoformat(item["occurredAt"]),
            createdAt=datetime.fromisoformat(item["createdAt"]),
            ttlMinutes=item["ttlMinutes"],
            payload=item["payload"],
            notificationId=item["notificationId"],
            recipientUserIds=item.get("recipientUserIds", []),
            visibility=item["visibility"],
            status=item["status"],
            readAt=datetime.fromisoformat(item["readAt"]) if item.get("readAt") else None,
            acknowledgedAt=datetime.fromisoformat(item["acknowledgedAt"]) if item.get("acknowledgedAt") else None,
            archivedAt=datetime.fromisoformat(item["archivedAt"]) if item.get("archivedAt") else None,
            deliveryChannels=item.get("deliveryChannels", ["inbox"]),
            links=item.get("links", {}),
            delivery=item.get("delivery", {}),
            auditing=item.get("auditing", {}),
        )

    @staticmethod
    def _inflate_alert(item: dict[str, Any]) -> MonitoringAlert:
        return MonitoringAlert(**item)

    def _load_state(self) -> dict[str, Any]:
        if not self.state_file.exists():
            state = self._default_state()
            self._store_state(state)
            self._state_cache = state
            self._state_cache_mtime = self.state_file.stat().st_mtime
            return state

        current_mtime = self.state_file.stat().st_mtime
        if self._state_cache is not None and self._state_cache_mtime == current_mtime:
            return self._state_cache

        try:
            raw = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("observability.state_read_failed", extra={"path": str(self.state_file), "error": str(exc)})
            raw = self._default_state()
            self._store_state(raw)
        if not isinstance(raw, dict):
            raw = self._default_state()
        raw.setdefault("notifications", [])
        raw.setdefault("events", [])
        raw.setdefault("alerts", [])
        raw.setdefault("rules", [])
        existing_rule_ids = {item.get("ruleId") for item in raw["rules"]}
        raw["rules"].extend(item for item in self._default_rules() if item["ruleId"] not in existing_rule_ids)
        raw["rules"] = self._ensure_unique_rule_ids(raw["rules"])
        self._state_cache = raw
        self._state_cache_mtime = self.state_file.stat().st_mtime
        return raw

    def _store_state(self, state: dict[str, Any]) -> None:
        self._ensure_parent()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=str(self.state_file.parent),
            prefix=".moaworks-observability-",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            json.dump(state, temp_file, ensure_ascii=False, indent=2, default=str)
            temp_path = Path(temp_file.name)
        temp_path.replace(self.state_file)
        self._state_cache = state
        self._state_cache_mtime = self.state_file.stat().st_mtime

    @staticmethod
    def _default_state() -> dict[str, Any]:
        return {
            "notifications": [],
            "events": [],
            "rules": ObservabilityService._default_rules(),
            "alerts": [],
        }

    @staticmethod
    def _default_rules() -> list[dict[str, Any]]:
        now = _now().isoformat()
        return [
            {
                "ruleId": "rule_approval_stale_count_72h",
                "metric": "approval_stale_count_72h",
                "operator": "gt",
                "threshold": 20,
                "windowSec": 72 * 60 * 60,
                "level": SeverityLevel.WARN.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_mail_relay_fail_count_1h",
                "metric": "mail_relay_fail_count_1h",
                "operator": "gt",
                "threshold": 10,
                "windowSec": 60 * 60,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_disk_usage_percent",
                "metric": "disk_usage_percent",
                "operator": "gt",
                "threshold": 85,
                "windowSec": 300,
                "level": SeverityLevel.WARN.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_mail_inbound_queue_depth",
                "metric": "mail_inbound_queue_depth",
                "operator": "gte",
                "threshold": 100,
                "windowSec": 300,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_disk_usage_warning_80",
                "metric": "disk_usage_percent",
                "operator": "gte",
                "threshold": 80,
                "windowSec": 300,
                "level": SeverityLevel.WARN.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_disk_usage_critical_90",
                "metric": "disk_usage_percent",
                "operator": "gte",
                "threshold": 90,
                "windowSec": 300,
                "level": SeverityLevel.CRITICAL.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_mail_outbound_queue_depth",
                "metric": "mail_outbound_queue_depth",
                "operator": "gte",
                "threshold": 100,
                "windowSec": 300,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_oci_delivery_failure_count",
                "metric": "oci_delivery_failure_count",
                "operator": "gte",
                "threshold": 1,
                "windowSec": 3600,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_database_unavailable",
                "metric": "database_unavailable",
                "operator": "gte",
                "threshold": 1,
                "windowSec": 60,
                "level": SeverityLevel.CRITICAL.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_api_error_rate_percent",
                "metric": "api_error_rate_percent",
                "operator": "gte",
                "threshold": 5,
                "windowSec": 300,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_security_anomaly_count",
                "metric": "security_anomaly_count",
                "operator": "gte",
                "threshold": 1,
                "windowSec": 300,
                "level": SeverityLevel.CRITICAL.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "ruleId": "rule_backup_age_hours",
                "metric": "backup_age_hours",
                "operator": "gte",
                "threshold": 26,
                "windowSec": 3600,
                "level": SeverityLevel.ERROR.value,
                "targetAudience": "admin",
                "notifyChannels": ["admin-dashboard"],
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            },
        ]

    def _enforce_limits(self, state: dict[str, Any], max_events: int = _MAX_EVENTS, max_notifications: int = _MAX_NOTIFICATIONS) -> None:
        state["events"] = sorted(state["events"], key=lambda item: item["occurredAt"], reverse=True)[:max_events]
        state["notifications"] = sorted(state["notifications"], key=lambda item: item["createdAt"], reverse=True)[:max_notifications]

    @staticmethod
    def _ensure_unique_rule_ids(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for item in rules:
            rule_id = item.get("ruleId")
            if not rule_id or rule_id in seen:
                continue
            seen.add(rule_id)
            deduped.append(item)
        return deduped

    @contextmanager
    def _process_state_lock(self):
        lock_path = self.state_file.with_suffix(".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "a+") as lock_file:
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0)
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                    yield
                finally:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _ensure_parent(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

def rule_metric_to_category(rule_id: str) -> MonitoringCategory:
    if "mail" in rule_id:
        return MonitoringCategory.MAIL
    if "approval" in rule_id:
        return MonitoringCategory.APPROVAL
    return MonitoringCategory.SYSTEM
