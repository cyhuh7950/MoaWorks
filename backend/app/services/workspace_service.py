from __future__ import annotations

import csv
from datetime import UTC, datetime
from hashlib import sha256
import io
import json
import re
from uuid import uuid4

from fastapi import HTTPException
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from app.schemas.directory import AuthUserSummary
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.schemas.workspace import CalendarCreatePayload, CalendarOrderPayload, CalendarSubscriptionPayload, CalendarUpdatePayload, ContactGroupCreatePayload, ContactGroupUpdatePayload, ContactPayload, FilePatchPayload, FileShareSnapshotPayload, FolderCreatePayload, FolderPatchPayload, PersonalProfilePayload, PreferencePayload, SchedulePayload
from app.services.workspace_file_storage import ContentTypeRejected, WorkspaceFileStorage
from app.services.calendar_rules import subscription_action_for_visibility_change, subscription_status_for_visibility, validate_order_snapshot
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

    def organization_departments(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT department.id,department.name,department.department_code,department.parent_id,
                       COUNT(role.id) AS direct_member_count
                FROM departments department
                LEFT JOIN users member ON member.department_id=department.id
                    AND member.company_id=department.company_id AND member.status='active'
                LEFT JOIN roles role ON role.id=member.role_id AND role.status='active'
                WHERE department.company_id=%s AND department.status='active'
                GROUP BY department.id,department.name,department.department_code,department.parent_id
                ORDER BY department.name,department.id
                """,
                (user.companyId,),
            )
            rows = cursor.fetchall()
        return {"departments": [{
            "id": row["id"], "name": row["name"], "departmentCode": row["department_code"],
            "parentId": row["parent_id"], "directMemberCount": int(row["direct_member_count"]),
        } for row in rows]}

    def organization_members(self, user: AuthUserSummary, department_id: str | None = None, query: str = "") -> dict:
        normalized_query = query.strip()
        search = f"%{normalized_query}%"
        with self.db.connect() as conn, conn.cursor() as cursor:
            if department_id:
                cursor.execute(
                    "SELECT department.id FROM departments department WHERE department.id=%s AND department.company_id=%s AND department.status='active'",
                    (department_id, user.companyId),
                )
                if not cursor.fetchone():
                    raise self._missing()
            department_filter = " AND member.department_id=%s" if department_id else ""
            params: tuple = (user.companyId, normalized_query, search, search)
            if department_id:
                params = (user.companyId, department_id, normalized_query, search, search)
            cursor.execute(
                f"""
                SELECT member.id,member.name,member.email,member.department_id,
                       COALESCE(department.name,'') AS department_name,role.name AS role_name
                FROM users member
                JOIN roles role ON role.id=member.role_id AND role.status='active'
                LEFT JOIN departments department ON department.id=member.department_id AND department.company_id=member.company_id AND department.status='active'
                WHERE member.company_id=%s AND member.status='active'{department_filter}
                  AND (%s='' OR LOWER(member.name) LIKE LOWER(%s) OR LOWER(member.email) LIKE LOWER(%s))
                ORDER BY member.name,member.id LIMIT 500
                """,
                params,
            )
            rows = cursor.fetchall()
        return {"members": [{
            "id": row["id"], "name": row["name"], "email": row["email"],
            "departmentId": row["department_id"], "departmentName": row["department_name"], "roleName": row["role_name"],
        } for row in rows]}

    def organization_member_detail(self, user: AuthUserSummary, user_id: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT member.id,member.name,member.email,member.department_id,
                       COALESCE(department.name,'') AS department_name,role.name AS role_name
                FROM users member
                JOIN roles role ON role.id=member.role_id AND role.status='active'
                LEFT JOIN departments department ON department.id=member.department_id AND department.company_id=member.company_id AND department.status='active'
                WHERE member.id=%s AND member.company_id=%s AND member.status='active'
                """,
                (user_id, user.companyId),
            )
            row = cursor.fetchone()
            if not row:
                raise self._missing()
            member = {
                "id": row["id"], "name": row["name"], "email": row["email"],
                "departmentId": row["department_id"], "departmentName": row["department_name"], "roleName": row["role_name"],
            }
            self._audit(cursor, user, "organization_member", user_id, "workspace.organization.member_viewed", None, None, json.dumps({"source": "organization_member_detail"}, separators=(",", ":")))
            conn.commit()
        return member

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

    def _activate_pending_calendar_subscriptions(self, cursor, user: AuthUserSummary, calendar_id: str) -> None:
        cursor.execute(
            "SELECT id,subscriber_user_id,status FROM user_calendar_subscriptions WHERE calendar_id=%s AND company_id=%s AND status='pending' ORDER BY id FOR UPDATE",
            (calendar_id, user.companyId),
        )
        subscriptions = [dict(row) for row in cursor.fetchall()]
        for subscription in subscriptions:
            cursor.execute(
                "UPDATE user_calendar_subscriptions SET status='active',version=version+1,decided_at=NOW(),updated_at=NOW() WHERE id=%s",
                (subscription["id"],),
            )
            self._audit(cursor, user, "calendar_subscription", subscription["id"], "workspace.calendar.subscription.accepted", "pending", "active")
            self._notify_in_transaction(cursor, user, subscription["subscriber_user_id"], "calendar.subscription.accepted", calendar_id, "캘린더 공유 승인", "캘린더가 공개로 변경되어 공유 요청이 승인되었습니다.")

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
            subscription_action = subscription_action_for_visibility_change(current["visibility"], visibility)
            cursor.execute("SELECT 1 FROM user_calendars WHERE owner_user_id=%s AND id<>%s AND status='active' AND LOWER(name)=LOWER(%s)", (user.userId,calendar_id,name))
            if cursor.fetchone(): raise self._calendar_conflict("CALENDAR_NAME_CONFLICT", "같은 이름의 캘린더가 이미 있습니다.")
            event = "workspace.calendar.updated"
            if payload.isDefault is True and not current["is_default"]:
                cursor.execute("UPDATE user_calendars SET is_default=FALSE,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND status='active' AND is_default=TRUE", (user.userId,))
                event = "workspace.calendar.default_changed"
            cursor.execute("UPDATE user_calendars SET name=%s,color=%s,visibility=%s,is_default=%s,version=version+1,updated_at=NOW() WHERE id=%s", (name,color,visibility,is_default,calendar_id))
            if subscription_action == "activate_pending":
                self._activate_pending_calendar_subscriptions(cursor, user, calendar_id)
            elif subscription_action == "cancel_open":
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
            self._lock_calendar_owner(cursor, user)
            cursor.execute(
                """SELECT id FROM user_calendars
                WHERE id=(SELECT calendar_id FROM user_calendar_subscriptions WHERE id=%s AND company_id=%s)
                  AND company_id=%s AND owner_user_id=%s AND status='active' FOR UPDATE""",
                (subscription_id, user.companyId, user.companyId, user.userId),
            )
            calendar = cursor.fetchone()
            if not calendar: raise self._missing()
            cursor.execute(
                "SELECT * FROM user_calendar_subscriptions WHERE id=%s AND calendar_id=%s AND company_id=%s FOR UPDATE",
                (subscription_id, calendar["id"], user.companyId),
            )
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

    @staticmethod
    def _contact_conflict(code: str, message: str) -> HTTPException:
        return HTTPException(status_code=409, detail={"code": code, "userMessage": message})

    @staticmethod
    def _contact_group_record(row: dict) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "sortOrder": int(row.get("sort_order") or 0),
            "contactCount": int(row.get("contact_count") or 0),
            "status": row.get("status", "active"),
            "createdAt": row.get("created_at"),
            "updatedAt": row.get("updated_at"),
        }

    def _lock_contact_owner(self, cursor, user: AuthUserSummary) -> None:
        cursor.execute("SELECT id FROM users WHERE id=%s AND company_id=%s AND status='active' FOR UPDATE", (user.userId, user.companyId))
        if not cursor.fetchone():
            raise self._missing()

    def list_contact_groups(self, user: AuthUserSummary) -> list[dict]:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT contact_group.*,COUNT(contact.id) FILTER (WHERE contact.status='active') AS contact_count
                FROM contact_groups contact_group
                LEFT JOIN personal_contacts contact ON contact.group_id=contact_group.id
                WHERE contact_group.company_id=%s AND contact_group.owner_user_id=%s AND contact_group.status='active'
                GROUP BY contact_group.id ORDER BY contact_group.sort_order,contact_group.created_at
                """,
                (user.companyId, user.userId),
            )
            return [self._contact_group_record(dict(row)) for row in cursor.fetchall()]

    def _owned_contact_group(self, cursor, user: AuthUserSummary, group_id: str, *, lock: bool = False) -> dict:
        lock_clause = " FOR UPDATE" if lock else ""
        cursor.execute(
            f"SELECT * FROM contact_groups WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active'{lock_clause}",
            (group_id, user.companyId, user.userId),
        )
        row = cursor.fetchone()
        if not row:
            raise self._missing()
        return dict(row)

    def _ensure_contact_group_name_available(self, cursor, user: AuthUserSummary, name: str, exclude_id: str | None = None) -> None:
        params: tuple = (user.companyId, user.userId, name)
        exclude_sql = ""
        if exclude_id:
            exclude_sql = " AND id<>%s"
            params = (*params, exclude_id)
        cursor.execute(
            f"SELECT id FROM contact_groups WHERE company_id=%s AND owner_user_id=%s AND LOWER(name)=LOWER(%s) AND status='active'{exclude_sql}",
            params,
        )
        if cursor.fetchone():
            raise self._contact_conflict("CONTACT_GROUP_NAME_CONFLICT", "같은 이름의 연락처 그룹이 있습니다.")

    def create_contact_group(self, user: AuthUserSummary, payload: ContactGroupCreatePayload) -> dict:
        group_id = f"ctg_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            self._ensure_contact_group_name_available(cursor, user, payload.name)
            cursor.execute("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_sort FROM contact_groups WHERE owner_user_id=%s AND status='active'", (user.userId,))
            next_sort = int(cursor.fetchone()["next_sort"])
            cursor.execute(
                "INSERT INTO contact_groups (id,company_id,owner_user_id,name,sort_order,status,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,'active',NOW(),NOW())",
                (group_id, user.companyId, user.userId, payload.name, next_sort),
            )
            self._audit(cursor, user, "contact_group", group_id, "workspace.contact_group.created", None, "active")
            conn.commit()
        with self.db.connect() as conn, conn.cursor() as cursor:
            return self._contact_group_record(self._owned_contact_group(cursor, user, group_id))

    def update_contact_group(self, user: AuthUserSummary, group_id: str, payload: ContactGroupUpdatePayload) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            current = self._owned_contact_group(cursor, user, group_id, lock=True)
            if current["updated_at"] != payload.expectedUpdatedAt:
                raise self._contact_conflict("CONTACT_GROUP_VERSION_CONFLICT", "그룹이 변경되었습니다. 새로고침 후 다시 시도하세요.")
            self._ensure_contact_group_name_available(cursor, user, payload.name, group_id)
            if current["name"] != payload.name:
                cursor.execute("UPDATE contact_groups SET name=%s,updated_at=NOW() WHERE id=%s", (payload.name, group_id))
                self._audit(cursor, user, "contact_group", group_id, "workspace.contact_group.updated", "active", "active")
            conn.commit()
        with self.db.connect() as conn, conn.cursor() as cursor:
            return self._contact_group_record(self._owned_contact_group(cursor, user, group_id))

    def delete_contact_group(self, user: AuthUserSummary, group_id: str, expected_updated_at: datetime) -> None:
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            current = self._owned_contact_group(cursor, user, group_id, lock=True)
            if current["updated_at"] != expected_updated_at:
                raise self._contact_conflict("CONTACT_GROUP_VERSION_CONFLICT", "그룹이 변경되었습니다. 새로고침 후 다시 시도하세요.")
            cursor.execute("SELECT COUNT(*) AS contact_count FROM personal_contacts WHERE company_id=%s AND owner_user_id=%s AND group_id=%s AND status='active'", (user.companyId, user.userId, group_id))
            contact_count = int(cursor.fetchone()["contact_count"])
            cursor.execute("UPDATE personal_contacts SET group_id=NULL,updated_at=NOW() WHERE company_id=%s AND owner_user_id=%s AND group_id=%s AND status='active'", (user.companyId, user.userId, group_id))
            cursor.execute("UPDATE contact_groups SET status='deleted',updated_at=NOW() WHERE id=%s", (group_id,))
            self._audit(cursor, user, "contact_group", group_id, "workspace.contact_group.deleted", "active", "deleted", json.dumps({"contactCount": contact_count}, separators=(",", ":")))
            conn.commit()

    def _resolve_contact_group(self, cursor, user: AuthUserSummary, group_id: str | None) -> dict | None:
        return self._owned_contact_group(cursor, user, group_id) if group_id else None

    def _ensure_contact_email_available(self, cursor, user: AuthUserSummary, email: str, exclude_id: str | None = None) -> None:
        params: tuple = (user.companyId, user.userId, email)
        exclude_sql = ""
        if exclude_id:
            exclude_sql = " AND id<>%s"
            params = (*params, exclude_id)
        cursor.execute(
            f"SELECT id FROM personal_contacts WHERE company_id=%s AND owner_user_id=%s AND LOWER(email)=LOWER(%s) AND status='active'{exclude_sql}",
            params,
        )
        if cursor.fetchone():
            raise self._contact_conflict("CONTACT_EMAIL_CONFLICT", "이미 등록된 이메일 주소입니다.")

    def _owned_contact(self, user: AuthUserSummary, item_id: str) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT contact.*,contact_group.name AS group_name
                FROM personal_contacts contact
                LEFT JOIN contact_groups contact_group ON contact_group.id=contact.group_id AND contact_group.status='active'
                WHERE contact.id=%s AND contact.company_id=%s AND contact.owner_user_id=%s AND contact.status='active'
                """,
                (item_id, user.companyId, user.userId),
            )
            row = cursor.fetchone()
        if not row:
            raise self._missing()
        return dict(row)

    def list_contacts(self, user: AuthUserSummary, query: str = "", group_id: str | None = None) -> dict:
        normalized_query = query.strip()
        search = f"%{normalized_query}%"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._resolve_contact_group(cursor, user, group_id)
            cursor.execute(
                """
                SELECT contact.*,contact_group.name AS group_name
                FROM personal_contacts contact
                LEFT JOIN contact_groups contact_group ON contact_group.id=contact.group_id AND contact_group.status='active'
                WHERE contact.company_id=%s AND contact.owner_user_id=%s AND contact.status='active'
                  AND (%s::text IS NULL OR contact.group_id=%s)
                  AND (%s='' OR contact.name ILIKE %s OR contact.email ILIKE %s OR contact.phone ILIKE %s OR contact.company_name ILIKE %s OR contact.memo ILIKE %s)
                ORDER BY contact.name,contact.email LIMIT 500
                """,
                (user.companyId, user.userId, group_id, group_id, normalized_query, search, search, search, search, search),
            )
            return {"items": [dict(row) for row in cursor.fetchall()]}

    def create_contact(self, user: AuthUserSummary, payload: ContactPayload) -> dict:
        item_id = f"ctc_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            self._resolve_contact_group(cursor, user, payload.groupId)
            self._ensure_contact_email_available(cursor, user, payload.email)
            cursor.execute(
                "INSERT INTO personal_contacts (id,company_id,owner_user_id,group_id,name,email,phone,company_name,memo,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())",
                (item_id, user.companyId, user.userId, payload.groupId, payload.name, payload.email, payload.phone, payload.companyName, payload.memo),
            )
            self._audit(cursor, user, "contact", item_id, "workspace.contact.created", None, "active")
            conn.commit()
        return self._owned_contact(user, item_id)

    def update_contact(self, user: AuthUserSummary, item_id: str, payload: ContactPayload) -> dict:
        current = self._owned_contact(user, item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            self._resolve_contact_group(cursor, user, payload.groupId)
            self._ensure_contact_email_available(cursor, user, payload.email, item_id)
            cursor.execute(
                "UPDATE personal_contacts SET group_id=%s,name=%s,email=%s,phone=%s,company_name=%s,memo=%s,updated_at=NOW() WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active'",
                (payload.groupId, payload.name, payload.email, payload.phone, payload.companyName, payload.memo, item_id, user.companyId, user.userId),
            )
            self._audit(cursor, user, "contact", item_id, "workspace.contact.updated", current["status"], "active")
            conn.commit()
        return self._owned_contact(user, item_id)

    def delete_contact(self, user: AuthUserSummary, item_id: str) -> None:
        self._owned_contact(user, item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("UPDATE personal_contacts SET status='deleted',updated_at=NOW() WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active'", (item_id, user.companyId, user.userId))
            self._audit(cursor, user, "contact", item_id, "workspace.contact.deleted", "active", "deleted")
            conn.commit()

    def list_public_contacts(self, user: AuthUserSummary, query: str = "") -> list[dict]:
        normalized_query = query.strip()
        search = f"%{normalized_query}%"
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT u.id,u.name,u.email,COALESCE(d.name,'') AS department_name,r.name AS role_name
                FROM users u JOIN roles r ON r.id=u.role_id AND r.status='active'
                LEFT JOIN departments d ON d.id=u.department_id AND d.status='active'
                WHERE u.company_id=%s AND u.status='active'
                  AND (%s='' OR u.name ILIKE %s OR u.email ILIKE %s OR COALESCE(d.name,'') ILIKE %s OR r.name ILIKE %s)
                ORDER BY u.name,u.email LIMIT 500
                """,
                (user.companyId, normalized_query, search, search, search, search),
            )
            return [dict(row) for row in cursor.fetchall()]

    @staticmethod
    def _validate_contact_import_file(file_name: str, content_type: str, content: bytes) -> None:
        if not file_name.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail={"code": "CONTACT_IMPORT_FILE_INVALID", "userMessage": "CSV 파일만 가져올 수 있습니다."})
        allowed_types = {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"}
        if content_type.lower() not in allowed_types:
            raise HTTPException(status_code=400, detail={"code": "CONTACT_IMPORT_FILE_INVALID", "userMessage": "CSV 형식의 파일을 선택하세요."})
        if not content:
            raise HTTPException(status_code=400, detail={"code": "CONTACT_IMPORT_FILE_EMPTY", "userMessage": "빈 CSV 파일은 가져올 수 없습니다."})
        if len(content) > 1024 * 1024:
            raise HTTPException(status_code=413, detail={"code": "CONTACT_IMPORT_FILE_TOO_LARGE", "userMessage": "CSV 파일은 최대 1MB입니다."})

    @staticmethod
    def _parse_contact_csv(content: bytes) -> dict:
        digest = sha256(content).hexdigest()
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail={"code": "CONTACT_IMPORT_ENCODING_INVALID", "userMessage": "UTF-8 CSV 파일만 가져올 수 있습니다."})
        reader = csv.DictReader(io.StringIO(text, newline=""))
        headers = [header.strip() for header in (reader.fieldnames or []) if header is not None]
        required_headers = {"name", "email"}
        allowed_headers = {"name", "email", "phone", "companyName", "memo", "groupName"}
        errors: list[dict] = []
        if not required_headers.issubset(headers) or any(header not in allowed_headers for header in headers) or len(headers) != len(set(headers)):
            errors.append({"rowNumber": 1, "message": "CSV 헤더를 확인하세요. 필수 헤더는 name,email입니다."})
            return {"digest": digest, "rows": [], "errors": errors, "totalRows": 0}
        reader.fieldnames = headers
        raw_rows = list(reader)
        if len(raw_rows) > 500:
            errors.append({"rowNumber": 502, "message": "CSV 데이터 행은 최대 500개입니다."})
            return {"digest": digest, "rows": [], "errors": errors, "totalRows": len(raw_rows)}
        rows: list[dict] = []
        for index, raw in enumerate(raw_rows, start=2):
            name = " ".join((raw.get("name") or "").split())
            email = (raw.get("email") or "").strip().lower()
            phone = (raw.get("phone") or "").strip()
            company_name = (raw.get("companyName") or "").strip()
            memo = (raw.get("memo") or "").strip()
            group_name = " ".join((raw.get("groupName") or "").split())
            row_errors: list[str] = []
            if None in raw: row_errors.append("허용된 헤더 수보다 값이 많습니다.")
            if not name or len(name) > 120: row_errors.append("이름은 1~120자여야 합니다.")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 255: row_errors.append("이메일 형식이 올바르지 않습니다.")
            if len(phone) > 64: row_errors.append("전화번호는 64자 이하여야 합니다.")
            if len(company_name) > 160: row_errors.append("회사명은 160자 이하여야 합니다.")
            if len(memo) > 2000: row_errors.append("메모는 2000자 이하여야 합니다.")
            if len(group_name) > 60: row_errors.append("그룹 이름은 60자 이하여야 합니다.")
            if row_errors:
                errors.append({"rowNumber": index, "message": " ".join(row_errors)})
                continue
            rows.append({"rowNumber": index, "name": name, "email": email, "phone": phone, "companyName": company_name, "memo": memo, "groupName": group_name})
        return {"digest": digest, "rows": rows, "errors": errors, "totalRows": len(raw_rows)}

    @staticmethod
    def _build_contact_import_plan(cursor, user: AuthUserSummary, parsed: dict) -> dict:
        cursor.execute("SELECT LOWER(email) AS email FROM personal_contacts WHERE company_id=%s AND owner_user_id=%s AND status='active'", (user.companyId, user.userId))
        existing_emails = {row["email"] for row in cursor.fetchall()}
        cursor.execute("SELECT id,name FROM contact_groups WHERE company_id=%s AND owner_user_id=%s AND status='active'", (user.companyId, user.userId))
        existing_groups = {row["name"].lower(): dict(row) for row in cursor.fetchall()}
        seen: set[str] = set()
        rows_to_create: list[dict] = []
        existing_count = 0
        file_duplicate_count = 0
        for row in parsed["rows"]:
            if row["email"] in seen:
                file_duplicate_count += 1
                continue
            seen.add(row["email"])
            if row["email"] in existing_emails:
                existing_count += 1
                continue
            rows_to_create.append(row)
        groups_to_create = sorted({row["groupName"] for row in rows_to_create if row["groupName"] and row["groupName"].lower() not in existing_groups})
        return {
            "rowsToCreate": rows_to_create,
            "existingGroups": existing_groups,
            "existingEmailCount": existing_count,
            "fileDuplicateCount": file_duplicate_count,
            "groupsToCreate": groups_to_create,
        }

    def preview_contact_import(self, user: AuthUserSummary, file_name: str, content_type: str, content: bytes) -> dict:
        self._validate_contact_import_file(file_name, content_type, content)
        parsed = self._parse_contact_csv(content)
        if parsed["errors"]:
            return {**parsed, "newCount": 0, "existingEmailCount": 0, "fileDuplicateCount": 0, "groupsToCreate": [], "canApply": False}
        with self.db.connect() as conn, conn.cursor() as cursor:
            plan = self._build_contact_import_plan(cursor, user, parsed)
        return {
            "digest": parsed["digest"], "totalRows": parsed["totalRows"], "errors": [],
            "newCount": len(plan["rowsToCreate"]), "existingEmailCount": plan["existingEmailCount"],
            "fileDuplicateCount": plan["fileDuplicateCount"], "groupsToCreate": plan["groupsToCreate"], "canApply": True,
        }

    def apply_contact_import(self, user: AuthUserSummary, file_name: str, content_type: str, content: bytes, expected_digest: str) -> dict:
        self._validate_contact_import_file(file_name, content_type, content)
        parsed = self._parse_contact_csv(content)
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest) or parsed["digest"] != expected_digest:
            raise HTTPException(status_code=409, detail={"code": "CONTACT_IMPORT_DIGEST_CONFLICT", "userMessage": "미리보기와 같은 CSV 파일을 다시 선택하세요."})
        if parsed["errors"]:
            raise HTTPException(status_code=400, detail={"code": "CONTACT_IMPORT_ROWS_INVALID", "userMessage": "오류 행을 수정한 뒤 다시 가져오세요."})
        created_contact_ids: list[str] = []
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_contact_owner(cursor, user)
            plan = self._build_contact_import_plan(cursor, user, parsed)
            group_by_name = dict(plan["existingGroups"])
            cursor.execute("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_sort FROM contact_groups WHERE owner_user_id=%s AND status='active'", (user.userId,))
            next_sort = int(cursor.fetchone()["next_sort"])
            for offset, group_name in enumerate(plan["groupsToCreate"]):
                group_id = f"ctg_{uuid4().hex[:12]}"
                cursor.execute("INSERT INTO contact_groups (id,company_id,owner_user_id,name,sort_order,status,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,'active',NOW(),NOW())", (group_id, user.companyId, user.userId, group_name, next_sort + offset))
                group_by_name[group_name.lower()] = {"id": group_id, "name": group_name}
            for row in plan["rowsToCreate"]:
                contact_id = f"ctc_{uuid4().hex[:12]}"
                group = group_by_name.get(row["groupName"].lower()) if row["groupName"] else None
                cursor.execute(
                    "INSERT INTO personal_contacts (id,company_id,owner_user_id,group_id,name,email,phone,company_name,memo,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())",
                    (contact_id, user.companyId, user.userId, group["id"] if group else None, row["name"], row["email"], row["phone"], row["companyName"], row["memo"]),
                )
                created_contact_ids.append(contact_id)
            digest = parsed["digest"]
            reason = json.dumps({"createdCount": len(created_contact_ids), "skippedCount": plan["existingEmailCount"] + plan["fileDuplicateCount"], "groupCount": len(plan["groupsToCreate"]), "digestPrefix": digest[:12]}, separators=(",", ":"))
            self._audit(cursor, user, "contact_import", user.userId, "workspace.contact.imported", None, "complete", reason)
            conn.commit()
        return {"createdCount": len(created_contact_ids), "skippedCount": plan["existingEmailCount"] + plan["fileDuplicateCount"], "groupCount": len(plan["groupsToCreate"]), "digest": parsed["digest"]}

    def list_files(self, user: AuthUserSummary, scope: str = "mine", folder_id: str | None = None, query: str = "", sort: str = "updated_desc", folder_specified: bool = False) -> dict:
        return self._list_files(user, scope, folder_id, query, sort, folder_specified)

    @staticmethod
    def _file_access_sql() -> str:
        return """f.company_id=%s AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=%s AND actor.company_id=f.company_id AND actor.status='active') AND (f.owner_user_id=%s OR EXISTS (
            SELECT 1 FROM workspace_file_shares s WHERE s.file_id=f.id AND s.status='active' AND
            ((s.target_type='user' AND s.target_id=%s) OR (s.target_type='department' AND s.target_id=(SELECT actor.department_id FROM users actor JOIN departments d ON d.id=actor.department_id AND d.company_id=actor.company_id AND d.status='active' WHERE actor.id=%s AND actor.status='active')))) )"""

    @staticmethod
    def _file_columns() -> str:
        return "f.id,f.company_id,f.owner_user_id,f.folder_id,f.file_name,f.content_type,f.size_bytes,f.status,f.current_version,f.version,f.created_at,f.updated_at"

    def _lock_file_access(self, cursor, user: AuthUserSummary, item_id: str, action: str, required_status: str = "active", *, lock: bool = True) -> dict:
        cursor.execute(f"""SELECT {self._file_columns()},
            EXISTS(SELECT 1 FROM workspace_file_favorites fav WHERE fav.file_id=f.id AND fav.user_id=%s) AS is_favorite,
            CASE WHEN f.owner_user_id=%s THEN 'owner' WHEN EXISTS(SELECT 1 FROM workspace_file_shares ep WHERE ep.file_id=f.id AND ep.status='active' AND ep.permission='editor' AND ((ep.target_type='user' AND ep.target_id=%s) OR (ep.target_type='department' AND ep.target_id=(SELECT actor.department_id FROM users actor JOIN departments d ON d.id=actor.department_id AND d.status='active' WHERE actor.id=%s AND actor.status='active')))) THEN 'editor' ELSE 'viewer' END AS effective_permission
            FROM workspace_files f WHERE f.id=%s AND {self._file_access_sql()} {"FOR UPDATE" if lock else ""}""",
            (user.userId,user.userId,user.userId,user.userId,item_id,user.companyId,user.userId,user.userId,user.userId,user.userId))
        row=cursor.fetchone()
        if not row or row.get("status") != required_status: raise self._missing()
        if required_status == "deleted" and row.get("owner_user_id") != user.userId: raise self._missing()
        permission = "owner" if row.get("owner_user_id") == user.userId else row.get("effective_permission","viewer")
        allowed = {"owner":{"detail","download","rename","version","move","share","favorite","trash","restore"},"editor":{"detail","download","rename","version","favorite"},"viewer":{"detail","download","favorite"}}
        if action not in allowed.get(permission,set()):
            raise HTTPException(status_code=403,detail={"code":"FILE_FORBIDDEN","userMessage":"이 작업을 수행할 권한이 없습니다."})
        return dict(row)

    def _lock_owned_folder(self, cursor, user: AuthUserSummary, folder_id: str) -> dict:
        cursor.execute("SELECT id,company_id,owner_user_id,parent_id,name,status,version FROM workspace_folders WHERE id=%s AND company_id=%s AND owner_user_id=%s AND status='active' FOR UPDATE",(folder_id,user.companyId,user.userId))
        row=cursor.fetchone()
        if not row: raise self._missing()
        return dict(row)

    def _list_files(self, user: AuthUserSummary, scope: str = "mine", folder_id: str | None = None, query: str = "", sort: str = "updated_desc", folder_specified: bool = False) -> dict:
        access = self._file_access_sql()
        clauses = {"mine": "f.owner_user_id=%s AND f.status='active'", "shared": "f.owner_user_id<>%s AND f.status='active' AND EXISTS (SELECT 1 FROM workspace_file_shares s WHERE s.file_id=f.id AND s.target_type='user' AND s.target_id=%s AND s.status='active')", "department": "f.status='active' AND EXISTS (SELECT 1 FROM workspace_file_shares s WHERE s.file_id=f.id AND s.target_type='department' AND s.target_id=(SELECT department_id FROM users WHERE id=%s) AND s.status='active')", "recent": "f.status='active' AND f.updated_at>=NOW()-INTERVAL '30 days'", "favorites": "f.status='active' AND EXISTS (SELECT 1 FROM workspace_file_favorites fav WHERE fav.file_id=f.id AND fav.user_id=%s)", "trash": "f.owner_user_id=%s AND f.status='deleted'"}
        scope_clause = clauses[scope]
        scope_args = (user.userId, user.userId) if scope == "shared" else (user.userId,) if "%s" in scope_clause else ()
        order = {"updated_desc":"f.updated_at DESC", "updated_asc":"f.updated_at", "name_asc":"lower(f.file_name)", "name_desc":"lower(f.file_name) DESC", "size_desc":"f.size_bytes DESC"}[sort]
        if not folder_specified:
            folder_clause, folder_args = "", ()
        elif folder_id is None:
            folder_clause, folder_args = "AND f.folder_id IS NULL", ()
        else:
            folder_clause, folder_args = "AND f.folder_id=%s", (folder_id,)
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(f"""SELECT f.id,f.file_name,f.content_type,f.size_bytes,f.status,f.folder_id,f.current_version,f.version,f.owner_user_id,
                f.created_at,f.updated_at,EXISTS(SELECT 1 FROM workspace_file_favorites fav WHERE fav.file_id=f.id AND fav.user_id=%s) AS is_favorite,
                CASE WHEN f.owner_user_id=%s THEN 'owner' WHEN EXISTS(SELECT 1 FROM workspace_file_shares ep WHERE ep.file_id=f.id AND ep.status='active' AND ep.permission='editor' AND ((ep.target_type='user' AND ep.target_id=%s) OR (ep.target_type='department' AND ep.target_id=(SELECT department_id FROM users WHERE id=%s)))) THEN 'editor' ELSE 'viewer' END AS effective_permission
                FROM workspace_files f WHERE {access} AND {scope_clause} AND (%s='' OR f.file_name ILIKE '%%'||%s||'%%')
                {folder_clause} ORDER BY {order}""",
                (user.userId,user.userId,user.userId,user.userId,user.companyId,user.userId,user.userId,user.userId,user.userId,*scope_args,query,query,*folder_args))
            return {"items": [self._file_view(dict(row), user.userId) for row in cursor.fetchall()]}

    @staticmethod
    def _file_view(row: dict, actor_id: str) -> dict:
        owner = row.get("owner_user_id") == actor_id or row.get("effective_permission") == "owner"; editor = row.get("effective_permission") == "editor"
        deleted = row.get("status") == "deleted"
        permissions = {"download":False,"favorite":False,"rename":False,"newVersion":False,"move":False,"share":False,"trash":False,"restore":owner} if deleted else {"download":True,"favorite":True,"rename":owner or editor,"newVersion":owner or editor,"move":owner,"share":owner,"trash":owner,"restore":False}
        return {"id":row.get("id"),"file_name":row.get("file_name"),"content_type":row.get("content_type"),"size_bytes":row.get("size_bytes"),"status":row.get("status"),
            "folderId":row.get("folder_id"),"fileName":row.get("file_name"),"contentType":row.get("content_type"),"sizeBytes":row.get("size_bytes"),
            "currentVersion":row.get("current_version",1),"version":row.get("version",0),"owner_user_id":row.get("owner_user_id"),"isFavorite":bool(row.get("is_favorite")),
            "created_at":row.get("created_at"),"updated_at":row.get("updated_at"),"permissions":permissions}

    def create_file(self, user: AuthUserSummary, file_name: str, content_type: str, content: bytes, folder_id: str | None = None, storage: WorkspaceFileStorage | None = None) -> dict:
        storage = storage or WorkspaceFileStorage(); file_name=storage.safe_name(file_name); storage.validate(file_name,content_type,content); item_id = f"wfl_{uuid4().hex[:12]}"; storage_key = storage.write(content); digest = sha256(content).hexdigest()
        try:
            with self.db.connect() as conn, conn.cursor() as cursor:
                if folder_id: self._lock_owned_folder(cursor,user,folder_id)
                cursor.execute("INSERT INTO workspace_files (id,company_id,owner_user_id,folder_id,file_name,content_type,size_bytes,content,checksum,current_version,version,status,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,NULL,%s,1,0,'active',NOW(),NOW())", (item_id,user.companyId,user.userId,folder_id,file_name,content_type,len(content),digest))
                cursor.execute("INSERT INTO workspace_file_versions(id,file_id,version_no,file_name,content_type,size_bytes,checksum,storage_key,created_by_user_id) VALUES(%s,%s,1,%s,%s,%s,%s,%s,%s)", (f"wfv_{uuid4().hex[:12]}",item_id,file_name,content_type,len(content),digest,storage_key,user.userId))
                self._audit(cursor,user,"file",item_id,"workspace.file.uploaded",None,"active",json.dumps({"version":1}))
                conn.commit()
        except Exception:
            storage.unlink(storage_key)
            raise
        return self.file_metadata(user,item_id)

    def file_metadata(self, user: AuthUserSummary, item_id: str, include_content: bool = False) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            row=self._lock_file_access(cursor,user,item_id,"detail","active",lock=False)
        return self._file_view(row,user.userId)

    def file_detail(self, user: AuthUserSummary, item_id: str, include_deleted: bool = False) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            status="deleted" if include_deleted else "active"; action="restore" if include_deleted else "detail"
            item=self._file_view(self._lock_file_access(cursor,user,item_id,action,status,lock=False),user.userId)
            cursor.execute("SELECT version_no,file_name,content_type,size_bytes,created_at FROM workspace_file_versions WHERE file_id=%s ORDER BY version_no DESC",(item_id,)); versions=[dict(x) for x in cursor.fetchall()]
            cursor.execute("""SELECT s.target_type,s.target_id,s.permission,COALESCE(u.name,d.name,'') AS target_name
                FROM workspace_file_shares s LEFT JOIN users u ON s.target_type='user' AND u.id=s.target_id LEFT JOIN departments d ON s.target_type='department' AND d.id=s.target_id
                WHERE s.file_id=%s AND s.status='active' ORDER BY s.target_type,target_name,s.target_id""",(item_id,)); shares=[dict(x) for x in cursor.fetchall()]
            cursor.execute("SELECT actor_user_name,event,created_at FROM audit_logs WHERE company_id=%s AND target_type='file' AND target_id=%s ORDER BY created_at DESC LIMIT 50",(user.companyId,item_id)); activity=[dict(x) for x in cursor.fetchall()]
        return {**item,"versions":versions,"shares":shares,"activity":activity}

    def update_file(self, user: AuthUserSummary, item_id: str, payload: FilePatchPayload) -> dict:
        moving = "folderId" in payload.model_fields_set
        file_name=WorkspaceFileStorage.safe_name(payload.fileName) if payload.fileName is not None else None
        with self.db.connect() as conn, conn.cursor() as cursor:
            if moving and payload.folderId: self._lock_owned_folder(cursor,user,payload.folderId)
            current=self._lock_file_access(cursor,user,item_id,"move" if moving else "rename","active")
            if file_name is not None:
                try: WorkspaceFileStorage.validate_name_type(file_name,current["content_type"])
                except (ContentTypeRejected,ValueError): raise HTTPException(status_code=400,detail={"code":"FILE_NAME_INVALID","userMessage":"파일 이름과 형식을 확인하세요."})
            if payload.expectedVersion is not None and current["version"] != payload.expectedVersion: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
            cursor.execute("UPDATE workspace_files SET file_name=COALESCE(%s,file_name),folder_id=CASE WHEN %s THEN %s ELSE folder_id END,version=version+1,updated_at=NOW() WHERE id=%s AND version=%s",(file_name,moving,payload.folderId,item_id,current["version"]))
            if cursor.rowcount != 1: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
            event="workspace.file.moved" if moving else "workspace.file.renamed"; self._audit(cursor,user,"file",item_id,event,"active","active",json.dumps({"changed":True})); conn.commit()
        return self.file_metadata(user,item_id)

    def create_file_version(self, user, item_id, file_name, content_type, content, expected_version, storage):
        file_name=storage.safe_name(file_name); storage.validate(file_name,content_type,content); storage_key=storage.write(content); digest=sha256(content).hexdigest()
        try:
            with self.db.connect() as conn, conn.cursor() as cursor:
                current=self._lock_file_access(cursor,user,item_id,"version","active")
                if current["version"] != expected_version: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
                cursor.execute("UPDATE workspace_files SET file_name=%s,content_type=%s,size_bytes=%s,checksum=%s,current_version=current_version+1,version=version+1,updated_at=NOW() WHERE id=%s AND version=%s RETURNING current_version",(file_name,content_type,len(content),digest,item_id,expected_version)); row=cursor.fetchone()
                if not row: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
                cursor.execute("INSERT INTO workspace_file_versions(id,file_id,version_no,file_name,content_type,size_bytes,checksum,storage_key,created_by_user_id) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",(f"wfv_{uuid4().hex[:12]}",item_id,row["current_version"],file_name,content_type,len(content),digest,storage_key,user.userId)); self._audit(cursor,user,"file",item_id,"workspace.file.version_created",None,None,json.dumps({"version":row["current_version"]})); conn.commit()
        except Exception: storage.unlink(storage_key); raise
        return self.file_detail(user,item_id)

    def delete_file(self, user: AuthUserSummary, item_id: str, expected_version: int | None = None) -> None:
        with self.db.connect() as conn, conn.cursor() as cursor:
            current=self._lock_file_access(cursor,user,item_id,"trash","active")
            if expected_version is not None and current["version"] != expected_version: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"파일 상태가 변경되었습니다."})
            cursor.execute("UPDATE workspace_files SET status='deleted',deleted_at=NOW(),version=version+1,updated_at=NOW() WHERE id=%s AND version=%s",(item_id,current["version"]))
            if cursor.rowcount != 1: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"파일 상태가 변경되었습니다."})
            self._audit(cursor,user,"file",item_id,"workspace.file.trashed","active","deleted",json.dumps({"recoverable":True})); conn.commit()

    def restore_file(self, user, item_id, expected_version):
        with self.db.connect() as conn, conn.cursor() as cursor:
            current=self._lock_file_access(cursor,user,item_id,"restore","deleted")
            if current["version"] != expected_version: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"파일 상태가 변경되었습니다."})
            cursor.execute("UPDATE workspace_files SET status='active',deleted_at=NULL,version=version+1,updated_at=NOW() WHERE id=%s AND version=%s",(item_id,expected_version))
            if cursor.rowcount != 1: raise self._missing()
            self._audit(cursor,user,"file",item_id,"workspace.file.restored","deleted","active",json.dumps({"restored":True})); conn.commit()
        return self.file_metadata(user,item_id)

    def set_file_favorite(self,user,item_id,enabled):
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._lock_file_access(cursor,user,item_id,"favorite","active")
            if enabled: cursor.execute("INSERT INTO workspace_file_favorites(file_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(item_id,user.userId))
            else: cursor.execute("DELETE FROM workspace_file_favorites WHERE file_id=%s AND user_id=%s",(item_id,user.userId))
            self._audit(cursor,user,"file",item_id,"workspace.file.favorite_set" if enabled else "workspace.file.favorite_cleared",None,None,json.dumps({"enabled":enabled})); conn.commit()
        return {"isFavorite":enabled}

    def save_file_shares(self,user,item_id,payload:FileShareSnapshotPayload):
        with self.db.connect() as conn, conn.cursor() as cursor:
            item=self._lock_file_access(cursor,user,item_id,"share","active")
            if item["version"] != payload.expectedVersion: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
            cursor.execute("UPDATE workspace_files SET version=version+1,updated_at=NOW() WHERE id=%s AND version=%s",(item_id,payload.expectedVersion))
            if cursor.rowcount != 1: raise HTTPException(status_code=409,detail={"code":"FILE_VERSION_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다."})
            cursor.execute("UPDATE workspace_file_shares SET status='inactive',updated_at=NOW() WHERE file_id=%s",(item_id,))
            for share in payload.shares:
                if share.targetType=="user" and share.targetId==user.userId: raise HTTPException(status_code=400,detail={"code":"FILE_SHARE_SELF","userMessage":"자기 자신은 공유 대상에 추가할 수 없습니다."})
                table="users" if share.targetType=="user" else "departments"; cursor.execute(f"SELECT id FROM {table} WHERE id=%s AND company_id=%s AND status='active' FOR SHARE",(share.targetId,user.companyId))
                if not cursor.fetchone(): raise self._missing()
                cursor.execute("INSERT INTO workspace_file_shares(id,file_id,shared_by_user_id,target_type,target_id,permission,status) VALUES(%s,%s,%s,%s,%s,%s,'active') ON CONFLICT(file_id,target_type,target_id) WHERE status='active' DO UPDATE SET permission=EXCLUDED.permission,shared_by_user_id=EXCLUDED.shared_by_user_id,updated_at=NOW()",(f"wfs_{uuid4().hex[:12]}",item_id,user.userId,share.targetType,share.targetId,share.permission))
            self._audit(cursor,user,"file",item_id,"workspace.file.shared",None,None,json.dumps({"shareCount":len(payload.shares)})); conn.commit()
        return self.file_detail(user,item_id)

    def download_file(self,user,item_id,version,storage):
        with self.db.connect() as conn, conn.cursor() as cursor:
            item=self._lock_file_access(cursor,user,item_id,"download","active",lock=False)
            cursor.execute("SELECT v.file_name,v.content_type,v.storage_key,f.content FROM workspace_file_versions v JOIN workspace_files f ON f.id=v.file_id WHERE v.file_id=%s AND v.version_no=COALESCE(%s,%s)",(item_id,version,item["current_version"])); row=cursor.fetchone()
            if not row: raise self._missing()
            try: content = storage.read(row["storage_key"]) if row["storage_key"] else row["content"]
            except (OSError,ValueError): raise HTTPException(status_code=404,detail={"code":"FILE_CONTENT_NOT_FOUND","userMessage":"파일 원본을 찾을 수 없습니다."})
            if content is None: raise self._missing()
            self._audit(cursor,user,"file",item_id,"workspace.file.downloaded",None,None,json.dumps({"version":version or item["current_version"]})); conn.commit()
        return {"file_name":row["file_name"],"content_type":row["content_type"],"content":content}

    def list_file_folders(self,user):
        with self.db.connect() as conn, conn.cursor() as cursor: cursor.execute("SELECT id,parent_id,name,version,created_at,updated_at FROM workspace_folders WHERE company_id=%s AND owner_user_id=%s AND status='active' ORDER BY lower(name)",(user.companyId,user.userId)); return {"items":[dict(x) for x in cursor.fetchall()]}
    def create_file_folder(self,user,payload:FolderCreatePayload):
        folder_id=f"wfd_{uuid4().hex[:12]}"
        try:
            with self.db.connect() as conn, conn.cursor() as cursor:
                if payload.parentId: self._lock_owned_folder(cursor,user,payload.parentId)
                cursor.execute("INSERT INTO workspace_folders(id,company_id,owner_user_id,parent_id,name) VALUES(%s,%s,%s,%s,%s)",(folder_id,user.companyId,user.userId,payload.parentId,payload.name)); self._audit(cursor,user,"folder",folder_id,"workspace.folder.created",None,"active",json.dumps({"created":True})); conn.commit()
        except UniqueViolation: raise HTTPException(status_code=409,detail={"code":"FOLDER_NAME_CONFLICT","userMessage":"같은 위치에 같은 이름의 폴더가 있습니다."})
        return {"id":folder_id,"name":payload.name,"parentId":payload.parentId,"version":0}
    def rename_file_folder(self,user,folder_id,payload:FolderPatchPayload):
        try:
            with self.db.connect() as conn, conn.cursor() as cursor:
                current=self._lock_owned_folder(cursor,user,folder_id)
                if current["version"] != payload.expectedVersion: raise HTTPException(status_code=409,detail={"code":"FOLDER_VERSION_CONFLICT","userMessage":"폴더 상태가 변경되었습니다."})
                cursor.execute("UPDATE workspace_folders SET name=%s,version=version+1,updated_at=NOW() WHERE id=%s AND version=%s RETURNING id,parent_id,name,version",(payload.name,folder_id,payload.expectedVersion)); row=cursor.fetchone()
                if not row: raise HTTPException(status_code=409,detail={"code":"FOLDER_VERSION_CONFLICT","userMessage":"폴더 상태가 변경되었습니다."})
                self._audit(cursor,user,"folder",folder_id,"workspace.folder.renamed","active","active",json.dumps({"changed":True})); conn.commit()
        except UniqueViolation: raise HTTPException(status_code=409,detail={"code":"FOLDER_NAME_CONFLICT","userMessage":"같은 위치에 같은 이름의 폴더가 있습니다."})
        return dict(row)
    def delete_file_folder(self,user,folder_id,expected_version):
        with self.db.connect() as conn, conn.cursor() as cursor:
            current=self._lock_owned_folder(cursor,user,folder_id)
            if current["version"] != expected_version: raise HTTPException(status_code=409,detail={"code":"FOLDER_VERSION_CONFLICT","userMessage":"폴더 상태가 변경되었습니다."})
            cursor.execute("SELECT id FROM workspace_folders WHERE parent_id=%s AND status='active' FOR UPDATE",(folder_id,))
            child=cursor.fetchone(); cursor.execute("SELECT id FROM workspace_files WHERE folder_id=%s AND status='active' FOR UPDATE",(folder_id,)); file_row=cursor.fetchone()
            if child or file_row: raise HTTPException(status_code=409,detail={"code":"FOLDER_NOT_EMPTY","userMessage":"빈 폴더만 삭제할 수 있습니다."})
            cursor.execute("UPDATE workspace_folders SET status='deleted',version=version+1,updated_at=NOW() WHERE id=%s AND version=%s",(folder_id,expected_version));
            if cursor.rowcount != 1: raise self._missing()
            self._audit(cursor,user,"folder",folder_id,"workspace.folder.deleted","active","deleted",json.dumps({"empty":True})); conn.commit()

    def profile(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT account.id,account.name,account.email,company.name AS company_name,
                       COALESCE(department.name,'') AS department_name,role.name AS role_name,
                       COALESCE(personal.external_email,'') AS external_email,
                       COALESCE(personal.mobile_phone,'') AS mobile_phone,
                       COALESCE(personal.office_phone,'') AS office_phone,
                       COALESCE(personal.introduction,'') AS introduction,
                       COALESCE(personal.postal_code,'') AS postal_code,
                       COALESCE(personal.address_line1,'') AS address_line1,
                       COALESCE(personal.address_line2,'') AS address_line2,
                       COALESCE(personal.memo,'') AS memo,personal.anniversary,
                       personal.photo_content IS NOT NULL AS photo_available,
                       COALESCE(personal.version,0) AS personal_version
                FROM users account
                JOIN companies company ON company.id=account.company_id
                JOIN roles role ON role.id=account.role_id AND role.company_id=account.company_id
                LEFT JOIN departments department ON department.id=account.department_id AND department.company_id=account.company_id
                LEFT JOIN user_personal_profiles personal ON personal.owner_user_id=account.id AND personal.company_id=account.company_id
                WHERE account.id=%s AND account.company_id=%s AND account.status='active'
                """,
                (user.userId, user.companyId),
            )
            row = cursor.fetchone()
            if not row:
                raise self._missing()
            self._audit(cursor,user,"user",user.userId,"workspace.profile.viewed",None,None,json.dumps({"source":"personal_settings"},separators=(",",":")))
            conn.commit()
        return {
            "userId": row["id"], "name": row["name"], "email": row["email"],
            "companyName": row["company_name"], "departmentName": row["department_name"], "roleName": row["role_name"],
            "externalEmail": row["external_email"], "mobilePhone": row["mobile_phone"], "officePhone": row["office_phone"],
            "introduction": row["introduction"], "postalCode": row["postal_code"], "addressLine1": row["address_line1"],
            "addressLine2": row["address_line2"], "memo": row["memo"],
            "anniversary": row["anniversary"].isoformat() if row["anniversary"] else None,
            "photoAvailable": bool(row["photo_available"]), "version": int(row["personal_version"]),
        }

    @staticmethod
    def _personal_profile_row(cursor, user: AuthUserSummary, lock: bool = False):
        cursor.execute(
            "SELECT version,photo_content IS NOT NULL AS photo_available FROM user_personal_profiles WHERE owner_user_id=%s AND company_id=%s" + (" FOR UPDATE" if lock else ""),
            (user.userId,user.companyId),
        )
        return cursor.fetchone()

    @staticmethod
    def _profile_conflict() -> HTTPException:
        return HTTPException(status_code=409,detail={"code":"WORKSPACE_PROFILE_CONFLICT","userMessage":"다른 화면에서 프로필이 변경되었습니다. 최신 정보를 다시 불러오세요."})

    def save_personal_profile(self, user: AuthUserSummary, payload: PersonalProfilePayload) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            current = self._personal_profile_row(cursor,user,lock=True)
            if (int(current["version"]) if current else 0) != payload.expectedVersion:
                raise self._profile_conflict()
            values = (payload.externalEmail,payload.mobilePhone,payload.officePhone,payload.introduction,payload.postalCode,payload.addressLine1,payload.addressLine2,payload.memo,payload.anniversary)
            if current is None:
                cursor.execute(
                    "INSERT INTO user_personal_profiles(owner_user_id,company_id,external_email,mobile_phone,office_phone,introduction,postal_code,address_line1,address_line2,memo,anniversary,version,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,NOW(),NOW())",
                    (user.userId,user.companyId,*values),
                )
            else:
                cursor.execute(
                    "UPDATE user_personal_profiles SET external_email=%s,mobile_phone=%s,office_phone=%s,introduction=%s,postal_code=%s,address_line1=%s,address_line2=%s,memo=%s,anniversary=%s,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND company_id=%s AND version=%s",
                    (*values,user.userId,user.companyId,payload.expectedVersion),
                )
                if cursor.rowcount != 1:
                    raise self._profile_conflict()
            self._audit(cursor,user,"user_personal_profile",user.userId,"workspace.profile.updated",str(payload.expectedVersion),str(payload.expectedVersion+1),json.dumps({"changedFields":["externalEmail","mobilePhone","officePhone","introduction","postalCode","addressLine1","addressLine2","memo","anniversary"]},separators=(",",":")))
            conn.commit()
        return self.profile(user)

    def profile_photo(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT photo_content,photo_content_type FROM user_personal_profiles WHERE owner_user_id=%s AND company_id=%s AND photo_content IS NOT NULL",(user.userId,user.companyId))
            row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404,detail={"code":"PROFILE_PHOTO_NOT_FOUND","userMessage":"등록된 프로필 사진이 없습니다."})
        return {"content":bytes(row["photo_content"]),"content_type":row["photo_content_type"]}

    def save_profile_photo(self, user: AuthUserSummary, content: bytes, content_type: str, expected_version: int) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            current = self._personal_profile_row(cursor,user,lock=True)
            if (int(current["version"]) if current else 0) != expected_version:
                raise self._profile_conflict()
            if current is None:
                cursor.execute("INSERT INTO user_personal_profiles(owner_user_id,company_id,photo_content,photo_content_type,version,created_at,updated_at) VALUES(%s,%s,%s,%s,1,NOW(),NOW())",(user.userId,user.companyId,content,content_type))
            else:
                cursor.execute("UPDATE user_personal_profiles SET photo_content=%s,photo_content_type=%s,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND company_id=%s AND version=%s",(content,content_type,user.userId,user.companyId,expected_version))
                if cursor.rowcount != 1:
                    raise self._profile_conflict()
            self._audit(cursor,user,"user_personal_profile",user.userId,"workspace.profile.photo.updated",str(expected_version),str(expected_version+1),json.dumps({"contentType":content_type,"sizeBytes":len(content)},separators=(",",":")))
            conn.commit()
        return self.profile(user)

    def delete_profile_photo(self, user: AuthUserSummary, expected_version: int) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            current = self._personal_profile_row(cursor,user,lock=True)
            if not current or int(current["version"]) != expected_version:
                raise self._profile_conflict()
            cursor.execute("UPDATE user_personal_profiles SET photo_content=NULL,photo_content_type=NULL,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND company_id=%s AND version=%s",(user.userId,user.companyId,expected_version))
            if cursor.rowcount != 1:
                raise self._profile_conflict()
            self._audit(cursor,user,"user_personal_profile",user.userId,"workspace.profile.photo.deleted",str(expected_version),str(expected_version+1),None)
            conn.commit()
        return self.profile(user)

    def _preference_row(self, cursor, user: AuthUserSummary, lock: bool = False):
        cursor.execute(
            "SELECT locale,timezone,start_page,version FROM user_workspace_preferences WHERE owner_user_id=%s AND company_id=%s" + (" FOR UPDATE" if lock else ""),
            (user.userId,user.companyId),
        )
        return cursor.fetchone()

    @staticmethod
    def _preference_view(row) -> dict:
        if not row:
            return {"locale":"ko-KR","timezone":"Asia/Seoul","startPage":"home","version":0}
        return {"locale":row["locale"],"timezone":row["timezone"],"startPage":row["start_page"],"version":row["version"]}

    def get_preferences(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            result = self._preference_view(self._preference_row(cursor,user))
            self._audit(cursor,user,"preference",user.userId,"workspace.preferences.viewed",None,None,json.dumps({"version":result["version"]},separators=(",",":")))
            conn.commit()
        return result

    def save_preferences(self, user: AuthUserSummary, payload: PreferencePayload) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            current_row = self._preference_row(cursor,user,lock=True)
            current = self._preference_view(current_row)
            if current["version"] != payload.expectedVersion:
                raise HTTPException(status_code=409,detail={"code":"WORKSPACE_PREFERENCES_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다. 최신 설정을 다시 불러오세요."})
            if current_row is None:
                cursor.execute(
                    "INSERT INTO user_workspace_preferences(owner_user_id,company_id,locale,timezone,start_page,version,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,1,NOW(),NOW()) ON CONFLICT(owner_user_id) DO NOTHING",
                    (user.userId,user.companyId,payload.locale,payload.timezone,payload.startPage),
                )
                if cursor.rowcount != 1:
                    raise HTTPException(status_code=409,detail={"code":"WORKSPACE_PREFERENCES_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다. 최신 설정을 다시 불러오세요."})
            else:
                cursor.execute(
                    "UPDATE user_workspace_preferences SET locale=%s,timezone=%s,start_page=%s,version=version+1,updated_at=NOW() WHERE owner_user_id=%s AND company_id=%s AND version=%s",
                    (payload.locale,payload.timezone,payload.startPage,user.userId,user.companyId,payload.expectedVersion),
                )
                if cursor.rowcount != 1:
                    raise HTTPException(status_code=409,detail={"code":"WORKSPACE_PREFERENCES_CONFLICT","userMessage":"다른 변경이 먼저 저장되었습니다. 최신 설정을 다시 불러오세요."})
            changed = [key for key,before,after in (("locale",current["locale"],payload.locale),("timezone",current["timezone"],payload.timezone),("startPage",current["startPage"],payload.startPage)) if before != after]
            self._audit(cursor,user,"preference",user.userId,"workspace.preferences.updated",str(current["version"]),str(current["version"]+1),json.dumps({"changedFields":changed},separators=(",",":")))
            result = self._preference_view(self._preference_row(cursor,user))
            conn.commit()
        return result

    def list_help(self, user: AuthUserSummary, query: str = "", category: str | None = None) -> dict:
        normalized_query = query.strip()
        search = f"%{normalized_query}%"
        category_clause = " AND category=%s" if category is not None else ""
        params = (normalized_query,search,search,search) + ((category,) if category is not None else ())
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id,code,title,category,audience,content,version,published_at,updated_at
                FROM help_policy_documents
                WHERE status='published' AND audience IN ('user','both','all')
                  AND (%s='' OR LOWER(title) LIKE LOWER(%s) OR LOWER(code) LIKE LOWER(%s) OR LOWER(content) LIKE LOWER(%s))
                  {category_clause}
                ORDER BY updated_at DESC,id
                """,
                params,
            )
            items = [dict(row) for row in cursor.fetchall()]
            self._audit(cursor,user,"help",user.userId,"workspace.help.viewed",None,None,json.dumps({"category":category or "all","resultCount":len(items)},separators=(",",":")))
            conn.commit()
        return {"items":items}

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
