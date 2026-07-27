from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.schemas.directory import AuthUserSummary
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.schemas.workspace import CalendarCreatePayload, CalendarOrderPayload, CalendarSubscriptionPayload, CalendarUpdatePayload, ContactPayload, PreferencePayload, SchedulePayload
from app.services.calendar_rules import subscription_status_for_visibility, validate_order_snapshot
from app.services.observability_service import ObservabilityService
from app.services.postgres_service import PostgresService


class WorkspaceService:
    def __init__(self) -> None:
        self.db = PostgresService()
        self.db.ensure_migrations_applied()

    def _audit(self, cursor, user: AuthUserSummary, target_type: str, target_id: str, event: str, before: str | None, after: str | None, reason: str | None = None) -> None:
        cursor.execute(
            "INSERT INTO audit_logs (id, company_id, actor_user_id, actor_user_name, target_type, target_id, event, status_before, status_after, reason, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
            (f"log_{uuid4().hex[:12]}", user.companyId, user.userId, user.userName, target_type, target_id, event, before, after, reason),
        )

    def _notify_in_transaction(self, cursor, user: AuthUserSummary, recipient_user_id: str, event_type: str, resource_id: str, title: str, message: str) -> None:
        event = EventEnvelope(
            eventId=f"evt_{uuid4().hex}", eventType=event_type, category=MonitoringCategory.SCHEDULE,
            severity=SeverityLevel.INFO, resourceType="calendar", resourceId=resource_id,
            requestId=f"req_{uuid4().hex}", dedupKey=f"{event_type}:{resource_id}:{recipient_user_id}:{uuid4().hex}",
            title=title, message=message, companyId=user.companyId, actorUserId=user.userId,
            targets=[recipient_user_id], visibility=Visibility.USER,
            links={"menu": "schedule", "resourceId": resource_id}, payload={"calendarId": resource_id},
        )
        observability = ObservabilityService(db_service=self.db)
        notification = observability._build_notification_record(event)
        payload = event.model_dump(mode="json")
        payload["resolved"] = False
        observability._insert_notification_row(cursor, notification)
        observability._insert_monitoring_event_row(cursor, payload)

    @staticmethod
    def _missing() -> HTTPException:
        return HTTPException(status_code=404, detail={"code": "WORKSPACE_NOT_FOUND", "userMessage": "대상을 찾을 수 없습니다."})

    def directory(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT id, name, parent_id, department_code FROM departments WHERE company_id=%s AND status='active' ORDER BY name", (user.companyId,))
            departments = [dict(row) for row in cursor.fetchall()]
            cursor.execute("SELECT u.id, u.name, u.email, COALESCE(d.name, '') AS department_name, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN departments d ON d.id=u.department_id WHERE u.company_id=%s AND u.status='active' AND r.status='active' ORDER BY u.name", (user.companyId,))
            users = [dict(row) for row in cursor.fetchall()]
        return {"departments": departments, "users": users}

    @staticmethod
    def _calendar_record(row: dict) -> dict:
        return {
            "id": row["id"], "name": row["name"], "color": row["color"],
            "sortOrder": row["sort_order"], "isDefault": row["is_default"],
            "visibility": row["visibility"], "version": row["version"],
            "ownerUserId": row["owner_user_id"], "ownerUserName": row.get("owner_user_name", ""),
            "activeScheduleCount": row.get("active_schedule_count", 0),
        }

    def _calendar_rows(self, cursor, user: AuthUserSummary) -> list[dict]:
        cursor.execute(
            """
            SELECT c.id,c.name,c.color,c.sort_order,c.is_default,c.visibility,c.version,c.owner_user_id,
                   owner.name AS owner_user_name, COUNT(s.id) FILTER (WHERE s.status='active') AS active_schedule_count
            FROM user_calendars c JOIN users owner ON owner.id=c.owner_user_id
            LEFT JOIN user_schedule_events s ON s.calendar_id=c.id
            WHERE c.company_id=%s AND c.owner_user_id=%s AND c.status='active'
            GROUP BY c.id,owner.name ORDER BY c.sort_order,c.created_at
            """,
            (user.companyId, user.userId),
        )
        return [dict(row) for row in cursor.fetchall()]

    def list_calendars(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._ensure_default_calendar(cursor, user)
            owned_rows = self._calendar_rows(cursor, user)
            cursor.execute(
                """
                SELECT sub.id AS subscription_id,sub.status AS subscription_status,sub.version AS subscription_version,
                       c.id,c.name,c.color,c.sort_order,c.is_default,c.visibility,c.version,c.owner_user_id,
                       owner.name AS owner_user_name,COUNT(s.id) FILTER (WHERE s.status='active') AS active_schedule_count
                FROM user_calendar_subscriptions sub
                JOIN user_calendars c ON c.id=sub.calendar_id AND c.status='active' AND c.visibility<>'private'
                JOIN users owner ON owner.id=c.owner_user_id AND owner.status='active' AND owner.company_id=%s
                LEFT JOIN user_schedule_events s ON s.calendar_id=c.id
                WHERE sub.company_id=%s AND sub.subscriber_user_id=%s AND sub.status IN ('pending','active')
                GROUP BY sub.id,c.id,owner.name ORDER BY sub.updated_at DESC
                """,
                (user.companyId, user.companyId, user.userId),
            )
            subscriptions = [{"subscriptionId": row["subscription_id"], "status": row["subscription_status"], "version": row["subscription_version"], "calendar": self._calendar_record(dict(row))} for row in cursor.fetchall()]
            cursor.execute(
                """
                SELECT sub.id AS subscription_id,sub.status AS subscription_status,sub.version AS subscription_version,
                       c.id,c.name,c.color,c.sort_order,c.is_default,c.visibility,c.version,c.owner_user_id,
                       owner.name AS owner_user_name,subscriber.id AS subscriber_user_id,subscriber.name AS subscriber_user_name,
                       subscriber.email AS subscriber_email,COALESCE(d.name,'') AS subscriber_department,0 AS active_schedule_count
                FROM user_calendar_subscriptions sub
                JOIN user_calendars c ON c.id=sub.calendar_id AND c.owner_user_id=%s AND c.company_id=%s AND c.status='active'
                JOIN users owner ON owner.id=c.owner_user_id
                JOIN users subscriber ON subscriber.id=sub.subscriber_user_id AND subscriber.status='active' AND subscriber.company_id=c.company_id
                LEFT JOIN departments d ON d.id=subscriber.department_id
                WHERE sub.status IN ('pending','active') ORDER BY sub.requested_at DESC
                """,
                (user.userId, user.companyId),
            )
            incoming = [{"subscriptionId": row["subscription_id"], "status": row["subscription_status"], "version": row["subscription_version"], "calendar": self._calendar_record(dict(row)), "subscriber": {"userId": row["subscriber_user_id"], "name": row["subscriber_user_name"], "email": row["subscriber_email"], "department": row["subscriber_department"]}} for row in cursor.fetchall()]
            conn.commit()
        return {"owned": [self._calendar_record(row) for row in owned_rows], "subscriptions": subscriptions, "incomingRequests": incoming}

    def discover_calendars(self, user: AuthUserSummary, query: str) -> list[dict]:
        search = f"%{query.strip()}%"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT c.id,c.name,c.color,c.sort_order,c.is_default,c.visibility,c.version,c.owner_user_id,
                       owner.name AS owner_user_name,COUNT(s.id) FILTER (WHERE s.status='active') AS active_schedule_count
                FROM user_calendars c
                JOIN users owner ON owner.id=c.owner_user_id AND owner.status='active'
                JOIN roles r ON r.id=owner.role_id AND r.status='active'
                LEFT JOIN departments d ON d.id=owner.department_id
                LEFT JOIN user_schedule_events s ON s.calendar_id=c.id
                WHERE c.company_id=%s AND c.owner_user_id<>%s AND c.status='active' AND c.visibility IN ('public','approval_required')
                  AND (%s='' OR owner.name ILIKE %s OR owner.email ILIKE %s OR COALESCE(d.name,'') ILIKE %s OR c.name ILIKE %s)
                  AND NOT EXISTS (SELECT 1 FROM user_calendar_subscriptions sub WHERE sub.calendar_id=c.id AND sub.subscriber_user_id=%s AND sub.status IN ('pending','active'))
                GROUP BY c.id,owner.name ORDER BY owner.name,c.sort_order LIMIT 100
                """,
                (user.companyId, user.userId, query.strip(), search, search, search, search, user.userId),
            )
            return [self._calendar_record(dict(row)) for row in cursor.fetchall()]

    @staticmethod
    def _calendar_conflict(code: str, message: str) -> HTTPException:
        return HTTPException(status_code=409, detail={"code": code, "userMessage": message})

    def _lock_calendar_owner(self, cursor, user: AuthUserSummary) -> None:
        cursor.execute(
            "SELECT id FROM users WHERE id=%s AND company_id=%s AND status='active' FOR UPDATE",
            (user.userId, user.companyId),
        )
        if not cursor.fetchone():
            raise self._missing()

    def _ensure_default_calendar(self, cursor, user: AuthUserSummary) -> dict:
        self._lock_calendar_owner(cursor, user)
        cursor.execute(
            "SELECT * FROM user_calendars WHERE owner_user_id=%s AND status='active' AND is_default=TRUE ORDER BY created_at,id LIMIT 1",
            (user.userId,),
        )
        default = cursor.fetchone()
        if default:
            return dict(default)
        cursor.execute(
            "SELECT * FROM user_calendars WHERE company_id=%s AND owner_user_id=%s AND status='active' ORDER BY sort_order,created_at,id LIMIT 1 FOR UPDATE",
            (user.companyId, user.userId),
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE user_calendars SET is_default=TRUE,version=version+1,updated_at=NOW() WHERE id=%s RETURNING *",
                (existing["id"],),
            )
            return dict(cursor.fetchone())
        calendar_id = f"cal_{uuid4().hex[:20]}"
        cursor.execute(
            "INSERT INTO user_calendars (id,company_id,owner_user_id,name,color,sort_order,is_default,visibility,version,status,created_at,updated_at) VALUES(%s,%s,%s,'내 일정','#0f766e',0,TRUE,'private',0,'active',NOW(),NOW()) ON CONFLICT DO NOTHING RETURNING *",
            (calendar_id, user.companyId, user.userId),
        )
        created = cursor.fetchone()
        if created:
            return dict(created)
        cursor.execute(
            "SELECT * FROM user_calendars WHERE owner_user_id=%s AND status='active' AND is_default=TRUE",
            (user.userId,),
        )
        repaired = cursor.fetchone()
        if not repaired:
            raise self._calendar_conflict("CALENDAR_DEFAULT_CONFLICT", "기본 캘린더를 준비하지 못했습니다. 다시 시도하세요.")
        return dict(repaired)

    def _cancel_calendar_subscriptions(self, cursor, user: AuthUserSummary, calendar_id: str) -> None:
        cursor.execute(
            "SELECT id,subscriber_user_id,status FROM user_calendar_subscriptions WHERE calendar_id=%s AND company_id=%s AND status IN ('pending','active') ORDER BY id FOR UPDATE",
            (calendar_id, user.companyId),
        )
        subscriptions = [dict(row) for row in cursor.fetchall()]
        for subscription in subscriptions:
            cursor.execute(
                "UPDATE user_calendar_subscriptions SET status='cancelled',version=version+1,decided_at=NOW(),updated_at=NOW() WHERE id=%s",
                (subscription["id"],),
            )
            self._audit(cursor, user, "calendar_subscription", subscription["id"], "workspace.calendar.subscription.cancelled", subscription["status"], "cancelled")
            self._notify_in_transaction(cursor, user, subscription["subscriber_user_id"], "calendar.subscription.cancelled", calendar_id, "캘린더 공유 종료", "캘린더 소유자가 공유를 종료했습니다.")

    def create_calendar(self, user: AuthUserSummary, payload: CalendarCreatePayload) -> dict:
        item_id = f"cal_{uuid4().hex[:20]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_calendar_owner(cursor, user)
            cursor.execute("SELECT 1 FROM user_calendars WHERE owner_user_id=%s AND status='active' AND LOWER(name)=LOWER(%s)", (user.userId, payload.name))
            if cursor.fetchone(): raise self._calendar_conflict("CALENDAR_NAME_CONFLICT", "같은 이름의 캘린더가 이미 있습니다.")
            cursor.execute("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order,COALESCE(BOOL_OR(is_default),FALSE) AS has_default FROM user_calendars WHERE owner_user_id=%s AND status='active'", (user.userId,))
            aggregate = cursor.fetchone()
            is_default = not aggregate["has_default"]
            cursor.execute("INSERT INTO user_calendars (id,company_id,owner_user_id,name,color,sort_order,is_default,visibility,version,status,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,'private',0,'active',NOW(),NOW())", (item_id,user.companyId,user.userId,payload.name,payload.color,aggregate["next_order"],is_default))
            self._audit(cursor,user,"calendar",item_id,"workspace.calendar.created",None,"active")
            conn.commit()
        return next(item for item in self.list_calendars(user)["owned"] if item["id"] == item_id)

    def update_calendar(self, user: AuthUserSummary, calendar_id: str, payload: CalendarUpdatePayload) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_calendar_owner(cursor, user)
            cursor.execute("SELECT * FROM user_calendars WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active' FOR UPDATE", (calendar_id,user.companyId,user.userId))
            row = cursor.fetchone()
            if not row: raise self._missing()
            current = dict(row)
            if current["version"] != payload.expectedVersion: raise self._calendar_conflict("CALENDAR_VERSION_CONFLICT", "캘린더가 변경되었습니다. 목록을 새로고침하세요.")
            if payload.isDefault is False and current["is_default"]: raise self._calendar_conflict("CALENDAR_DEFAULT_REQUIRED", "기본 캘린더는 다른 캘린더를 기본으로 지정해 변경하세요.")
            name = payload.name if payload.name is not None else current["name"]
            color = payload.color if payload.color is not None else current["color"]
            visibility = payload.visibility if payload.visibility is not None else current["visibility"]
            is_default = payload.isDefault if payload.isDefault is not None else current["is_default"]
            cursor.execute("SELECT 1 FROM user_calendars WHERE owner_user_id=%s AND id<>%s AND status='active' AND LOWER(name)=LOWER(%s)", (user.userId,calendar_id,name))
            if cursor.fetchone(): raise self._calendar_conflict("CALENDAR_NAME_CONFLICT", "같은 이름의 캘린더가 이미 있습니다.")
            event = "workspace.calendar.updated"
            if payload.isDefault is True and not current["is_default"]:
                cursor.execute("UPDATE user_calendars SET is_default=FALSE,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND status='active' AND is_default=TRUE", (user.userId,))
                event = "workspace.calendar.default_changed"
            cursor.execute("UPDATE user_calendars SET name=%s,color=%s,visibility=%s,is_default=%s,version=version+1,updated_at=NOW() WHERE id=%s", (name,color,visibility,is_default,calendar_id))
            if visibility == "private":
                self._cancel_calendar_subscriptions(cursor, user, calendar_id)
            self._audit(cursor,user,"calendar",calendar_id,event,str(current["version"]),str(current["version"]+1))
            conn.commit()
        return next(item for item in self.list_calendars(user)["owned"] if item["id"] == calendar_id)

    def reorder_calendars(self, user: AuthUserSummary, payload: CalendarOrderPayload) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_calendar_owner(cursor, user)
            cursor.execute("SELECT id,version FROM user_calendars WHERE company_id=%s AND owner_user_id=%s AND status='active' ORDER BY sort_order FOR UPDATE", (user.companyId,user.userId))
            current = [dict(row) for row in cursor.fetchall()]
            requested = [item.model_dump() for item in payload.items]
            try: ordered_ids = validate_order_snapshot(current, requested)
            except ValueError as exc: raise self._calendar_conflict("CALENDAR_VERSION_CONFLICT", str(exc)) from exc
            for index, item_id in enumerate(ordered_ids):
                cursor.execute("UPDATE user_calendars SET sort_order=%s,version=version+1,updated_at=NOW() WHERE id=%s", (index,item_id))
            self._audit(cursor,user,"calendar_order",user.userId,"workspace.calendar.reordered",None,None,f"count={len(ordered_ids)}")
            conn.commit()
        return self.list_calendars(user)

    def delete_calendar(self, user: AuthUserSummary, calendar_id: str, expectedVersion: int) -> None:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_calendar_owner(cursor, user)
            cursor.execute("SELECT * FROM user_calendars WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active' FOR UPDATE", (calendar_id,user.companyId,user.userId))
            row = cursor.fetchone()
            if not row: raise self._missing()
            current = dict(row)
            if current["version"] != expectedVersion: raise self._calendar_conflict("CALENDAR_VERSION_CONFLICT", "캘린더가 변경되었습니다. 목록을 새로고침하세요.")
            if current["is_default"]: raise self._calendar_conflict("CALENDAR_DEFAULT_DELETE_FORBIDDEN", "기본 캘린더는 삭제할 수 없습니다.")
            cursor.execute("UPDATE user_calendars SET status='deleted',is_default=FALSE,version=version+1,updated_at=NOW() WHERE id=%s", (calendar_id,))
            cursor.execute("UPDATE user_schedule_events SET status='deleted',updated_at=NOW() WHERE calendar_id=%s AND status='active'", (calendar_id,))
            self._cancel_calendar_subscriptions(cursor, user, calendar_id)
            self._audit(cursor,user,"calendar",calendar_id,"workspace.calendar.deleted","active","deleted")
            conn.commit()

    def create_calendar_subscription(self, user: AuthUserSummary, payload: CalendarSubscriptionPayload) -> dict:
        subscription_id = f"csub_{uuid4().hex[:18]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("""SELECT c.*,owner.name AS owner_name FROM user_calendars c JOIN users owner ON owner.id=c.owner_user_id AND owner.status='active' WHERE c.id=%s AND c.company_id=%s AND c.owner_user_id<>%s AND c.status='active' AND c.visibility IN ('public','approval_required') FOR UPDATE""", (payload.calendarId,user.companyId,user.userId))
            target = cursor.fetchone()
            if not target: raise self._missing()
            target = dict(target)
            status = subscription_status_for_visibility(target["visibility"])
            cursor.execute("SELECT * FROM user_calendar_subscriptions WHERE calendar_id=%s AND subscriber_user_id=%s FOR UPDATE", (payload.calendarId,user.userId))
            existing = cursor.fetchone()
            if existing and existing["status"] in {"pending","active"}: raise self._calendar_conflict("CALENDAR_SUBSCRIPTION_CONFLICT", "이미 신청하거나 등록한 캘린더입니다.")
            if existing:
                subscription_id = existing["id"]
                cursor.execute("UPDATE user_calendar_subscriptions SET status=%s,version=version+1,requested_at=NOW(),decided_at=NULL,updated_at=NOW() WHERE id=%s", (status,subscription_id))
            else:
                cursor.execute("INSERT INTO user_calendar_subscriptions (id,company_id,calendar_id,subscriber_user_id,status,version,requested_at,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,0,NOW(),NOW(),NOW())", (subscription_id,user.companyId,payload.calendarId,user.userId,status))
            self._audit(cursor,user,"calendar_subscription",subscription_id,"workspace.calendar.subscription.requested",None,status)
            self._notify_in_transaction(cursor,user,target["owner_user_id"],"calendar.subscription.requested",payload.calendarId,"캘린더 공유 요청","동료가 캘린더 공유를 요청했습니다.")
            conn.commit()
        return next(item for item in self.list_calendars(user)["subscriptions"] if item["subscriptionId"] == subscription_id)

    def decide_calendar_subscription(self, user: AuthUserSummary, subscription_id: str, decision: str) -> dict:
        next_status = "active" if decision == "accepted" else "rejected"
        event = "workspace.calendar.subscription.accepted" if decision == "accepted" else "workspace.calendar.subscription.rejected"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("""SELECT sub.*,c.owner_user_id,c.company_id AS calendar_company_id FROM user_calendar_subscriptions sub JOIN user_calendars c ON c.id=sub.calendar_id AND c.status='active' WHERE sub.id=%s AND c.company_id=%s AND c.owner_user_id=%s FOR UPDATE""", (subscription_id,user.companyId,user.userId))
            row = cursor.fetchone()
            if not row: raise self._missing()
            current = dict(row)
            if current["status"] != "pending": raise self._calendar_conflict("CALENDAR_SUBSCRIPTION_STATE_CONFLICT", "대기 중인 신청만 처리할 수 있습니다.")
            cursor.execute("UPDATE user_calendar_subscriptions SET status=%s,version=version+1,decided_at=NOW(),updated_at=NOW() WHERE id=%s", (next_status,subscription_id))
            self._audit(cursor,user,"calendar_subscription",subscription_id,event,"pending",next_status)
            self._notify_in_transaction(cursor,user,current["subscriber_user_id"],f"calendar.subscription.{decision}",current["calendar_id"],"캘린더 공유 요청 처리","캘린더 공유 요청이 처리되었습니다.")
            conn.commit()
        return {"subscriptionId": subscription_id, "status": next_status}

    def cancel_calendar_subscription(self, user: AuthUserSummary, subscription_id: str) -> None:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT * FROM user_calendar_subscriptions WHERE id=%s AND company_id=%s AND subscriber_user_id=%s AND status IN ('pending','active') FOR UPDATE", (subscription_id,user.companyId,user.userId))
            row = cursor.fetchone()
            if not row: raise self._missing()
            cursor.execute("UPDATE user_calendar_subscriptions SET status='cancelled',version=version+1,decided_at=NOW(),updated_at=NOW() WHERE id=%s", (subscription_id,))
            self._audit(cursor,user,"calendar_subscription",subscription_id,"workspace.calendar.subscription.cancelled",row["status"],"cancelled")
            conn.commit()

    def _list_owned(self, table: str, user: AuthUserSummary, order_by: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(f"SELECT * FROM {table} WHERE owner_user_id=%s AND status='active' ORDER BY {order_by}", (user.userId,))
            return {"items": [dict(row) for row in cursor.fetchall()]}

    def _owned(self, table: str, user: AuthUserSummary, item_id: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(f"SELECT * FROM {table} WHERE id=%s AND owner_user_id=%s AND status='active'", (item_id, user.userId))
            row = cursor.fetchone()
        if not row:
            raise self._missing()
        return dict(row)

    def _soft_delete(self, table: str, target_type: str, event: str, user: AuthUserSummary, item_id: str) -> None:
        current = self._owned(table, user, item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(f"UPDATE {table} SET status='deleted',updated_at=NOW() WHERE id=%s AND owner_user_id=%s AND status='active'", (item_id, user.userId))
            self._audit(cursor, user, target_type, item_id, event, current['status'], 'deleted')
            conn.commit()

    @staticmethod
    def _schedule_record(row: dict, attendees: list[dict]) -> dict:
        item = dict(row)
        item["repeatType"] = item.pop("repeat_type", "none")
        item["repeatUntil"] = item.pop("repeat_until", None)
        item["alertMinutes"] = item.pop("alert_minutes", [])
        item["calendarId"] = item.pop("calendar_id", "")
        item["calendarName"] = item.pop("calendar_name", "내 일정")
        item["calendarColor"] = item.pop("calendar_color", "#0f766e")
        item["ownerUserId"] = item.get("owner_user_id", "")
        item["ownerUserName"] = item.pop("owner_user_name", "")
        item["canEdit"] = item.pop("can_edit", True)
        item["attendees"] = [
            {"userId": attendee["id"], "name": attendee["name"], "email": attendee["email"], "department": attendee["department"]}
            for attendee in attendees
        ]
        return item

    def _validate_schedule_attendees(self, cursor, user: AuthUserSummary, attendee_user_ids: list[str]) -> list[dict]:
        if user.userId in attendee_user_ids:
            raise HTTPException(status_code=400, detail={"code": "SCHEDULE_ATTENDEE_INVALID", "userMessage": "일정 소유자는 참석자로 추가할 수 없습니다."})
        if not attendee_user_ids:
            return []
        cursor.execute(
            """
            SELECT u.id, u.name, u.email, COALESCE(d.name, '') AS department
            FROM users u
            JOIN roles r ON r.id=u.role_id AND r.status='active'
            LEFT JOIN departments d ON d.id=u.department_id
            WHERE u.id = ANY(%s) AND u.company_id=%s AND u.status='active'
            ORDER BY u.name
            """,
            (attendee_user_ids, user.companyId),
        )
        attendees = [dict(row) for row in cursor.fetchall()]
        if len(attendees) != len(attendee_user_ids):
            raise HTTPException(status_code=400, detail={"code": "SCHEDULE_ATTENDEE_INVALID", "userMessage": "같은 회사의 활성 사용자만 참석자로 선택할 수 있습니다."})
        return attendees

    @staticmethod
    def _replace_schedule_attendees(cursor, item_id: str, company_id: str, attendee_user_ids: list[str]) -> None:
        cursor.execute("DELETE FROM user_schedule_attendees WHERE schedule_id=%s", (item_id,))
        for attendee_user_id in attendee_user_ids:
            cursor.execute(
                "INSERT INTO user_schedule_attendees (schedule_id,company_id,user_id,created_at) VALUES(%s,%s,%s,NOW())",
                (item_id, company_id, attendee_user_id),
            )

    def _schedule_attendees(self, cursor, schedule_ids: list[str]) -> dict[str, list[dict]]:
        grouped: dict[str, list[dict]] = {item_id: [] for item_id in schedule_ids}
        if not schedule_ids:
            return grouped
        cursor.execute(
            """
            SELECT a.schedule_id, u.id, u.name, u.email, COALESCE(d.name, '') AS department
            FROM user_schedule_attendees a
            JOIN users u ON u.id=a.user_id AND u.status='active'
            LEFT JOIN departments d ON d.id=u.department_id
            WHERE a.schedule_id = ANY(%s)
            ORDER BY u.name
            """,
            (schedule_ids,),
        )
        for row in cursor.fetchall():
            item = dict(row)
            schedule_id = item.pop("schedule_id")
            grouped.setdefault(schedule_id, []).append(item)
        return grouped

    def _owned_schedule(self, user: AuthUserSummary, item_id: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("""SELECT s.*,c.name AS calendar_name,c.color AS calendar_color,owner.name AS owner_user_name,TRUE AS can_edit FROM user_schedule_events s JOIN user_calendars c ON c.id=s.calendar_id AND c.status='active' JOIN users owner ON owner.id=s.owner_user_id WHERE s.id=%s AND s.company_id=%s AND s.owner_user_id=%s AND s.status='active'""", (item_id, user.companyId, user.userId))
            row = cursor.fetchone()
            if not row:
                raise self._missing()
            attendees = self._schedule_attendees(cursor, [item_id])
        return self._schedule_record(dict(row), attendees[item_id])

    def list_schedules(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.*,c.name AS calendar_name,c.color AS calendar_color,owner.name AS owner_user_name,
                       (s.owner_user_id=%s) AS can_edit
                FROM user_schedule_events s
                JOIN user_calendars c ON c.id=s.calendar_id AND c.status='active'
                JOIN users owner ON owner.id=s.owner_user_id AND owner.status='active' AND owner.company_id=s.company_id
                LEFT JOIN user_calendar_subscriptions subscription ON subscription.calendar_id=c.id
                  AND subscription.subscriber_user_id=%s AND subscription.status='active'
                WHERE s.company_id=%s AND s.status='active'
                  AND (s.owner_user_id=%s OR (subscription.id IS NOT NULL AND c.visibility <> 'private'))
                ORDER BY starts_at
                """,
                (user.userId, user.userId, user.companyId, user.userId),
            )
            rows = [dict(row) for row in cursor.fetchall()]
            attendees = self._schedule_attendees(cursor, [row["id"] for row in rows])
        return {"items": [self._schedule_record(row, attendees[row["id"]]) for row in rows]}

    def _resolve_owned_calendar(self, cursor, user: AuthUserSummary, calendar_id: str | None) -> dict:
        default = self._ensure_default_calendar(cursor, user)
        if calendar_id:
            cursor.execute("SELECT * FROM user_calendars WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active'", (calendar_id,user.companyId,user.userId))
        else:
            return default
        row = cursor.fetchone()
        if not row: raise self._missing()
        return dict(row)

    def create_schedule(self, user: AuthUserSummary, payload: SchedulePayload) -> dict:
        item_id = f"sch_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._validate_schedule_attendees(cursor, user, payload.attendeeUserIds)
            calendar = self._resolve_owned_calendar(cursor, user, payload.calendarId)
            cursor.execute(
                "INSERT INTO user_schedule_events (id,company_id,owner_user_id,calendar_id,title,starts_at,ends_at,description,location,repeat_type,repeat_until,alert_minutes,timezone,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())",
                (item_id,user.companyId,user.userId,calendar["id"],payload.title,payload.startsAt,payload.endsAt,payload.description,payload.location,payload.repeatType,payload.repeatUntil,Jsonb(payload.alertMinutes),payload.timezone),
            )
            self._replace_schedule_attendees(cursor, item_id, user.companyId, payload.attendeeUserIds)
            self._audit(cursor,user,"schedule",item_id,"workspace.schedule.created",None,"active")
            conn.commit()
        return self._owned_schedule(user,item_id)

    def update_schedule(self, user: AuthUserSummary, item_id: str, payload: SchedulePayload) -> dict:
        current = self._owned_schedule(user,item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._validate_schedule_attendees(cursor, user, payload.attendeeUserIds)
            calendar = self._resolve_owned_calendar(cursor, user, payload.calendarId)
            cursor.execute(
                "UPDATE user_schedule_events SET calendar_id=%s,title=%s,starts_at=%s,ends_at=%s,description=%s,location=%s,repeat_type=%s,repeat_until=%s,alert_minutes=%s,timezone=%s,updated_at=NOW() WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active'",
                (calendar["id"],payload.title,payload.startsAt,payload.endsAt,payload.description,payload.location,payload.repeatType,payload.repeatUntil,Jsonb(payload.alertMinutes),payload.timezone,item_id,user.companyId,user.userId),
            )
            self._replace_schedule_attendees(cursor, item_id, user.companyId, payload.attendeeUserIds)
            self._audit(cursor,user,"schedule",item_id,"workspace.schedule.updated",current['status'],"active")
            conn.commit()
        return self._owned_schedule(user,item_id)

    def delete_schedule(self, user: AuthUserSummary, item_id: str) -> None:
        self._soft_delete("user_schedule_events","schedule","workspace.schedule.deleted",user,item_id)

    def list_contacts(self, user: AuthUserSummary) -> dict:
        return self._list_owned("personal_contacts", user, "name")

    def create_contact(self, user: AuthUserSummary, payload: ContactPayload) -> dict:
        item_id = f"ctc_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("INSERT INTO personal_contacts (id,company_id,owner_user_id,name,email,phone,company_name,memo,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())", (item_id,user.companyId,user.userId,payload.name,payload.email.lower(),payload.phone,payload.companyName,payload.memo))
            self._audit(cursor,user,"contact",item_id,"workspace.contact.created",None,"active")
            conn.commit()
        return self._owned("personal_contacts",user,item_id)

    def update_contact(self, user: AuthUserSummary, item_id: str, payload: ContactPayload) -> dict:
        current = self._owned("personal_contacts",user,item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("UPDATE personal_contacts SET name=%s,email=%s,phone=%s,company_name=%s,memo=%s,updated_at=NOW() WHERE id=%s AND owner_user_id=%s AND status='active'", (payload.name,payload.email.lower(),payload.phone,payload.companyName,payload.memo,item_id,user.userId))
            self._audit(cursor,user,"contact",item_id,"workspace.contact.updated",current['status'],"active")
            conn.commit()
        return self._owned("personal_contacts",user,item_id)

    def delete_contact(self, user: AuthUserSummary, item_id: str) -> None:
        self._soft_delete("personal_contacts","contact","workspace.contact.deleted",user,item_id)

    def list_files(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT id,file_name,content_type,size_bytes,status,created_at,updated_at FROM workspace_files WHERE owner_user_id=%s AND status='active' ORDER BY updated_at DESC", (user.userId,))
            return {"items": [dict(row) for row in cursor.fetchall()]}

    def create_file(self, user: AuthUserSummary, file_name: str, content_type: str, content: bytes) -> dict:
        item_id = f"wfl_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("INSERT INTO workspace_files (id,company_id,owner_user_id,file_name,content_type,size_bytes,content,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())", (item_id,user.companyId,user.userId,file_name,content_type or "application/octet-stream",len(content),content))
            self._audit(cursor,user,"file",item_id,"workspace.file.uploaded",None,"active",file_name)
            conn.commit()
        return self.file_metadata(user,item_id)

    def file_metadata(self, user: AuthUserSummary, item_id: str, include_content: bool = False) -> dict:
        columns = "id,file_name,content_type,size_bytes,status,created_at,updated_at" + (",content" if include_content else "")
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(f"SELECT {columns} FROM workspace_files WHERE id=%s AND owner_user_id=%s AND status='active'", (item_id,user.userId))
            row = cursor.fetchone()
        if not row:
            raise self._missing()
        return dict(row)

    def rename_file(self, user: AuthUserSummary, item_id: str, file_name: str) -> dict:
        current = self.file_metadata(user,item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("UPDATE workspace_files SET file_name=%s,updated_at=NOW() WHERE id=%s AND owner_user_id=%s AND status='active'", (file_name,item_id,user.userId))
            self._audit(cursor,user,"file",item_id,"workspace.file.renamed","active","active",f"{current['file_name']}->{file_name}")
            conn.commit()
        return self.file_metadata(user,item_id)

    def delete_file(self, user: AuthUserSummary, item_id: str) -> None:
        self._soft_delete("workspace_files","file","workspace.file.deleted",user,item_id)

    def get_preferences(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT locale,timezone FROM user_workspace_preferences WHERE owner_user_id=%s", (user.userId,))
            row = cursor.fetchone()
        return dict(row) if row else {"locale":"ko","timezone":"Asia/Seoul"}

    def save_preferences(self, user: AuthUserSummary, payload: PreferencePayload) -> dict:
        current = self.get_preferences(user)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("INSERT INTO user_workspace_preferences (owner_user_id,locale,timezone,updated_at) VALUES(%s,%s,%s,NOW()) ON CONFLICT(owner_user_id) DO UPDATE SET locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,updated_at=NOW()", (user.userId,payload.locale,payload.timezone))
            self._audit(cursor,user,"preference",user.userId,"workspace.preferences.updated",None,None,f"{current['locale']}/{current['timezone']}->{payload.locale}/{payload.timezone}")
            conn.commit()
        return self.get_preferences(user)

    def list_help(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT id,code,title,category,audience,content,version,published_at,updated_at FROM help_policy_documents WHERE status='published' AND audience IN ('user','both','all') ORDER BY updated_at DESC")
            return {"items": [dict(row) for row in cursor.fetchall()]}

    def list_notices(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT n.id, n.title, n.content, n.author_name, n.published_at,
                       (r.user_id IS NOT NULL) AS is_read
                FROM user_notices n
                LEFT JOIN user_notice_reads r ON r.notice_id=n.id AND r.user_id=%s
                WHERE n.company_id=%s AND n.status='published'
                ORDER BY n.published_at DESC
                """,
                (user.userId, user.companyId),
            )
            items = [dict(row) for row in cursor.fetchall()]
        return {"items": items, "unread_count": sum(1 for item in items if not item["is_read"])}

    def notice_detail(self, user: AuthUserSummary, notice_id: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT n.id, n.title, n.content, n.author_name, n.published_at,
                       (r.user_id IS NOT NULL) AS is_read
                FROM user_notices n
                LEFT JOIN user_notice_reads r ON r.notice_id=n.id AND r.user_id=%s
                WHERE n.id=%s AND n.company_id=%s AND n.status='published'
                """,
                (user.userId, notice_id, user.companyId),
            )
            row = cursor.fetchone()
        if not row:
            raise self._missing()
        return dict(row)

    def read_notice(self, user: AuthUserSummary, notice_id: str) -> dict:
        current = self.notice_detail(user, notice_id)
        if current["is_read"]:
            return current
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO user_notice_reads (notice_id,user_id,read_at) VALUES(%s,%s,NOW()) ON CONFLICT(notice_id,user_id) DO NOTHING",
                (notice_id, user.userId),
            )
            self._audit(cursor, user, "notice", notice_id, "workspace.notice.read", "unread", "read")
            conn.commit()
        return self.notice_detail(user, notice_id)
