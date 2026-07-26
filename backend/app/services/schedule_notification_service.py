from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.observability_service import ObservabilityService
from app.services.postgres_service import PostgresService


def notification_grace_window(interval_seconds: int) -> timedelta:
    return timedelta(seconds=min(max(interval_seconds * 3, 60), 300))


def processing_lease_window(interval_seconds: int) -> timedelta:
    return timedelta(seconds=max(interval_seconds * 10, 300))


def notification_due_in_window(due_at: datetime, now: datetime, grace: timedelta) -> bool:
    return now - grace < due_at <= now


def delivery_claim_retryable(status: str, updated_at: datetime, now: datetime, lease: timedelta) -> bool:
    return status == "failed" or (status == "processing" and updated_at <= now - lease)


def active_recipient_ids(company_id: str, owner_user_id: str, rows: list[dict]) -> list[str]:
    eligible = {row["id"] for row in rows if row.get("company_id") == company_id and row.get("status") == "active"}
    ordered = [owner_user_id, *(row["id"] for row in rows if row["id"] != owner_user_id)]
    return list(dict.fromkeys(user_id for user_id in ordered if user_id in eligible))


def _next_month(value: datetime, source_day: int) -> datetime:
    year = value.year + (1 if value.month == 12 else 0)
    month = 1 if value.month == 12 else value.month + 1
    day = min(source_day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def schedule_occurrences(
    starts_at: datetime,
    repeat_type: str,
    repeat_until: date | None,
    range_start: datetime,
    range_end: datetime,
    timezone: str = "UTC",
) -> list[datetime]:
    zone = ZoneInfo(timezone)
    start_local = starts_at.astimezone(zone)
    until = repeat_until or start_local.date()
    current = start_local
    source_day = start_local.day
    occurrences: list[datetime] = []
    while current.date() <= until:
        occurrence = current.astimezone(UTC)
        if occurrence >= range_end:
            break
        if occurrence >= range_start:
            occurrences.append(occurrence)
        if repeat_type == "none":
            break
        if repeat_type == "daily":
            current += timedelta(days=1)
        elif repeat_type == "weekly":
            current += timedelta(days=7)
        elif repeat_type == "monthly":
            current = _next_month(current, source_day)
        else:
            break
    return occurrences


class ScheduleNotificationService:
    def __init__(self, db_service: PostgresService | None = None, scheduler_interval_seconds: int | None = None) -> None:
        self.db = db_service or PostgresService()
        self.scheduler_interval_seconds = scheduler_interval_seconds or settings.schedule_notification_interval_seconds

    def dispatch_due_notifications(self, now: datetime | None = None, limit: int = 500) -> int:
        self.db.ensure_migrations_applied()
        current = (now or datetime.now(UTC)).astimezone(UTC)
        grace = notification_grace_window(self.scheduler_interval_seconds)
        range_start = current - grace
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.* FROM user_schedule_events s
                JOIN users owner ON owner.id = s.owner_user_id
                  AND owner.status = 'active' AND owner.company_id = s.company_id
                WHERE s.status = 'active' AND jsonb_array_length(s.alert_minutes) > 0
                  AND (s.repeat_type <> 'none' OR s.starts_at >= %s)
                ORDER BY s.starts_at
                """,
                (range_start,),
            )
            schedules = [dict(row) for row in cursor.fetchall()]
            schedule_ids = [item["id"] for item in schedules]
            recipients: dict[str, list[dict]] = {
                schedule["id"]: [{"id": schedule["owner_user_id"], "company_id": schedule["company_id"], "status": "active"}]
                for schedule in schedules
            }
            if schedule_ids:
                cursor.execute(
                    """
                    SELECT a.schedule_id, u.id, u.company_id, u.status
                    FROM user_schedule_attendees a
                    JOIN user_schedule_events s ON s.id = a.schedule_id
                    JOIN users u ON u.id = a.user_id
                      AND u.status = 'active' AND u.company_id = s.company_id
                    WHERE a.schedule_id = ANY(%s)
                    """,
                    (schedule_ids,),
                )
                for row in cursor.fetchall():
                    recipients[row["schedule_id"]].append(dict(row))

        sent = 0
        for schedule in schedules:
            alerts = [int(item) for item in (schedule.get("alert_minutes") or [])]
            range_end = current + timedelta(minutes=max(alerts, default=0) + 1)
            occurrences = schedule_occurrences(
                schedule["starts_at"], schedule["repeat_type"], schedule.get("repeat_until"),
                range_start, range_end, schedule.get("timezone") or "Asia/Seoul",
            )
            recipient_ids = active_recipient_ids(schedule["company_id"], schedule["owner_user_id"], recipients.get(schedule["id"], []))
            for occurrence in occurrences:
                for alert_minutes in alerts:
                    due_at = occurrence - timedelta(minutes=alert_minutes)
                    if not notification_due_in_window(due_at, current, grace):
                        continue
                    for recipient_user_id in recipient_ids:
                        if sent >= limit:
                            return sent
                        if self._deliver(schedule, occurrence, alert_minutes, recipient_user_id, current):
                            sent += 1
        return sent

    def _deliver(self, schedule: dict, occurrence: datetime, alert_minutes: int, recipient_user_id: str, now: datetime) -> bool:
        delivery_id = f"schdel_{uuid4().hex[:12]}"
        lease_deadline = now - processing_lease_window(self.scheduler_interval_seconds)
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO user_schedule_notification_deliveries (
                    id, schedule_id, company_id, occurrence_at, alert_minutes,
                    recipient_user_id, status, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,'processing',%s,%s)
                ON CONFLICT (schedule_id, occurrence_at, alert_minutes, recipient_user_id)
                DO UPDATE SET status='processing', last_error=NULL, updated_at=EXCLUDED.updated_at
                WHERE user_schedule_notification_deliveries.status = 'failed'
                   OR (user_schedule_notification_deliveries.status = 'processing'
                       AND user_schedule_notification_deliveries.updated_at <= %s)
                RETURNING id
                """,
                (delivery_id, schedule["id"], schedule["company_id"], occurrence, alert_minutes, recipient_user_id, now, now, lease_deadline),
            )
            claimed = cursor.fetchone()
            connection.commit()
        if not claimed:
            return False
        try:
            ObservabilityService(db_service=self.db).emit_event(
                EventEnvelope(
                    eventId=f"evt_{uuid4().hex}", eventType="schedule.reminder", category=MonitoringCategory.SCHEDULE,
                    severity=SeverityLevel.INFO, resourceType="schedule", resourceId=schedule["id"],
                    requestId=f"req_{uuid4().hex}",
                    dedupKey=f"schedule:{schedule['id']}:{occurrence.isoformat()}:{alert_minutes}:{recipient_user_id}",
                    title=schedule["title"], message=f"일정 시작 {alert_minutes}분 전입니다." if alert_minutes else "일정이 시작됩니다.",
                    companyId=schedule["company_id"], actorUserId=schedule["owner_user_id"],
                    targets=[recipient_user_id], visibility=Visibility.USER,
                    links={"menu": "schedule", "resourceId": schedule["id"]},
                    payload={"scheduleId": schedule["id"], "occurrenceAt": occurrence.isoformat(), "alertMinutes": alert_minutes},
                )
            )
        except Exception as exc:
            self._finish(claimed["id"], "failed", str(exc)[:500], now)
            return False
        self._finish(claimed["id"], "sent", None, now)
        return True

    def _finish(self, delivery_id: str, status: str, error: str | None, now: datetime) -> None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE user_schedule_notification_deliveries SET status=%s,last_error=%s,delivered_at=%s,updated_at=%s WHERE id=%s",
                (status, error, now if status == "sent" else None, now, delivery_id),
            )
            connection.commit()
