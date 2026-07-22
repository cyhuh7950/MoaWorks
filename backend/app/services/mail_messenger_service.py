from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import logging
from uuid import uuid4

from psycopg.types.json import Jsonb
from app.core.config import settings
from app.services.mail_delivery_service import MailDeliveryPolicy

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailAttachmentView,
    ExternalDeliveryView,
    MailBulkRequest,
    MailBulkResponse,
    MailCategoryRequest,
    MailDetailResponse,
    MailDraftRequest,
    MailFolderCreateRequest,
    MailFolderListResponse,
    MailFolderUpdateRequest,
    MailFolderView,
    MailListQuery,
    MailRecentRecipient,
    MailRecentRecipientListResponse,
    MailListResponse,
    MailRecipientView,
    MailSendRequest,
    MailSendResponse,
    MailStorageResponse,
    MailStatusResponse,
    MailTagCreateRequest,
    MailTagListResponse,
    MailTagUpdateRequest,
    MailTagView,
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

logger = logging.getLogger(__name__)

from app.services.mail_attachment_storage import MailAttachmentStorage


class MailMessengerService:
    def __init__(self) -> None:
        self.db = PostgresService()
        self.attachment_storage = MailAttachmentStorage()

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
                        m.scheduled_at,
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
                      AND r.purged_at IS NULL
                      AND r.is_spam = FALSE
                      AND r.folder_id IS NULL
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
                        m.scheduled_at,
                        m.retention_expires_at,
                        m.attachment_count,
                        TRUE AS is_read,
                        FALSE AS is_starred,
                        NULL AS received_at,
                        'primary' AS category
                    FROM mail_messages m
                    WHERE m.company_id = %s
                      AND m.sender_user_id = %s
                      AND m.status IN ('sent', 'scheduled')
                      AND m.sender_deleted_at IS NULL
                      AND m.sender_purged_at IS NULL
                    ORDER BY COALESCE(m.scheduled_at, m.sent_at, m.created_at) DESC
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
                        m.scheduled_at,
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
                      AND m.sender_purged_at IS NULL
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
            "r.purged_at IS NULL",
            "r.is_spam = FALSE",
            "r.folder_id IS NULL",
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
                        m.scheduled_at,
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
        status_condition = "m.status = 'draft'" if mailbox == "draft" else "m.status IN ('sent', 'scheduled')"
        conditions = [
            "m.company_id = %s",
            "m.sender_user_id = %s",
            status_condition,
            "m.sender_deleted_at IS NULL",
            "m.sender_purged_at IS NULL",
        ]
        params: list[object] = [actor.companyId, actor.userId]
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
                        m.scheduled_at,
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
            "COALESCE(r.received_at, m.sent_at, m.created_at)" if mailbox == "inbox" else "COALESCE(m.scheduled_at, m.sent_at, m.created_at)"
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

    def get_mail(self, actor: AuthUserSummary, mail_id: str, view: str = "inbox") -> MailDetailResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                message = self._fetch_accessible_mail(cursor, actor, mail_id, view=view)
                recipients = self._fetch_mail_recipients(
                    cursor,
                    actor,
                    mail_id,
                    is_sender_view=bool(message["is_sender_view"]),
                )
                attachments = self._fetch_mail_attachments(cursor, mail_id)
                external_deliveries = self._fetch_external_deliveries(cursor, mail_id) if message["is_sender_view"] else []
        return self._to_mail_detail(message, recipients, attachments, external_deliveries)

    def stage_attachment(
        self,
        actor: AuthUserSummary,
        file_name: str,
        content_type: str,
        content: bytes,
    ):
        self.attachment_storage.cleanup_expired()
        return self.attachment_storage.stage(actor, file_name, content_type, content)

    def list_recent_recipients(self, actor: AuthUserSummary, limit: int = 20) -> MailRecentRecipientListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT email, name, department_name, last_used_at
                    FROM (
                        SELECT DISTINCT ON (LOWER(r.recipient_email))
                            LOWER(r.recipient_email) AS email,
                            u.name,
                            d.name AS department_name,
                            COALESCE(m.sent_at, m.scheduled_at, m.created_at) AS last_used_at
                        FROM mail_recipients r
                        JOIN mail_messages m ON m.id = r.message_id
                        LEFT JOIN users u ON u.company_id = m.company_id AND LOWER(u.email) = LOWER(r.recipient_email)
                        LEFT JOIN departments d ON d.id = u.department_id
                        WHERE m.company_id = %s
                          AND m.sender_user_id = %s
                          AND m.status IN ('sent', 'scheduled')
                          AND m.sender_deleted_at IS NULL
                        ORDER BY LOWER(r.recipient_email), COALESCE(m.sent_at, m.scheduled_at, m.created_at) DESC
                    ) recent
                    ORDER BY last_used_at DESC
                    LIMIT %s
                    """,
                    (actor.companyId, actor.userId, limit),
                )
                recipients = [
                    MailRecentRecipient(
                        email=row["email"],
                        name=row["name"],
                        departmentName=row["department_name"],
                        lastUsedAt=row["last_used_at"],
                    )
                    for row in cursor.fetchall()
                ]
        return MailRecentRecipientListResponse(recipients=recipients)

    def download_attachment(self, actor: AuthUserSummary, mail_id: str, attachment_id: str) -> dict:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._fetch_accessible_mail(cursor, actor, mail_id)
                cursor.execute(
                    """
                    SELECT id, file_name, content_type, size_bytes, storage_key
                    FROM mail_attachments
                    WHERE id = %s AND message_id = %s
                    """,
                    (attachment_id, mail_id),
                )
                row = cursor.fetchone()
        if row is None:
            raise PermissionError("첨부 파일에 접근할 권한이 없습니다.")
        path = self.attachment_storage.stored_path(row["storage_key"])
        return {
            "path": path,
            "fileName": row["file_name"],
            "contentType": row["content_type"],
            "sizeBytes": row["size_bytes"],
        }

    def send_mail(self, actor: AuthUserSummary, payload: MailSendRequest) -> MailSendResponse:
        if not payload.to and not payload.cc and not payload.bcc:
            raise ValueError("수신자를 1명 이상 입력해야 합니다.")
        status_value = "scheduled" if payload.scheduledAt is not None else "sent"
        return self._save_mail(actor, payload, status_value=status_value)

    def save_draft(self, actor: AuthUserSummary, payload: MailDraftRequest) -> MailSendResponse:
        return self._save_mail(actor, payload, status_value="draft")

    def dispatch_scheduled_mail(self, *, limit: int = 100) -> int:
        self.db.ensure_migrations_applied()
        now = self._now()
        dispatched = 0
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, company_id, sender_user_id
                    FROM mail_messages
                    WHERE status = 'scheduled'
                      AND scheduled_at <= %s
                      AND sender_deleted_at IS NULL
                    ORDER BY scheduled_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT %s
                    """,
                    (now, limit),
                )
                rows = cursor.fetchall()
                for row in rows:
                    cursor.execute(
                        "UPDATE mail_messages SET status = 'sent', sent_at = %s, updated_at = %s WHERE id = %s",
                        (now, now, row["id"]),
                    )
                    cursor.execute(
                        "UPDATE mail_recipients SET received_at = %s WHERE message_id = %s AND recipient_user_id IS NOT NULL",
                        (now, row["id"]),
                    )
                    cursor.execute(
                        """INSERT INTO mail_delivery_queue (
                            id, company_id, provider_config_id, mail_id, recipient_id, status,
                            attempt_count, next_attempt_at, created_at, updated_at
                        )
                        SELECT %s || '_' || r.id, m.company_id, a.provider_config_id, m.id, r.id,
                               CASE WHEN p.delivery_enabled AND p.last_test_status = 'success' THEN 'queued' ELSE 'blocked' END,
                               0, CASE WHEN p.delivery_enabled AND p.last_test_status = 'success' THEN %s ELSE NULL END, %s, %s
                        FROM mail_messages m
                        JOIN mail_accounts a ON a.id = m.sender_account_id
                        JOIN mail_provider_configs p ON p.id = a.provider_config_id
                        JOIN mail_recipients r ON r.message_id = m.id AND r.recipient_user_id IS NULL
                        WHERE m.id = %s
                        ON CONFLICT (mail_id, recipient_id) DO NOTHING""",
                        (self._new_id("delivery"), now, now, now, row["id"]),
                    )
                    cursor.execute(
                        """INSERT INTO audit_logs (
                            id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                            event, status_before, status_after, reason, created_at
                        )
                        SELECT %s || '_' || q.id, q.company_id, %s, 'system', 'mail', q.mail_id,
                               'mail.delivery.' || q.status, NULL, q.status, 'UI-021 scheduled transaction outbox', %s
                        FROM mail_delivery_queue q WHERE q.mail_id = %s AND q.created_at = %s""",
                        (self._new_id("audit"), row["sender_user_id"], now, row["id"], now),
                    )
                    self._write_mail_event_audit(
                        cursor,
                        company_id=row["company_id"],
                        actor_user_id=row["sender_user_id"],
                        actor_user_name="system",
                        mail_id=row["id"],
                        event="mail.scheduled.dispatched",
                        status_before="scheduled",
                        status_after="sent",
                        now=now,
                    )
                    dispatched += 1
            connection.commit()
        return dispatched

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

    def list_mail_folders(self, actor: AuthUserSummary) -> MailFolderListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT f.id, f.name, f.sort_order, COUNT(r.id) AS message_count
                    FROM mail_user_folders f
                    LEFT JOIN mail_recipients r ON r.folder_id = f.id
                      AND r.deleted_at IS NULL AND r.purged_at IS NULL AND r.is_spam = FALSE
                    WHERE f.company_id = %s AND f.user_id = %s
                    GROUP BY f.id, f.name, f.sort_order, f.created_at
                    ORDER BY f.sort_order, f.created_at
                    """,
                    (actor.companyId, actor.userId),
                )
                return MailFolderListResponse(folders=[
                    MailFolderView(folderId=row["id"], name=row["name"], sortOrder=row["sort_order"], messageCount=row["message_count"])
                    for row in cursor.fetchall()
                ])

    def create_mail_folder(self, actor: AuthUserSummary, payload: MailFolderCreateRequest) -> MailFolderView:
        self.db.ensure_migrations_applied()
        now = self._now()
        folder_id = self._new_id("folder")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM mail_user_folders WHERE company_id = %s AND user_id = %s AND LOWER(name) = LOWER(%s) FOR UPDATE",
                    (actor.companyId, actor.userId, payload.name),
                )
                if cursor.fetchone():
                    raise ValueError("같은 이름의 사용자 메일함이 이미 있습니다.")
                cursor.execute(
                    "SELECT COUNT(*) AS count FROM mail_user_folders WHERE company_id = %s AND user_id = %s",
                    (actor.companyId, actor.userId),
                )
                if int(cursor.fetchone()["count"]) >= 50:
                    raise ValueError("사용자 메일함은 최대 50개까지 만들 수 있습니다.")
                cursor.execute(
                    """
                    INSERT INTO mail_user_folders (id, company_id, user_id, name, sort_order, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 0, %s, %s)
                    """,
                    (folder_id, actor.companyId, actor.userId, payload.name, now, now),
                )
                self._write_mail_bulk_audit(cursor, actor, folder_id, "folder_create", {"exists": False}, {"exists": True}, "folder", self._new_id("mailfolder"))
            connection.commit()
        return MailFolderView(folderId=folder_id, name=payload.name)

    def update_mail_folder(self, actor: AuthUserSummary, folder_id: str, payload: MailFolderUpdateRequest) -> MailFolderView:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                folder = self._lock_owned_folder(cursor, actor, folder_id)
                cursor.execute(
                    "SELECT id FROM mail_user_folders WHERE company_id = %s AND user_id = %s AND LOWER(name) = LOWER(%s) AND id <> %s",
                    (actor.companyId, actor.userId, payload.name, folder_id),
                )
                if cursor.fetchone():
                    raise ValueError("같은 이름의 사용자 메일함이 이미 있습니다.")
                cursor.execute("UPDATE mail_user_folders SET name = %s, updated_at = %s WHERE id = %s", (payload.name, self._now(), folder_id))
                self._write_mail_bulk_audit(cursor, actor, folder_id, "folder_update", {"updated": False}, {"updated": True}, "folder", self._new_id("mailfolder"))
            connection.commit()
        return MailFolderView(folderId=folder_id, name=payload.name, sortOrder=folder["sort_order"])

    def delete_mail_folder(self, actor: AuthUserSummary, folder_id: str) -> None:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                folder = self._lock_owned_folder(cursor, actor, folder_id)
                cursor.execute(
                    """
                    UPDATE mail_recipients r SET folder_id = NULL
                    FROM mail_messages m
                    WHERE r.message_id = m.id AND r.folder_id = %s AND m.company_id = %s
                      AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                    """,
                    (folder_id, actor.companyId, actor.userId, actor.userEmail.lower()),
                )
                cursor.execute("DELETE FROM mail_user_folders WHERE id = %s", (folder_id,))
                self._write_mail_bulk_audit(cursor, actor, folder_id, "folder_delete", {"deleted": False}, {"deleted": True}, "folder", self._new_id("mailfolder"))
            connection.commit()

    def list_mail_tags(self, actor: AuthUserSummary) -> MailTagListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT t.id, t.name, t.color, t.sort_order, COUNT(r.id) AS message_count
                    FROM mail_tags t
                    LEFT JOIN mail_recipient_tags rt ON rt.tag_id = t.id
                    LEFT JOIN mail_recipients r ON r.id = rt.recipient_id
                      AND r.deleted_at IS NULL AND r.purged_at IS NULL
                    WHERE t.company_id = %s AND t.user_id = %s
                    GROUP BY t.id, t.name, t.color, t.sort_order, t.created_at
                    ORDER BY t.sort_order, t.created_at
                    """,
                    (actor.companyId, actor.userId),
                )
                return MailTagListResponse(tags=[
                    MailTagView(tagId=row["id"], name=row["name"], color=row["color"], sortOrder=row["sort_order"], messageCount=row["message_count"])
                    for row in cursor.fetchall()
                ])

    def create_mail_tag(self, actor: AuthUserSummary, payload: MailTagCreateRequest) -> MailTagView:
        self.db.ensure_migrations_applied()
        now = self._now()
        tag_id = self._new_id("tag")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM mail_tags WHERE company_id = %s AND user_id = %s AND LOWER(name) = LOWER(%s) FOR UPDATE",
                    (actor.companyId, actor.userId, payload.name),
                )
                if cursor.fetchone():
                    raise ValueError("같은 이름의 태그가 이미 있습니다.")
                cursor.execute("SELECT COUNT(*) AS count FROM mail_tags WHERE company_id = %s AND user_id = %s", (actor.companyId, actor.userId))
                if int(cursor.fetchone()["count"]) >= 50:
                    raise ValueError("태그는 최대 50개까지 만들 수 있습니다.")
                cursor.execute(
                    "INSERT INTO mail_tags (id, company_id, user_id, name, color, sort_order, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, 0, %s, %s)",
                    (tag_id, actor.companyId, actor.userId, payload.name, payload.color, now, now),
                )
                self._write_mail_bulk_audit(cursor, actor, tag_id, "tag_create", {"exists": False}, {"exists": True}, "tag", self._new_id("mailtag"))
            connection.commit()
        return MailTagView(tagId=tag_id, name=payload.name, color=payload.color)

    def update_mail_tag(self, actor: AuthUserSummary, tag_id: str, payload: MailTagUpdateRequest) -> MailTagView:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                tag = self._lock_owned_tag(cursor, actor, tag_id)
                cursor.execute(
                    "SELECT id FROM mail_tags WHERE company_id = %s AND user_id = %s AND LOWER(name) = LOWER(%s) AND id <> %s",
                    (actor.companyId, actor.userId, payload.name, tag_id),
                )
                if cursor.fetchone():
                    raise ValueError("같은 이름의 태그가 이미 있습니다.")
                cursor.execute("UPDATE mail_tags SET name = %s, color = %s, updated_at = %s WHERE id = %s", (payload.name, payload.color, self._now(), tag_id))
                self._write_mail_bulk_audit(cursor, actor, tag_id, "tag_update", {"updated": False}, {"updated": True}, "tag", self._new_id("mailtag"))
            connection.commit()
        return MailTagView(tagId=tag_id, name=payload.name, color=payload.color, sortOrder=tag["sort_order"])

    def delete_mail_tag(self, actor: AuthUserSummary, tag_id: str) -> None:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                tag = self._lock_owned_tag(cursor, actor, tag_id)
                cursor.execute("DELETE FROM mail_recipient_tags WHERE tag_id = %s", (tag_id,))
                cursor.execute("DELETE FROM mail_tags WHERE id = %s", (tag_id,))
                self._write_mail_bulk_audit(cursor, actor, tag_id, "tag_delete", {"deleted": False}, {"deleted": True}, "tag", self._new_id("mailtag"))
            connection.commit()

    def list_folder_messages(self, actor: AuthUserSummary, folder_id: str, query: MailListQuery) -> MailListResponse:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owned_folder(cursor, actor, folder_id)
        return self._list_ui020_recipient(actor, query, "r.folder_id = %s AND r.is_spam = FALSE", [folder_id])

    def list_tag_messages(self, actor: AuthUserSummary, tag_id: str, query: MailListQuery) -> MailListResponse:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owned_tag(cursor, actor, tag_id)
        return self._list_ui020_recipient(actor, query, "EXISTS (SELECT 1 FROM mail_recipient_tags rt WHERE rt.recipient_id = r.id AND rt.tag_id = %s)", [tag_id])

    def list_spam(self, actor: AuthUserSummary, query: MailListQuery) -> MailListResponse:
        return self._list_ui020_recipient(actor, query, "r.is_spam = TRUE", [])

    def list_trash(self, actor: AuthUserSummary, query: MailListQuery) -> MailListResponse:
        self.db.ensure_migrations_applied()
        search_recipient = ""
        search_sender = ""
        recipient_params: list[object] = [actor.companyId, actor.userId, actor.userEmail.lower()]
        sender_params: list[object] = [actor.companyId, actor.userId]
        if query.q:
            search_recipient = " AND (m.subject ILIKE %s OR m.sender_email ILIKE %s OR m.body_text ILIKE %s)"
            search_sender = " AND (m.subject ILIKE %s OR m.sender_email ILIKE %s OR m.body_text ILIKE %s)"
            pattern = f"%{query.q}%"
            recipient_params.extend([pattern, pattern, pattern])
            sender_params.extend([pattern, pattern, pattern])
        union_sql = f"""
            SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.subject,
              LEFT(COALESCE(m.body_text, ''), 240) AS preview_text, m.status, m.sent_at, m.scheduled_at,
              m.retention_expires_at, m.attachment_count, r.is_read, r.is_starred, r.received_at,
              COALESCE(r.inbox_category, 'primary') AS category, 'inbox' AS source_mailbox,
              r.deleted_at AS trashed_at
            FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id
            WHERE m.company_id = %s AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
              AND r.deleted_at IS NOT NULL AND r.purged_at IS NULL {search_recipient}
            UNION ALL
            SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.subject,
              LEFT(COALESCE(m.body_text, ''), 240) AS preview_text, m.status, m.sent_at, m.scheduled_at,
              m.retention_expires_at, m.attachment_count, TRUE AS is_read, FALSE AS is_starred, NULL AS received_at,
              'primary' AS category, CASE WHEN m.status = 'draft' THEN 'draft' ELSE 'sent' END AS source_mailbox,
              m.sender_deleted_at AS trashed_at
            FROM mail_messages m
            WHERE m.company_id = %s AND m.sender_user_id = %s
              AND m.sender_deleted_at IS NOT NULL AND m.sender_purged_at IS NULL {search_sender}
        """
        params = recipient_params + sender_params
        outer_conditions: list[str] = []
        outer_params: list[object] = []
        if query.read != "all":
            outer_conditions.append("is_read = %s")
            outer_params.append(query.read == "read")
        if query.starred != "all":
            outer_conditions.append("is_starred = %s")
            outer_params.append(query.starred == "starred")
        if query.attachment == "with":
            outer_conditions.append("attachment_count > 0")
        elif query.attachment == "without":
            outer_conditions.append("attachment_count = 0")
        if query.category != "all":
            outer_conditions.append("category = %s")
            outer_params.append(query.category)
        outer_where = " WHERE " + " AND ".join(outer_conditions) if outer_conditions else ""
        order_sql = {
            "date_desc": "trashed_at DESC, mail_id DESC",
            "date_asc": "trashed_at ASC, mail_id ASC",
            "sender_asc": "LOWER(sender_email) ASC, trashed_at DESC",
            "subject_asc": "LOWER(subject) ASC, trashed_at DESC",
        }[query.sort]
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) AS total FROM ({union_sql}) trash_views{outer_where}", tuple(params + outer_params))
                total = int(cursor.fetchone()["total"])
                cursor.execute(
                    f"SELECT * FROM ({union_sql}) trash_views{outer_where} ORDER BY {order_sql} LIMIT %s OFFSET %s",
                    tuple(params + outer_params + [query.limit, query.offset]),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
        return MailListResponse(mails=mails, total=total, limit=query.limit, offset=query.offset, hasMore=query.offset + len(mails) < total)
    def _list_ui020_recipient(self, actor: AuthUserSummary, query: MailListQuery, context_sql: str, context_params: list[object]) -> MailListResponse:
        self.db.ensure_migrations_applied()
        conditions = [
            "m.company_id = %s", "(r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)",
            "m.status = 'sent'", "r.deleted_at IS NULL", "r.purged_at IS NULL", context_sql,
        ]
        params: list[object] = [actor.companyId, actor.userId, actor.userEmail.lower(), *context_params]
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
        where = " AND ".join(conditions)
        order_sql = self._mail_sort_sql(query.sort, mailbox="inbox")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) AS total FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id WHERE {where}", tuple(params))
                total = int(cursor.fetchone()["total"])
                cursor.execute(
                    f"""
                    SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.subject,
                      LEFT(COALESCE(m.body_text, ''), 240) AS preview_text, m.status, m.sent_at, m.scheduled_at,
                      m.retention_expires_at, m.attachment_count, r.is_read, r.is_starred, r.received_at,
                      COALESCE(r.inbox_category, 'primary') AS category, 'inbox' AS source_mailbox
                    FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id
                    WHERE {where} ORDER BY {order_sql} LIMIT %s OFFSET %s
                    """,
                    tuple(params + [query.limit, query.offset]),
                )
                mails = [self._to_mail_summary(row) for row in cursor.fetchall()]
        return MailListResponse(mails=mails, total=total, limit=query.limit, offset=query.offset, hasMore=query.offset + len(mails) < total)
    def _lock_owned_folder(self, cursor, actor: AuthUserSummary, folder_id: str) -> dict:
        cursor.execute("SELECT id, name, sort_order FROM mail_user_folders WHERE id = %s AND company_id = %s AND user_id = %s FOR UPDATE", (folder_id, actor.companyId, actor.userId))
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("사용자 메일함에 접근할 권한이 없습니다.")
        return row

    def _lock_owned_tag(self, cursor, actor: AuthUserSummary, tag_id: str) -> dict:
        cursor.execute("SELECT id, name, color, sort_order FROM mail_tags WHERE id = %s AND company_id = %s AND user_id = %s FOR UPDATE", (tag_id, actor.companyId, actor.userId))
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("태그에 접근할 권한이 없습니다.")
        return row

    def _bulk_mail_ui020(self, actor: AuthUserSummary, payload: MailBulkRequest) -> MailBulkResponse:
        now = self._now()
        request_id = self._new_id("mailbulk")
        changed_count = 0
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                if payload.targetFolderId:
                    self._lock_owned_folder(cursor, actor, payload.targetFolderId)
                if payload.targetTagId:
                    self._lock_owned_tag(cursor, actor, payload.targetTagId)
                if payload.mailbox == "trash":
                    rows: list[dict] = []
                    for selection in payload.trashViews or []:
                        if selection.sourceMailbox == "inbox":
                            cursor.execute(
                                """
                                SELECT r.id AS recipient_id, r.message_id AS mail_id, r.folder_id, r.is_spam,
                                  r.deleted_at, r.purged_at, r.is_read, r.is_starred
                                FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id
                                WHERE r.message_id = %s AND m.company_id = %s
                                  AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                                  AND r.deleted_at IS NOT NULL AND r.purged_at IS NULL
                                FOR UPDATE OF r
                                """,
                                (selection.mailId, actor.companyId, actor.userId, actor.userEmail.lower()),
                            )
                            row = cursor.fetchone()
                            if row is not None:
                                rows.append(dict(row, view_kind="recipient", source_mailbox="inbox"))
                        else:
                            status_condition = "m.status = 'draft'" if selection.sourceMailbox == "draft" else "m.status IN ('sent', 'scheduled')"
                            cursor.execute(
                                f"""
                                SELECT m.id AS mail_id, m.status, m.sender_deleted_at, m.sender_purged_at
                                FROM mail_messages m
                                WHERE m.id = %s AND m.company_id = %s AND m.sender_user_id = %s
                                  AND {status_condition}
                                  AND m.sender_deleted_at IS NOT NULL AND m.sender_purged_at IS NULL
                                FOR UPDATE OF m
                                """,
                                (selection.mailId, actor.companyId, actor.userId),
                            )
                            row = cursor.fetchone()
                            if row is not None:
                                rows.append(dict(row, view_kind="sender", source_mailbox=selection.sourceMailbox))
                    locked_keys = {(row["mail_id"], row["source_mailbox"]) for row in rows}
                    requested_keys = {(item.mailId, item.sourceMailbox) for item in payload.trashViews or []}
                    if locked_keys != requested_keys:
                        raise PermissionError("요청한 모든 휴지통 view를 처리할 권한이 없습니다.")
                else:
                    context = {
                        "inbox": "r.deleted_at IS NULL AND r.purged_at IS NULL",
                        "folder": "r.deleted_at IS NULL AND r.purged_at IS NULL AND r.is_spam = FALSE",
                        "tag": "r.deleted_at IS NULL AND r.purged_at IS NULL",
                        "spam": "r.deleted_at IS NULL AND r.purged_at IS NULL AND r.is_spam = TRUE",
                    }[payload.mailbox]
                    cursor.execute(
                        f"""
                        SELECT r.id AS recipient_id, r.message_id AS mail_id, r.folder_id, r.is_spam,
                          r.deleted_at, r.purged_at, r.is_read, r.is_starred
                        FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id
                        WHERE r.message_id = ANY(%s) AND m.company_id = %s
                          AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                          AND {context} FOR UPDATE OF r
                        """,
                        (payload.mailIds, actor.companyId, actor.userId, actor.userEmail.lower()),
                    )
                    rows = [dict(row, view_kind="recipient") for row in cursor.fetchall()]
                    if {row["mail_id"] for row in rows} != set(payload.mailIds):
                        raise PermissionError("요청한 모든 메일을 처리할 권한이 없습니다.")

                for row in rows:
                    if row["view_kind"] == "sender":
                        before = {
                            "deleted": row.get("sender_deleted_at") is not None,
                            "purged": row.get("sender_purged_at") is not None,
                        }
                    else:
                        before = {
                            "folderId": row.get("folder_id"), "spam": bool(row.get("is_spam")),
                            "deleted": row.get("deleted_at") is not None, "purged": row.get("purged_at") is not None,
                        }
                    after = dict(before)
                    if row["view_kind"] == "sender":
                        if payload.action == "restore":
                            after["deleted"] = False
                            cursor.execute("UPDATE mail_messages SET sender_deleted_at = NULL, sender_deleted_by_user_id = NULL, updated_at = %s WHERE id = %s", (now, row["mail_id"]))
                        else:
                            after["purged"] = True
                            cursor.execute("UPDATE mail_messages SET sender_purged_at = %s, sender_purged_by_user_id = %s, updated_at = %s WHERE id = %s", (now, actor.userId, now, row["mail_id"]))
                    elif payload.action == "move_folder":
                        after["folderId"] = payload.targetFolderId
                        cursor.execute("UPDATE mail_recipients SET folder_id = %s WHERE id = %s", (payload.targetFolderId, row["recipient_id"]))
                    elif payload.action == "add_tag":
                        cursor.execute("INSERT INTO mail_recipient_tags (recipient_id, tag_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING", (row["recipient_id"], payload.targetTagId, now))
                        after["tagId"] = payload.targetTagId
                    elif payload.action == "remove_tag":
                        cursor.execute("DELETE FROM mail_recipient_tags WHERE recipient_id = %s AND tag_id = %s", (row["recipient_id"], payload.targetTagId))
                        after["removedTagId"] = payload.targetTagId
                    elif payload.action == "spam":
                        after["spam"] = True
                        cursor.execute("UPDATE mail_recipients SET is_spam = TRUE, spam_marked_at = %s WHERE id = %s", (now, row["recipient_id"]))
                    elif payload.action == "not_spam":
                        after["spam"] = False
                        cursor.execute("UPDATE mail_recipients SET is_spam = FALSE, spam_marked_at = NULL WHERE id = %s", (row["recipient_id"],))
                    elif payload.action == "delete":
                        after["deleted"] = True
                        cursor.execute("UPDATE mail_recipients SET deleted_at = %s, deleted_by_user_id = %s WHERE id = %s", (now, actor.userId, row["recipient_id"]))
                    elif payload.action == "restore":
                        after["deleted"] = False
                        cursor.execute("UPDATE mail_recipients SET deleted_at = NULL, deleted_by_user_id = NULL WHERE id = %s", (row["recipient_id"],))
                    elif payload.action == "purge":
                        after["purged"] = True
                        cursor.execute("UPDATE mail_recipients SET purged_at = %s, purged_by_user_id = %s WHERE id = %s", (now, actor.userId, row["recipient_id"]))
                    audit_mailbox = row.get("source_mailbox") if payload.mailbox == "trash" else payload.mailbox
                    self._write_mail_bulk_audit(cursor, actor, row["mail_id"], payload.action, before, after, audit_mailbox, request_id)
                    changed_count += 1
            connection.commit()
        requested_count = len(payload.trashViews or []) if payload.mailbox == "trash" else len(payload.mailIds)
        return MailBulkResponse(
            action=payload.action, requestedCount=requested_count, changedCount=changed_count,
            unchangedCount=requested_count - changed_count, targetCategory=payload.targetCategory,
            targetFolderId=payload.targetFolderId, targetTagId=payload.targetTagId,
        )
    def bulk_mail(self, actor: AuthUserSummary, payload: MailBulkRequest) -> MailBulkResponse:
        payload.validate_contract()
        self.db.ensure_migrations_applied()
        if payload.action in {"move_folder", "add_tag", "remove_tag", "spam", "not_spam", "restore", "purge"} or payload.mailbox in {"folder", "tag", "spam", "trash"}:
            return self._bulk_mail_ui020(actor, payload)
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
        resolved_attachments = [self.attachment_storage.resolve(actor, item) for item in payload.attachments]
        if len(resolved_attachments) > settings.mail_attachment_max_files:
            raise ValueError("첨부 파일 개수 제한을 초과했습니다.")
        if len({item["upload_id"] for item in resolved_attachments}) != len(resolved_attachments):
            raise ValueError("같은 첨부 파일을 중복 사용할 수 없습니다.")
        if sum(item["size_bytes"] for item in resolved_attachments) > settings.mail_attachment_max_total_bytes:
            raise ValueError("첨부 파일의 전체 용량 제한을 초과했습니다.")

        now = self._now()
        mail_id = self._new_id("mailmsg")
        sent_at = now if status_value == "sent" else None
        scheduled_at = payload.scheduledAt if status_value == "scheduled" else None
        internal_by_email: dict[str, str] = {}
        external_emails: set[str] = set()
        provider = None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                account = self._fetch_mail_account(cursor, actor.userId)
                if payload.sourceMailId:
                    if payload.copiedAttachmentIds:
                        source_attachments = self._fetch_source_attachments(cursor, actor, payload.sourceMailId, payload.copiedAttachmentIds)
                        for source_attachment in source_attachments:
                            resolved_attachments.append(self.attachment_storage.clone(
                                actor, storage_key=source_attachment["storage_key"],
                                file_name=source_attachment["file_name"], content_type=source_attachment["content_type"],
                                size_bytes=source_attachment["size_bytes"],
                            ))
                    else:
                        self._fetch_accessible_mail(cursor, actor, payload.sourceMailId)
                if len(resolved_attachments) > settings.mail_attachment_max_files:
                    raise ValueError("첨부 파일 개수 제한을 초과했습니다.")
                if sum(item["size_bytes"] for item in resolved_attachments) > settings.mail_attachment_max_total_bytes:
                    raise ValueError("첨부 파일의 전체 용량 제한을 초과했습니다.")

                recipient_pairs = [("to", item) for item in payload.to] + [("cc", item) for item in payload.cc] + [("bcc", item) for item in payload.bcc]
                if status_value != "draft":
                    cursor.execute("SELECT domain FROM companies WHERE id = %s", (actor.companyId,))
                    company = cursor.fetchone()
                    cursor.execute("SELECT LOWER(email) AS email, id FROM users WHERE company_id = %s AND status = 'active'", (actor.companyId,))
                    active_users = {row["email"]: row["id"] for row in cursor.fetchall()}
                    classification = MailDeliveryPolicy().classify(company["domain"], active_users, recipient_pairs)
                    internal_by_email = {email: user_id for _, email, user_id in classification.internal}
                    external_emails = {email for _, email in classification.external}
                    cursor.execute("SELECT * FROM mail_provider_configs WHERE id = %s AND company_id = %s", (account["provider_config_id"], actor.companyId))
                    provider = cursor.fetchone()
                    if external_emails and provider is None:
                        raise ValueError("외부 발송 provider를 찾을 수 없습니다.")

                cursor.execute(
                    """INSERT INTO mail_messages (
                        id, company_id, sender_user_id, sender_account_id, sender_email,
                        subject, body_text, body_html, status, sent_at, scheduled_at, created_at,
                        updated_at, retention_expires_at, attachment_count, source_message_id, source_action
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (mail_id, actor.companyId, actor.userId, account["id"], account["email"],
                     payload.subject.strip(), payload.bodyText, payload.bodyHtml, status_value, sent_at, scheduled_at,
                     now, now, now + timedelta(days=30), len(resolved_attachments), payload.sourceMailId,
                     None if payload.composeAction == "new" else payload.composeAction),
                )
                for kind, email in recipient_pairs:
                    recipient_user_id = internal_by_email.get(email) if status_value != "draft" else self._resolve_user_id_by_email(cursor, actor.companyId, email)
                    recipient_id = self._new_id("rcpt")
                    cursor.execute(
                        """INSERT INTO mail_recipients (
                            id, message_id, recipient_user_id, recipient_email, recipient_kind,
                            is_read, is_starred, received_at
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (recipient_id, mail_id, recipient_user_id, email, kind, False, False,
                         now if status_value == "sent" and recipient_user_id else None),
                    )
                    if status_value == "sent" and email in external_emails:
                        queue_status = "queued" if provider["delivery_enabled"] and provider["last_test_status"] == "success" else "blocked"
                        cursor.execute(
                            """INSERT INTO mail_delivery_queue (
                                id, company_id, provider_config_id, mail_id, recipient_id, status,
                                attempt_count, next_attempt_at, created_at, updated_at
                            ) VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,%s)""",
                            (self._new_id("delivery"), actor.companyId, provider["id"], mail_id, recipient_id,
                             queue_status, now if queue_status == "queued" else None, now, now),
                        )
                        self._write_mail_event_audit(
                            cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                            actor_user_name=actor.userName, mail_id=mail_id, event=f"mail.delivery.{queue_status}",
                            status_before=None, status_after=queue_status, now=now, reason="UI-021 transaction outbox",
                        )
                for attachment in resolved_attachments:
                    cursor.execute(
                        """INSERT INTO mail_attachments (
                            id, message_id, file_name, content_type, size_bytes, storage_key, created_at
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                        (self._new_id("attach"), mail_id, attachment["file_name"], attachment["content_type"],
                         attachment["size_bytes"], attachment["storage_key"], now),
                    )
                event = {"draft": "mail.draft.saved", "scheduled": "mail.scheduled", "sent": "mail.sent"}[status_value]
                self._write_mail_event_audit(
                    cursor, company_id=actor.companyId, actor_user_id=actor.userId, actor_user_name=actor.userName,
                    mail_id=mail_id, event=event, status_before=None, status_after=status_value, now=now,
                    reason="UI-018 mail compose" if payload.composeAction == "new" else f"UI-019 {payload.composeAction}",
                )
            connection.commit()
        for attachment in resolved_attachments:
            try:
                self.attachment_storage.mark_attached(attachment["upload_id"])
            except (OSError, ValueError):
                logger.exception("Mail attachment state update failed after commit: mail_id=%s upload_id=%s", mail_id, attachment["upload_id"])
        is_enabled = bool(provider and provider["delivery_enabled"] and provider["last_test_status"] == "success")
        return MailSendResponse(
            mailId=mail_id, status=status_value, sentAt=sent_at, scheduledAt=scheduled_at,
            internalCount=len(internal_by_email), externalCount=len(external_emails),
            queuedCount=len(external_emails) if status_value == "sent" and is_enabled else 0,
            blockedCount=len(external_emails) if status_value == "sent" and not is_enabled else 0,
        )

    def _write_mail_event_audit(
        self,
        cursor,
        *,
        company_id: str,
        actor_user_id: str,
        actor_user_name: str,
        mail_id: str,
        event: str,
        status_before: str | None,
        status_after: str,
        now: datetime,
        reason: str = "UI-018 mail compose",
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
                company_id,
                actor_user_id,
                actor_user_name,
                mail_id,
                event,
                status_before,
                status_after,
                reason,
                now,
            ),
        )

    def _fetch_mail_account(self, cursor, user_id: str) -> dict:
        cursor.execute("SELECT id, email, status, provider_config_id FROM mail_accounts WHERE user_id = %s", (user_id,))
        row = cursor.fetchone()
        if row is None:
            raise ValueError("메일 계정을 찾을 수 없습니다.")
        if row["status"] != "active":
            raise PermissionError("메일 계정이 활성 상태가 아닙니다.")
        return row

    def _fetch_accessible_mail(self, cursor, actor: AuthUserSummary, mail_id: str, *, view: str = "inbox") -> dict:
        allowed_views = {"inbox", "folder", "tag", "spam", "trash", "sent", "draft"}
        if view not in allowed_views:
            raise ValueError("지원하지 않는 메일 상세 문맥입니다.")
        sender_state = "m.sender_deleted_at IS NOT NULL AND m.sender_purged_at IS NULL" if view == "trash" else "m.sender_deleted_at IS NULL AND m.sender_purged_at IS NULL"
        if view == "trash":
            recipient_state = "r.deleted_at IS NOT NULL AND r.purged_at IS NULL"
        elif view == "spam":
            recipient_state = "r.deleted_at IS NULL AND r.purged_at IS NULL AND r.is_spam = TRUE"
        elif view == "inbox":
            recipient_state = "r.deleted_at IS NULL AND r.purged_at IS NULL AND r.is_spam = FALSE AND r.folder_id IS NULL"
        else:
            recipient_state = "r.deleted_at IS NULL AND r.purged_at IS NULL"
        cursor.execute(
            f"""
            SELECT DISTINCT
                m.id AS mail_id, m.company_id, m.sender_user_id, m.sender_account_id AS account_id,
                m.sender_email, m.subject, m.body_text, m.body_html, m.status, m.sent_at, m.scheduled_at,
                m.created_at, m.updated_at, m.retention_expires_at, m.attachment_count,
                (m.sender_user_id = %s AND {sender_state}) AS is_sender_view
            FROM mail_messages m
            LEFT JOIN mail_recipients r ON r.message_id = m.id
            WHERE m.id = %s AND m.company_id = %s
              AND (
                (m.sender_user_id = %s AND {sender_state})
                OR (
                  (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                  AND {recipient_state}
                )
              )
            """,
            (actor.userId, mail_id, actor.companyId, actor.userId, actor.userId, actor.userEmail.lower()),
        )
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("메일을 조회할 권한이 없습니다.")
        return row
    def _fetch_mail_recipients(
        self,
        cursor,
        actor: AuthUserSummary,
        mail_id: str,
        *,
        is_sender_view: bool,
    ) -> list[MailRecipientView]:
        cursor.execute(
            """
            SELECT recipient_email, recipient_user_id, recipient_kind, is_read, is_starred, received_at, read_at
            FROM mail_recipients
            WHERE message_id = %s
              AND (
                recipient_kind <> 'bcc'
                OR %s
                OR recipient_user_id = %s
                OR LOWER(recipient_email) = %s
              )
            ORDER BY recipient_kind, recipient_email
            """,
            (mail_id, is_sender_view, actor.userId, actor.userEmail.lower()),
        )
        return [
            MailRecipientView(
                recipientEmail=row["recipient_email"],
                recipientUserId=row["recipient_user_id"],
                recipientKind=row["recipient_kind"],
                isRead=row["is_read"] if is_sender_view else None,
                isStarred=row["is_starred"] if is_sender_view else None,
                receivedAt=row["received_at"],
                readAt=row["read_at"] if is_sender_view else None,
            )
            for row in cursor.fetchall()
        ]

    def _fetch_source_attachments(
        self,
        cursor,
        actor: AuthUserSummary,
        source_mail_id: str,
        attachment_ids: list[str],
    ) -> list[dict]:
        self._fetch_accessible_mail(cursor, actor, source_mail_id)
        if not attachment_ids:
            return []
        cursor.execute(
            """
            SELECT id, file_name, content_type, size_bytes, storage_key
            FROM mail_attachments
            WHERE message_id = %s
              AND id = ANY(%s)
            """,
            (source_mail_id, attachment_ids),
        )
        rows = cursor.fetchall()
        by_id = {row["id"]: row for row in rows}
        if len(by_id) != len(attachment_ids) or any(attachment_id not in by_id for attachment_id in attachment_ids):
            raise PermissionError("전달할 원문 첨부에 접근할 권한이 없습니다.")
        if any(not row["storage_key"] for row in rows):
            raise ValueError("원문 첨부 파일 저장 상태가 올바르지 않습니다.")
        return [by_id[attachment_id] for attachment_id in attachment_ids]

    def _fetch_external_deliveries(self, cursor, mail_id: str) -> list[ExternalDeliveryView]:
        cursor.execute(
            """SELECT r.recipient_email, r.recipient_kind, q.status, q.attempt_count, q.next_attempt_at, q.sent_at
            FROM mail_delivery_queue q JOIN mail_recipients r ON r.id = q.recipient_id
            WHERE q.mail_id = %s ORDER BY r.recipient_kind, r.recipient_email""",
            (mail_id,),
        )
        return [
            ExternalDeliveryView(
                recipientEmail=row["recipient_email"], recipientKind=row["recipient_kind"],
                status=row["status"], attemptCount=row["attempt_count"],
                nextAttemptAt=row["next_attempt_at"], sentAt=row["sent_at"],
            )
            for row in cursor.fetchall()
        ]

    def _fetch_mail_attachments(self, cursor, mail_id: str) -> list[MailAttachmentView]:
        cursor.execute(
            """
            SELECT id, file_name, content_type, size_bytes
            FROM mail_attachments
            WHERE message_id = %s
            ORDER BY created_at ASC
            """,
            (mail_id,),
        )
        return [
            MailAttachmentView(
                attachmentId=row["id"],
                fileName=row["file_name"],
                contentType=row["content_type"],
                sizeBytes=row["size_bytes"],
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
            scheduledAt=row.get("scheduled_at"),
            retentionExpiresAt=row["retention_expires_at"],
            attachmentCount=row["attachment_count"],
            category=row.get("category") or "primary",
            sourceMailbox=row.get("source_mailbox"),
        )

    def _to_mail_detail(
        self,
        message: dict,
        recipients: list[MailRecipientView],
        attachments: list[MailAttachmentMeta | MailAttachmentView],
        external_deliveries: list[ExternalDeliveryView] | None = None,
    ) -> MailDetailResponse:
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
            scheduledAt=message.get("scheduled_at"),
            createdAt=message["created_at"],
            updatedAt=message["updated_at"],
            retentionExpiresAt=message["retention_expires_at"],
            attachmentCount=message["attachment_count"],
            canViewReadReceipts=bool(message["is_sender_view"]),
            recipients=recipients,
            externalDeliveries=external_deliveries or [],
            attachments=[
                MailAttachmentView(
                    attachmentId=getattr(item, "attachmentId", None),
                    fileName=item.fileName,
                    contentType=item.contentType,
                    sizeBytes=item.sizeBytes,
                )
                for item in attachments
            ],
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
