from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailBulkRequest,
    MailBulkResponse,
    MailCategoryRequest,
    MailDetailResponse,
    MailDraftRequest,
    MailListQuery,
    MailListResponse,
    MailRecipientView,
    MailSendRequest,
    MailSendResponse,
    MailStorageResponse,
    MailStatusResponse,
    MailSummary,
    MessengerMessageListResponse,
    MessengerMessageSendRequest,
    MessengerMessageSendResponse,
    MessengerMessageView,
    MessengerReadResponse,
    MessengerRoomCreateRequest,
    MessengerRoomDetailResponse,
    MessengerRoomListResponse,
    MessengerRoomSummary,
)
from app.services.postgres_service import PostgresService


class MailMessengerService:
    def __init__(self) -> None:
        self.db = PostgresService()

    def list_inbox(self, actor: AuthUserSummary, query: MailListQuery | None = None) -> MailListResponse:
        if query is not None:
            return self._list_inbox_query(actor, query)
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        m.id AS mail_id,
                        m.sender_account_id AS account_id,
                        m.sender_email,
                        m.subject,
                        m.status,
                        m.sent_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        r.is_read,
                        r.is_starred,
                        r.received_at,
                        COALESCE(r.inbox_category, 'primary') AS category
                    FROM mail_recipients r
                    JOIN mail_messages m ON m.id = r.message_id
                    WHERE m.company_id = %s
                      AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                      AND m.status = 'sent'
                      AND r.deleted_at IS NULL
                    ORDER BY COALESCE(r.received_at, m.sent_at, m.created_at) DESC
                    """,
                    (actor.companyId, actor.userId, actor.userEmail.lower()),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
                return MailListResponse(mails=mails, total=len(mails), limit=50, offset=0, hasMore=False)

    def list_sent(self, actor: AuthUserSummary, query: MailListQuery | None = None) -> MailListResponse:
        if query is not None:
            return self._list_sender_query(actor, query, mailbox="sent")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        m.id AS mail_id,
                        m.sender_account_id AS account_id,
                        m.sender_email,
                        m.subject,
                        m.status,
                        m.sent_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        TRUE AS is_read,
                        FALSE AS is_starred,
                        NULL AS received_at,
                        'primary' AS category
                    FROM mail_messages m
                    WHERE m.company_id = %s
                      AND m.sender_user_id = %s
                      AND m.status = 'sent'
                      AND m.sender_deleted_at IS NULL
                    ORDER BY COALESCE(m.sent_at, m.created_at) DESC
                    """,
                    (actor.companyId, actor.userId),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
                return MailListResponse(mails=mails, total=len(mails), limit=50, offset=0, hasMore=False)

    def list_drafts(self, actor: AuthUserSummary, query: MailListQuery | None = None) -> MailListResponse:
        if query is not None:
            return self._list_sender_query(actor, query, mailbox="draft")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        m.id AS mail_id,
                        m.sender_account_id AS account_id,
                        m.sender_email,
                        m.subject,
                        m.status,
                        m.sent_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        TRUE AS is_read,
                        FALSE AS is_starred,
                        NULL AS received_at,
                        'primary' AS category
                    FROM mail_messages m
                    WHERE m.company_id = %s
                      AND m.sender_user_id = %s
                      AND m.status = 'draft'
                      AND m.sender_deleted_at IS NULL
                    ORDER BY COALESCE(m.updated_at, m.created_at) DESC
                    """,
                    (actor.companyId, actor.userId),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
                return MailListResponse(mails=mails, total=len(mails), limit=50, offset=0, hasMore=False)

    def _list_inbox_query(self, actor: AuthUserSummary, query: MailListQuery) -> MailListResponse:
        self.db.ensure_migrations_applied()
        conditions = [
            "m.company_id = %s",
            "(r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)",
            "m.status = 'sent'",
            "r.deleted_at IS NULL",
        ]
        params: list[object] = [actor.companyId, actor.userId, actor.userEmail.lower()]
        if query.read != "all":
            conditions.append("r.is_read = %s")
            params.append(query.read == "read")
        if query.starred != "all":
            conditions.append("r.is_starred = %s")
            params.append(query.starred == "starred")
        if query.attachment == "with":
            conditions.append("m.attachment_count > 0")
        elif query.attachment == "without":
            conditions.append("m.attachment_count = 0")
        if query.category != "all":
            conditions.append("COALESCE(r.inbox_category, 'primary') = %s")
            params.append(query.category)
        if query.q:
            conditions.append("CONCAT_WS(' ', m.subject, m.sender_email, m.body_text) ILIKE %s")
            params.append(f"%{query.q}%")
        where_sql = " AND ".join(conditions)
        order_sql = self._mail_sort_sql(query.sort, mailbox="inbox")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT COUNT(*)::BIGINT AS total FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id WHERE {where_sql}",
                    tuple(params),
                )
                count_row = cursor.fetchone() or {"total": 0}
                total = int(count_row["total"] or 0)
                cursor.execute(
                    f"""
                    SELECT
                        m.id AS mail_id,
                        m.sender_account_id AS account_id,
                        m.sender_email,
                        m.subject,
                        LEFT(COALESCE(m.body_text, ''), 240) AS preview_text,
                        m.status,
                        m.sent_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        r.is_read,
                        r.is_starred,
                        r.received_at,
                        COALESCE(r.inbox_category, 'primary') AS category
                    FROM mail_recipients r
                    JOIN mail_messages m ON m.id = r.message_id
                    WHERE {where_sql}
                    ORDER BY {order_sql}
                    LIMIT %s OFFSET %s
                    """,
                    tuple([*params, query.limit, query.offset]),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
        return MailListResponse(
            mails=mails,
            total=total,
            limit=query.limit,
            offset=query.offset,
            hasMore=query.offset + len(mails) < total,
        )

    def _list_sender_query(self, actor: AuthUserSummary, query: MailListQuery, *, mailbox: str) -> MailListResponse:
        self.db.ensure_migrations_applied()
        status_value = "draft" if mailbox == "draft" else "sent"
        conditions = [
            "m.company_id = %s",
            "m.sender_user_id = %s",
            "m.status = %s",
            "m.sender_deleted_at IS NULL",
        ]
        params: list[object] = [actor.companyId, actor.userId, status_value]
        if query.attachment == "with":
            conditions.append("m.attachment_count > 0")
        elif query.attachment == "without":
            conditions.append("m.attachment_count = 0")
        if query.q:
            conditions.append("CONCAT_WS(' ', m.subject, m.sender_email, m.body_text) ILIKE %s")
            params.append(f"%{query.q}%")
        where_sql = " AND ".join(conditions)
        order_sql = self._mail_sort_sql(query.sort, mailbox=mailbox)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT COUNT(*)::BIGINT AS total FROM mail_messages m WHERE {where_sql}",
                    tuple(params),
                )
                count_row = cursor.fetchone() or {"total": 0}
                total = int(count_row["total"] or 0)
                cursor.execute(
                    f"""
                    SELECT
                        m.id AS mail_id,
                        m.sender_account_id AS account_id,
                        m.sender_email,
                        m.subject,
                        LEFT(COALESCE(m.body_text, ''), 240) AS preview_text,
                        m.status,
                        m.sent_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        TRUE AS is_read,
                        FALSE AS is_starred,
                        NULL AS received_at,
                        'primary' AS category
                    FROM mail_messages m
                    WHERE {where_sql}
                    ORDER BY {order_sql}
                    LIMIT %s OFFSET %s
                    """,
                    tuple([*params, query.limit, query.offset]),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
        return MailListResponse(
            mails=mails,
            total=total,
            limit=query.limit,
            offset=query.offset,
            hasMore=query.offset + len(mails) < total,
        )

    @staticmethod
    def _mail_sort_sql(sort: str, *, mailbox: str) -> str:
        date_expression = "COALESCE(m.updated_at, m.created_at)" if mailbox == "draft" else (
            "COALESCE(r.received_at, m.sent_at, m.created_at)" if mailbox == "inbox" else "COALESCE(m.sent_at, m.created_at)"
        )
        return {
            "date_desc": f"{date_expression} DESC, m.id DESC",
            "date_asc": f"{date_expression} ASC, m.id ASC",
            "sender_asc": f"LOWER(m.sender_email) ASC, {date_expression} DESC, m.id DESC",
            "subject_asc": f"LOWER(m.subject) ASC, {date_expression} DESC, m.id DESC",
        }[sort]

    def get_mail_storage(self, actor: AuthUserSummary) -> MailStorageResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    WITH accessible_messages AS (
                        SELECT DISTINCT m.id, m.subject, m.body_text, m.body_html
                        FROM mail_messages m
                        LEFT JOIN mail_recipients r ON r.message_id = m.id
                        WHERE m.company_id = %s
                          AND (
                            m.sender_user_id = %s
                            OR r.recipient_user_id = %s
                            OR LOWER(r.recipient_email) = %s
                          )
                    ), message_sizes AS (
                        SELECT
                            am.id,
                            OCTET_LENGTH(COALESCE(am.subject, ''))
                            + OCTET_LENGTH(COALESCE(am.body_text, ''))
                            + OCTET_LENGTH(COALESCE(am.body_html, ''))
                            + COALESCE(SUM(a.size_bytes), 0) AS used_bytes
                        FROM accessible_messages am
                        LEFT JOIN mail_attachments a ON a.message_id = am.id
                        GROUP BY am.id, am.subject, am.body_text, am.body_html
                    ), usage AS (
                        SELECT COALESCE(SUM(used_bytes), 0)::BIGINT AS used_bytes
                        FROM message_sizes
                    )
                    SELECT ma.quota_mb, usage.used_bytes
                    FROM mail_accounts ma
                    JOIN users u ON u.id = ma.user_id
                    CROSS JOIN usage
                    WHERE ma.user_id = %s
                      AND u.company_id = %s
                      AND ma.status = 'active'
                    """,
                    (
                        actor.companyId,
                        actor.userId,
                        actor.userId,
                        actor.userEmail.lower(),
                        actor.userId,
                        actor.companyId,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            raise ValueError("활성 메일 계정을 찾을 수 없습니다.")
        used_bytes = max(0, int(row["used_bytes"] or 0))
        quota_bytes = max(0, int(row["quota_mb"] or 0) * 1024 * 1024)
        usage_percent = round((used_bytes / quota_bytes) * 100, 2) if quota_bytes else 0.0
        return MailStorageResponse(
            usedBytes=used_bytes,
            quotaBytes=quota_bytes,
            usagePercent=usage_percent,
        )

    def get_mail(self, actor: AuthUserSummary, mail_id: str) -> MailDetailResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                message = self._fetch_accessible_mail(cursor, actor, mail_id)
                recipients = self._fetch_mail_recipients(cursor, mail_id)
                attachments = self._fetch_mail_attachments(cursor, mail_id)
        return self._to_mail_detail(message, recipients, attachments)

    def send_mail(self, actor: AuthUserSummary, payload: MailSendRequest) -> MailSendResponse:
        if not payload.to and not payload.cc and not payload.bcc:
            raise ValueError("수신자를 1명 이상 입력해야 합니다.")
        return self._save_mail(actor, payload, status_value="sent")

    def save_draft(self, actor: AuthUserSummary, payload: MailDraftRequest) -> MailSendResponse:
        return self._save_mail(actor, payload, status_value="draft")

    def mark_mail_read(self, actor: AuthUserSummary, mail_id: str) -> MailStatusResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_mail(cursor, actor, mail_id)
                cursor.execute(
                    """
                    UPDATE mail_recipients
                    SET is_read = TRUE,
                        read_at = %s
                    WHERE message_id = %s
                      AND (recipient_user_id = %s OR LOWER(recipient_email) = %s)
                    RETURNING is_read, is_starred
                    """,
                    (now, mail_id, actor.userId, actor.userEmail.lower()),
                )
                row = cursor.fetchone()
                if row is None:
                    raise PermissionError("받은 메일만 읽음 처리할 수 있습니다.")
            connection.commit()
        return MailStatusResponse(mailId=mail_id, status="read", isRead=row["is_read"], isStarred=row["is_starred"])

    def toggle_mail_star(self, actor: AuthUserSummary, mail_id: str) -> MailStatusResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_mail(cursor, actor, mail_id)
                cursor.execute(
                    """
                    UPDATE mail_recipients
                    SET is_starred = NOT is_starred
                    WHERE message_id = %s
                      AND (recipient_user_id = %s OR LOWER(recipient_email) = %s)
                    RETURNING is_read, is_starred
                    """,
                    (mail_id, actor.userId, actor.userEmail.lower()),
                )
                row = cursor.fetchone()
                if row is None:
                    raise PermissionError("받은 메일만 중요 표시할 수 있습니다.")
            connection.commit()
        return MailStatusResponse(mailId=mail_id, status="starred" if row["is_starred"] else "unstarred", isRead=row["is_read"], isStarred=row["is_starred"])

    def set_mail_category(self, actor: AuthUserSummary, mail_id: str, payload: MailCategoryRequest) -> MailStatusResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COALESCE(r.inbox_category, 'primary') AS category,
                           r.is_read, r.is_starred
                    FROM mail_recipients r
                    JOIN mail_messages m ON m.id = r.message_id
                    WHERE r.message_id = %s
                      AND m.company_id = %s
                      AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                    FOR UPDATE
                    """,
                    (mail_id, actor.companyId, actor.userId, actor.userEmail.lower()),
                )
                previous = cursor.fetchone()
                if previous is None:
                    raise PermissionError("받은 메일의 분류만 변경할 수 있습니다.")
                cursor.execute(
                    """
                    UPDATE mail_recipients AS r
                    SET inbox_category = %s
                    FROM mail_messages AS m
                    WHERE m.id = r.message_id
                      AND r.message_id = %s
                      AND m.company_id = %s
                      AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                    RETURNING r.is_read, r.is_starred
                    """,
                    (payload.category, mail_id, actor.companyId, actor.userId, actor.userEmail.lower()),
                )
                row = cursor.fetchone()
                if row is None:
                    raise PermissionError("받은 메일의 분류만 변경할 수 있습니다.")
                cursor.execute(
                    """
                    INSERT INTO audit_logs (
                        id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                        event, status_before, status_after, reason, created_at
                    ) VALUES (%s, %s, %s, %s, 'mail', %s, %s, %s, %s, NULL, %s)
                    """,
                    (
                        self._new_id("audit"), actor.companyId, actor.userId, actor.userName,
                        mail_id, "mail.category.changed", previous["category"], payload.category,
                        self._now(),
                    ),
                )
            connection.commit()
        return MailStatusResponse(mailId=mail_id, status=payload.category, isRead=row["is_read"], isStarred=row["is_starred"], category=payload.category)

    def bulk_mail(self, actor: AuthUserSummary, payload: MailBulkRequest) -> MailBulkResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        request_id = self._new_id("mailbulk")
        changed_count = 0
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                if payload.mailbox == "inbox":
                    cursor.execute(
                        """
                        SELECT
                            r.id AS recipient_id,
                            r.message_id AS mail_id,
                            r.is_read,
                            r.is_starred,
                            COALESCE(r.inbox_category, 'primary') AS category,
                            r.deleted_at
                        FROM mail_recipients r
                        JOIN mail_messages m ON m.id = r.message_id
                        WHERE r.message_id = ANY(%s)
                          AND m.company_id = %s
                          AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                          AND m.status = 'sent'
                        FOR UPDATE OF r
                        """,
                        (payload.mailIds, actor.companyId, actor.userId, actor.userEmail.lower()),
                    )
                else:
                    expected_status = "draft" if payload.mailbox == "draft" else "sent"
                    cursor.execute(
                        """
                        SELECT
                            m.id AS mail_id,
                            m.status,
                            m.sender_deleted_at
                        FROM mail_messages m
                        WHERE m.id = ANY(%s)
                          AND m.company_id = %s
                          AND m.sender_user_id = %s
                          AND m.status = %s
                        FOR UPDATE OF m
                        """,
                        (payload.mailIds, actor.companyId, actor.userId, expected_status),
                    )
                rows = cursor.fetchall()
                locked_ids = [row["mail_id"] for row in rows]
                if len(rows) != len(payload.mailIds) or set(locked_ids) != set(payload.mailIds):
                    raise PermissionError("요청한 모든 메일을 처리할 권한이 없습니다.")

                for row in rows:
                    if payload.mailbox == "inbox":
                        before = {
                            "isRead": bool(row["is_read"]),
                            "isStarred": bool(row["is_starred"]),
                            "category": row.get("category") or "primary",
                            "deleted": row.get("deleted_at") is not None,
                        }
                        after = dict(before)
                        if payload.action in {"read", "unread"}:
                            after["isRead"] = payload.action == "read"
                        elif payload.action in {"star", "unstar"}:
                            after["isStarred"] = payload.action == "star"
                        elif payload.action == "move":
                            after["category"] = payload.targetCategory
                        elif payload.action == "delete":
                            after["deleted"] = True
                        if before == after:
                            continue
                        if payload.action in {"read", "unread"}:
                            cursor.execute(
                                """
                                UPDATE mail_recipients
                                SET is_read = %s,
                                    read_at = CASE WHEN %s THEN %s ELSE NULL END
                                WHERE id = %s
                                """,
                                (after["isRead"], after["isRead"], now, row["recipient_id"]),
                            )
                        elif payload.action in {"star", "unstar"}:
                            cursor.execute(
                                "UPDATE mail_recipients SET is_starred = %s WHERE id = %s",
                                (after["isStarred"], row["recipient_id"]),
                            )
                        elif payload.action == "move":
                            cursor.execute(
                                "UPDATE mail_recipients SET inbox_category = %s WHERE id = %s",
                                (payload.targetCategory, row["recipient_id"]),
                            )
                        else:
                            cursor.execute(
                                "UPDATE mail_recipients SET deleted_at = %s, deleted_by_user_id = %s WHERE id = %s",
                                (now, actor.userId, row["recipient_id"]),
                            )
                    else:
                        before = {"deleted": row.get("sender_deleted_at") is not None}
                        after = {"deleted": True}
                        if before == after:
                            continue
                        cursor.execute(
                            """
                            UPDATE mail_messages
                            SET sender_deleted_at = %s,
                                sender_deleted_by_user_id = %s,
                                updated_at = %s
                            WHERE id = %s
                            """,
                            (now, actor.userId, now, row["mail_id"]),
                        )
                    self._write_mail_bulk_audit(
                        cursor,
                        actor,
                        row["mail_id"],
                        payload.action,
                        before,
                        after,
                        payload.mailbox,
                        request_id,
                    )
                    changed_count += 1
            connection.commit()
        return MailBulkResponse(
            action=payload.action,
            requestedCount=len(payload.mailIds),
            changedCount=changed_count,
            unchangedCount=len(payload.mailIds) - changed_count,
            targetCategory=payload.targetCategory,
        )

    def _write_mail_bulk_audit(
        self,
        cursor,
        actor: AuthUserSummary,
        target_id: str,
        action: str,
        before: dict,
        after: dict,
        mailbox: str,
        request_id: str,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                event, status_before, status_after, reason, created_at
            ) VALUES (%s, %s, %s, %s, 'mail', %s, %s, %s, %s, %s, %s)
            """,
            (
                self._new_id("audit"),
                actor.companyId,
                actor.userId,
                actor.userName,
                target_id,
                f"mail.bulk.{action}",
                json.dumps(before, ensure_ascii=False, sort_keys=True),
                json.dumps(after, ensure_ascii=False, sort_keys=True),
                json.dumps({"mailbox": mailbox, "requestId": request_id}, ensure_ascii=False, sort_keys=True),
                self._now(),
            ),
        )

    def list_rooms(self, actor: AuthUserSummary) -> MessengerRoomListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        room.id AS room_id,
                        room.room_type,
                        room.room_name,
                        room.created_at,
                        room.updated_at,
                        room.retention_expires_at,
                        COALESCE(member_ids.participant_ids, '[]'::jsonb) AS participant_ids,
                        last_msg.body AS last_message,
                        last_msg.created_at AS last_message_at,
                        COALESCE(unread.unread_count, 0) AS unread_count
                    FROM messenger_rooms room
                    JOIN messenger_room_members self_member
                      ON self_member.room_id = room.id AND self_member.user_id = %s
                    LEFT JOIN LATERAL (
                        SELECT jsonb_agg(user_id ORDER BY joined_at) AS participant_ids
                        FROM messenger_room_members
                        WHERE room_id = room.id
                    ) member_ids ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT body, created_at
                        FROM messenger_messages
                        WHERE room_id = room.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) last_msg ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT COUNT(*) AS unread_count
                        FROM messenger_messages msg
                        LEFT JOIN messenger_message_reads reads
                          ON reads.message_id = msg.id AND reads.user_id = %s
                        WHERE msg.room_id = room.id
                          AND msg.sender_user_id <> %s
                          AND reads.id IS NULL
                    ) unread ON TRUE
                    WHERE room.company_id = %s
                    ORDER BY COALESCE(last_msg.created_at, room.updated_at) DESC
                    """,
                    (actor.userId, actor.userId, actor.userId, actor.companyId),
                )
                rooms = [self._to_room_summary(row) for row in cursor.fetchall()]
        return MessengerRoomListResponse(rooms=rooms)

    def create_room(self, actor: AuthUserSummary, payload: MessengerRoomCreateRequest) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        room_id = self._new_id("room")
        participant_ids = self._dedupe([actor.userId, *payload.participantUserIds])
        if not participant_ids:
            raise ValueError("참여자를 1명 이상 입력해야 합니다.")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                users = self._fetch_company_users(cursor, actor.companyId, participant_ids)
                if set(users.keys()) != set(participant_ids):
                    raise ValueError("대화방 참여자 중 찾을 수 없는 사용자가 있습니다.")
                cursor.execute(
                    """
                    INSERT INTO messenger_rooms (
                        id, company_id, room_type, room_name, created_by_user_id,
                        created_at, updated_at, retention_expires_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        room_id,
                        actor.companyId,
                        payload.roomType,
                        payload.roomName.strip(),
                        actor.userId,
                        now,
                        now,
                        now + timedelta(days=14),
                    ),
                )
                for user_id in participant_ids:
                    cursor.execute(
                        """
                        INSERT INTO messenger_room_members (id, room_id, user_id, joined_at)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (self._new_id("member"), room_id, user_id, now),
                    )
            connection.commit()
        return self.get_room(actor, room_id)

    def get_room(self, actor: AuthUserSummary, room_id: str) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                room = self._fetch_accessible_room(cursor, actor, room_id)
                participants = self._fetch_room_participants(cursor, room_id)
                summary = self._room_row_to_summary_with_participants(cursor, actor, room)
        return MessengerRoomDetailResponse(**summary.model_dump(), participants=participants)

    def list_messages(self, actor: AuthUserSummary, room_id: str) -> MessengerMessageListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_room(cursor, actor, room_id)
                cursor.execute(
                    """
                    SELECT
                        msg.id AS message_id,
                        msg.room_id,
                        msg.sender_user_id,
                        u.name AS sender_user_name,
                        msg.message_type,
                        msg.body,
                        msg.attachment_meta,
                        msg.created_at,
                        msg.retention_expires_at,
                        COALESCE(reads.read_by, '[]'::jsonb) AS read_by
                    FROM messenger_messages msg
                    JOIN users u ON u.id = msg.sender_user_id
                    LEFT JOIN LATERAL (
                        SELECT jsonb_agg(user_id ORDER BY read_at) AS read_by
                        FROM messenger_message_reads
                        WHERE message_id = msg.id
                    ) reads ON TRUE
                    WHERE msg.room_id = %s
                    ORDER BY msg.created_at ASC
                    """,
                    (room_id,),
                )
                messages = [self._to_message_view(row) for row in cursor.fetchall()]
        return MessengerMessageListResponse(messages=messages)

    def send_message(self, actor: AuthUserSummary, room_id: str, payload: MessengerMessageSendRequest) -> MessengerMessageSendResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        message_id = self._new_id("msg")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_room(cursor, actor, room_id)
                cursor.execute(
                    """
                    INSERT INTO messenger_messages (
                        id, room_id, sender_user_id, message_type, body,
                        attachment_meta, created_at, retention_expires_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        message_id,
                        room_id,
                        actor.userId,
                        payload.messageType,
                        payload.body,
                        Jsonb(payload.attachmentMeta),
                        now,
                        now + timedelta(days=14),
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO messenger_message_reads (id, message_id, user_id, read_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (message_id, user_id)
                    DO UPDATE SET read_at = EXCLUDED.read_at
                    """,
                    (self._new_id("read"), message_id, actor.userId, now),
                )
                cursor.execute("UPDATE messenger_rooms SET updated_at = %s WHERE id = %s", (now, room_id))
            connection.commit()
        return MessengerMessageSendResponse(messageId=message_id, roomId=room_id, createdAt=now)

    def mark_room_read(self, actor: AuthUserSummary, room_id: str) -> MessengerReadResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_room(cursor, actor, room_id)
                cursor.execute(
                    """
                    SELECT id
                    FROM messenger_messages
                    WHERE room_id = %s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (room_id,),
                )
                last_message = cursor.fetchone()
                last_message_id = last_message["id"] if last_message else None
                cursor.execute(
                    """
                    INSERT INTO messenger_message_reads (id, message_id, user_id, read_at)
                    SELECT %s || '_' || id, id, %s, %s
                    FROM messenger_messages
                    WHERE room_id = %s
                    ON CONFLICT (message_id, user_id)
                    DO UPDATE SET read_at = EXCLUDED.read_at
                    """,
                    (self._new_id("read"), actor.userId, now, room_id),
                )
                cursor.execute(
                    """
                    UPDATE messenger_room_members
                    SET last_read_message_id = %s,
                        last_read_at = %s
                    WHERE room_id = %s AND user_id = %s
                    """,
                    (last_message_id, now, room_id, actor.userId),
                )
            connection.commit()
        return MessengerReadResponse(roomId=room_id, readAt=now, lastReadMessageId=last_message_id)

    def _save_mail(self, actor: AuthUserSummary, payload: MailSendRequest | MailDraftRequest, *, status_value: str) -> MailSendResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        mail_id = self._new_id("mailmsg")
        sent_at = now if status_value == "sent" else None
        received_at = now if status_value == "sent" else None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                account = self._fetch_mail_account(cursor, actor.userId)
                cursor.execute(
                    """
                    INSERT INTO mail_messages (
                        id, company_id, sender_user_id, sender_account_id, sender_email,
                        subject, body_text, body_html, status, sent_at, created_at,
                        updated_at, retention_expires_at, attachment_count
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        mail_id,
                        actor.companyId,
                        actor.userId,
                        account["id"],
                        account["email"],
                        payload.subject.strip(),
                        payload.bodyText,
                        payload.bodyHtml,
                        status_value,
                        sent_at,
                        now,
                        now,
                        now + timedelta(days=30),
                        len(payload.attachments),
                    ),
                )
                recipient_pairs = [("to", item) for item in payload.to] + [("cc", item) for item in payload.cc] + [("bcc", item) for item in payload.bcc]
                for kind, email in recipient_pairs:
                    recipient_user_id = self._resolve_user_id_by_email(cursor, actor.companyId, email)
                    cursor.execute(
                        """
                        INSERT INTO mail_recipients (
                            id, message_id, recipient_user_id, recipient_email,
                            recipient_kind, is_read, is_starred, received_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (self._new_id("rcpt"), mail_id, recipient_user_id, email, kind, False, False, received_at),
                    )
                for attachment in payload.attachments:
                    cursor.execute(
                        """
                        INSERT INTO mail_attachments (
                            id, message_id, file_name, content_type, size_bytes, storage_key, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            self._new_id("attach"),
                            mail_id,
                            attachment.fileName,
                            attachment.contentType,
                            attachment.sizeBytes,
                            attachment.storageKey,
                            now,
                        ),
                    )
            connection.commit()
        return MailSendResponse(mailId=mail_id, status=status_value, sentAt=sent_at)

    def _fetch_mail_account(self, cursor, user_id: str) -> dict:
        cursor.execute("SELECT id, email, status FROM mail_accounts WHERE user_id = %s", (user_id,))
        row = cursor.fetchone()
        if row is None:
            raise ValueError("메일 계정을 찾을 수 없습니다.")
        if row["status"] != "active":
            raise PermissionError("메일 계정이 활성 상태가 아닙니다.")
        return row

    def _fetch_accessible_mail(self, cursor, actor: AuthUserSummary, mail_id: str) -> dict:
        cursor.execute(
            """
            SELECT DISTINCT
                m.id AS mail_id,
                m.company_id,
                m.sender_user_id,
                m.sender_account_id AS account_id,
                m.sender_email,
                m.subject,
                m.body_text,
                m.body_html,
                m.status,
                m.sent_at,
                m.created_at,
                m.updated_at,
                m.retention_expires_at,
                m.attachment_count
            FROM mail_messages m
            LEFT JOIN mail_recipients r ON r.message_id = m.id
            WHERE m.id = %s
              AND m.company_id = %s
              AND (
                m.sender_user_id = %s
                OR r.recipient_user_id = %s
                OR LOWER(r.recipient_email) = %s
              )
            """,
            (mail_id, actor.companyId, actor.userId, actor.userId, actor.userEmail.lower()),
        )
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("메일을 조회할 권한이 없습니다.")
        return row

    def _fetch_mail_recipients(self, cursor, mail_id: str) -> list[MailRecipientView]:
        cursor.execute(
            """
            SELECT recipient_email, recipient_user_id, recipient_kind, is_read, is_starred, received_at, read_at
            FROM mail_recipients
            WHERE message_id = %s
            ORDER BY recipient_kind, recipient_email
            """,
            (mail_id,),
        )
        return [
            MailRecipientView(
                recipientEmail=row["recipient_email"],
                recipientUserId=row["recipient_user_id"],
                recipientKind=row["recipient_kind"],
                isRead=row["is_read"],
                isStarred=row["is_starred"],
                receivedAt=row["received_at"],
                readAt=row["read_at"],
            )
            for row in cursor.fetchall()
        ]

    def _fetch_mail_attachments(self, cursor, mail_id: str) -> list[MailAttachmentMeta]:
        cursor.execute(
            """
            SELECT file_name, content_type, size_bytes, storage_key
            FROM mail_attachments
            WHERE message_id = %s
            ORDER BY created_at ASC
            """,
            (mail_id,),
        )
        return [
            MailAttachmentMeta(
                fileName=row["file_name"],
                contentType=row["content_type"],
                sizeBytes=row["size_bytes"],
                storageKey=row["storage_key"],
            )
            for row in cursor.fetchall()
        ]

    def _resolve_user_id_by_email(self, cursor, company_id: str, email: str) -> str | None:
        cursor.execute("SELECT id FROM users WHERE company_id = %s AND LOWER(email) = %s", (company_id, email.lower()))
        row = cursor.fetchone()
        return row["id"] if row else None

    def _fetch_company_users(self, cursor, company_id: str, user_ids: list[str]) -> dict[str, dict]:
        cursor.execute(
            """
            SELECT id, name, email, status
            FROM users
            WHERE company_id = %s AND id = ANY(%s)
            """,
            (company_id, user_ids),
        )
        return {row["id"]: row for row in cursor.fetchall()}

    def _fetch_accessible_room(self, cursor, actor: AuthUserSummary, room_id: str) -> dict:
        cursor.execute(
            """
            SELECT room.*
            FROM messenger_rooms room
            JOIN messenger_room_members member ON member.room_id = room.id
            WHERE room.id = %s
              AND room.company_id = %s
              AND member.user_id = %s
            """,
            (room_id, actor.companyId, actor.userId),
        )
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("대화방에 접근할 권한이 없습니다.")
        return row

    def _fetch_room_participants(self, cursor, room_id: str) -> list[dict]:
        cursor.execute(
            """
            SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, member.joined_at, member.last_read_at
            FROM messenger_room_members member
            JOIN users u ON u.id = member.user_id
            WHERE member.room_id = %s
            ORDER BY member.joined_at ASC
            """,
            (room_id,),
        )
        return [
            {
                "userId": row["user_id"],
                "userName": row["user_name"],
                "userEmail": row["user_email"],
                "joinedAt": row["joined_at"].isoformat() if row["joined_at"] else None,
                "lastReadAt": row["last_read_at"].isoformat() if row["last_read_at"] else None,
            }
            for row in cursor.fetchall()
        ]

    def _room_row_to_summary_with_participants(self, cursor, actor: AuthUserSummary, room: dict) -> MessengerRoomSummary:
        cursor.execute(
            """
            SELECT
                COALESCE(member_ids.participant_ids, '[]'::jsonb) AS participant_ids,
                last_msg.body AS last_message,
                last_msg.created_at AS last_message_at,
                COALESCE(unread.unread_count, 0) AS unread_count
            FROM messenger_rooms room
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(user_id ORDER BY joined_at) AS participant_ids
                FROM messenger_room_members
                WHERE room_id = room.id
            ) member_ids ON TRUE
            LEFT JOIN LATERAL (
                SELECT body, created_at
                FROM messenger_messages
                WHERE room_id = room.id
                ORDER BY created_at DESC
                LIMIT 1
            ) last_msg ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS unread_count
                FROM messenger_messages msg
                LEFT JOIN messenger_message_reads reads
                  ON reads.message_id = msg.id AND reads.user_id = %s
                WHERE msg.room_id = room.id
                  AND msg.sender_user_id <> %s
                  AND reads.id IS NULL
            ) unread ON TRUE
            WHERE room.id = %s
            """,
            (actor.userId, actor.userId, room["id"]),
        )
        extra = cursor.fetchone()
        combined = dict(room)
        combined.update(extra)
        combined["room_id"] = room["id"]
        return self._to_room_summary(combined)

    def _to_mail_summary(self, row: dict) -> MailSummary:
        return MailSummary(
            mailId=row["mail_id"],
            accountId=row["account_id"],
            senderEmail=row["sender_email"],
            subject=row["subject"],
            previewText=(row.get("preview_text") or "")[:240],
            status=row["status"],
            isRead=bool(row["is_read"]),
            isStarred=bool(row["is_starred"]),
            sentAt=row["sent_at"],
            receivedAt=row["received_at"],
            retentionExpiresAt=row["retention_expires_at"],
            attachmentCount=row["attachment_count"],
            category=row.get("category") or "primary",
        )

    def _to_mail_detail(self, message: dict, recipients: list[MailRecipientView], attachments: list[MailAttachmentMeta]) -> MailDetailResponse:
        return MailDetailResponse(
            mailId=message["mail_id"],
            accountId=message["account_id"],
            senderUserId=message["sender_user_id"],
            senderEmail=message["sender_email"],
            subject=message["subject"],
            bodyText=message["body_text"],
            bodyHtml=message["body_html"],
            status=message["status"],
            sentAt=message["sent_at"],
            createdAt=message["created_at"],
            updatedAt=message["updated_at"],
            retentionExpiresAt=message["retention_expires_at"],
            attachmentCount=message["attachment_count"],
            recipients=recipients,
            attachments=attachments,
        )

    def _to_room_summary(self, row: dict) -> MessengerRoomSummary:
        participant_ids = row["participant_ids"]
        if isinstance(participant_ids, str):
            participant_ids = json.loads(participant_ids)
        return MessengerRoomSummary(
            roomId=row["room_id"],
            roomType=row["room_type"],
            roomName=row["room_name"],
            participantIds=[str(item) for item in (participant_ids or [])],
            lastMessage=row["last_message"],
            lastMessageAt=row["last_message_at"],
            unreadCount=int(row["unread_count"] or 0),
            readState="unread" if int(row["unread_count"] or 0) > 0 else "read",
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            retentionExpiresAt=row["retention_expires_at"],
        )

    def _to_message_view(self, row: dict) -> MessengerMessageView:
        attachment_meta = row["attachment_meta"]
        read_by = row["read_by"]
        if isinstance(attachment_meta, str):
            attachment_meta = json.loads(attachment_meta)
        if isinstance(read_by, str):
            read_by = json.loads(read_by)
        read_by_ids = [str(item) for item in (read_by or [])]
        return MessengerMessageView(
            messageId=row["message_id"],
            roomId=row["room_id"],
            senderUserId=row["sender_user_id"],
            senderUserName=row["sender_user_name"],
            messageType=row["message_type"],
            body=row["body"],
            attachmentMeta=list(attachment_meta or []),
            createdAt=row["created_at"],
            retentionExpiresAt=row["retention_expires_at"],
            readBy=read_by_ids,
            readState="read" if read_by_ids else "unread",
        )

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _now(self) -> datetime:
        return datetime.now(UTC)

    def _dedupe(self, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            if value and value not in result:
                result.append(value)
        return result
