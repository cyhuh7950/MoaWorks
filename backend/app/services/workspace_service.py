from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import ContactPayload, PreferencePayload, SchedulePayload
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
            cursor.execute("SELECT * FROM user_schedule_events WHERE id=%s AND owner_user_id=%s AND status='active'", (item_id, user.userId))
            row = cursor.fetchone()
            if not row:
                raise self._missing()
            attendees = self._schedule_attendees(cursor, [item_id])
        return self._schedule_record(dict(row), attendees[item_id])

    def list_schedules(self, user: AuthUserSummary) -> dict:
        with self.db.connect() as conn, conn.cursor() as cursor:
            cursor.execute("SELECT * FROM user_schedule_events WHERE owner_user_id=%s AND status='active' ORDER BY starts_at", (user.userId,))
            rows = [dict(row) for row in cursor.fetchall()]
            attendees = self._schedule_attendees(cursor, [row["id"] for row in rows])
        return {"items": [self._schedule_record(row, attendees[row["id"]]) for row in rows]}

    def create_schedule(self, user: AuthUserSummary, payload: SchedulePayload) -> dict:
        item_id = f"sch_{uuid4().hex[:12]}"
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._validate_schedule_attendees(cursor, user, payload.attendeeUserIds)
            cursor.execute(
                "INSERT INTO user_schedule_events (id,company_id,owner_user_id,title,starts_at,ends_at,description,location,repeat_type,repeat_until,alert_minutes,timezone,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())",
                (item_id,user.companyId,user.userId,payload.title,payload.startsAt,payload.endsAt,payload.description,payload.location,payload.repeatType,payload.repeatUntil,Jsonb(payload.alertMinutes),payload.timezone),
            )
            self._replace_schedule_attendees(cursor, item_id, user.companyId, payload.attendeeUserIds)
            self._audit(cursor,user,"schedule",item_id,"workspace.schedule.created",None,"active")
            conn.commit()
        return self._owned_schedule(user,item_id)

    def update_schedule(self, user: AuthUserSummary, item_id: str, payload: SchedulePayload) -> dict:
        current = self._owned_schedule(user,item_id)
        with self.db.connect() as conn, conn.cursor() as cursor:
            self._validate_schedule_attendees(cursor, user, payload.attendeeUserIds)
            cursor.execute(
                "UPDATE user_schedule_events SET title=%s,starts_at=%s,ends_at=%s,description=%s,location=%s,repeat_type=%s,repeat_until=%s,alert_minutes=%s,timezone=%s,updated_at=NOW() WHERE id=%s AND owner_user_id=%s AND status='active'",
                (payload.title,payload.startsAt,payload.endsAt,payload.description,payload.location,payload.repeatType,payload.repeatUntil,Jsonb(payload.alertMinutes),payload.timezone,item_id,user.userId),
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
