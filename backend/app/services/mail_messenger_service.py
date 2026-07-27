from __future__ import annotations

from datetime import UTC, datetime, timedelta
from html import escape
import json
import logging
from uuid import uuid4

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from app.core.config import settings
from app.services.mail_delivery_service import MailDeliveryPolicy

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailAttachmentView,
    MailBasicPreferencesResponse,
    MailBasicPreferencesUpdateRequest,
    MailSignatureBulkDeleteRequest,
    MailSignatureCreateRequest,
    MailSignaturePreferencesResponse,
    MailSignaturePreferencesUpdateRequest,
    MailSignatureUpdateRequest,
    MailSignatureView,
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
    MailRecentRecipientBulkDeleteRequest,
    MailRecentRecipientDeleteResponse,
    MailRecentRecipientListResponse,
    MailRecentRecipientSettingsResponse,
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
    MessengerAttachmentMeta,
    MessengerMessageSendRequest,
    MessengerMessageSendResponse,
    MessengerMessageView,
    MessengerReadResponse,
    MessengerRoomCreateRequest,
    MessengerRoomDetailResponse,
    MessengerRoomFavoriteRequest,
    MessengerRoomListResponse,
    MessengerRoomParticipantsRequest,
    MessengerRoomSummary,
)
from app.services.postgres_service import PostgresService
from app.services.spam_settings_service import SpamDecision, SpamSettingsService, normalize_spam_email
from app.services.mail_auto_classification_service import AutoClassificationTargetInUseError, MailAutoClassificationService
from app.services.mail_auto_forwarding_service import MailAutoForwardingService
from app.services.mail_out_of_office_service import MailOutOfOfficeService

logger = logging.getLogger(__name__)


class MailPreferenceConflictError(RuntimeError):
    pass

from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.messenger_attachment_storage import MessengerAttachmentStorage, MessengerAttachmentTooLargeError


class MailSignatureConflictError(RuntimeError):
    pass


class MessengerConflictError(RuntimeError):
    pass


class MailMessengerService:
    def __init__(self) -> None:
        self.db = PostgresService()
        self.attachment_storage = MailAttachmentStorage()
        self.messenger_attachment_storage = MessengerAttachmentStorage()
        self.spam_settings = SpamSettingsService()
        self.auto_classification = MailAutoClassificationService()
        self.auto_forwarding = MailAutoForwardingService()
        self.out_of_office = MailOutOfOfficeService()

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
                        m.sender_display_name,
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
                        m.sender_display_name,
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
                      AND m.sender_copy_saved = TRUE
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
                        m.sender_display_name,
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
                        m.sender_display_name,
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
        if mailbox == "sent":
            conditions.append("m.sender_copy_saved = TRUE")
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
                        m.sender_display_name,
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
                preferences = self._ensure_basic_preferences(cursor, actor)
            connection.commit()
        return self._to_mail_detail(message, recipients, attachments, external_deliveries, preferences)

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
                    SELECT id, recipient_email AS email, recipient_name AS name,
                           department_name, last_used_at, use_count
                    FROM user_recent_mail_recipients
                    WHERE company_id = %s AND owner_user_id = %s
                    ORDER BY last_used_at DESC, id
                    LIMIT %s
                    """,
                    (actor.companyId, actor.userId, limit),
                )
                recipients = [
                    MailRecentRecipient(
                        recipientId=row["id"],
                        email=row["email"],
                        name=row["name"],
                        departmentName=row["department_name"],
                        lastUsedAt=row["last_used_at"],
                        useCount=row["use_count"],
                    )
                    for row in cursor.fetchall()
                ]
        return MailRecentRecipientListResponse(recipients=recipients)

    def list_recent_recipient_settings(self, actor: AuthUserSummary, limit: int = 200) -> MailRecentRecipientSettingsResponse:
        response = self.list_recent_recipients(actor, limit)
        return MailRecentRecipientSettingsResponse(recipients=response.recipients, totalCount=len(response.recipients))

    def delete_recent_recipient(self, actor: AuthUserSummary, recipient_id: str) -> MailRecentRecipientDeleteResponse:
        payload = MailRecentRecipientBulkDeleteRequest(recipientIds=[recipient_id])
        return self.bulk_delete_recent_recipients(actor, payload)

    def bulk_delete_recent_recipients(
        self,
        actor: AuthUserSummary,
        payload: MailRecentRecipientBulkDeleteRequest,
    ) -> MailRecentRecipientDeleteResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                if payload.deleteAll:
                    cursor.execute(
                        """SELECT id FROM user_recent_mail_recipients
                        WHERE company_id = %s AND owner_user_id = %s FOR UPDATE""",
                        (actor.companyId, actor.userId),
                    )
                    locked_ids = [row["id"] for row in cursor.fetchall()]
                else:
                    requested_ids = payload.recipientIds or []
                    cursor.execute(
                        """SELECT id FROM user_recent_mail_recipients
                        WHERE company_id = %s AND owner_user_id = %s AND id = ANY(%s)
                        FOR UPDATE""",
                        (actor.companyId, actor.userId, requested_ids),
                    )
                    locked_ids = [row["id"] for row in cursor.fetchall()]
                    if len(locked_ids) != len(requested_ids):
                        raise PermissionError("최근 주소를 삭제할 권한이 없습니다.")
                requested_count = len(locked_ids) if payload.deleteAll else len(payload.recipientIds or [])
                changed_count = 0
                if locked_ids:
                    cursor.execute(
                        """DELETE FROM user_recent_mail_recipients
                        WHERE company_id = %s AND owner_user_id = %s AND id = ANY(%s)""",
                        (actor.companyId, actor.userId, locked_ids),
                    )
                    changed_count = cursor.rowcount
                self._write_recent_recipient_audit(
                    cursor, actor, "mail.recent_recipients.deleted", changed_count, now
                )
            connection.commit()
        return MailRecentRecipientDeleteResponse(
            requestedCount=requested_count,
            changedCount=changed_count,
        )

    def _write_recent_recipient_audit(
        self,
        cursor,
        actor: AuthUserSummary,
        event: str,
        count: int,
        now: datetime,
    ) -> None:
        reason = json.dumps({"count": count}, ensure_ascii=True, separators=(",", ":"))
        cursor.execute(
            """INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                event, status_before, status_after, reason, created_at
            ) VALUES (%s,%s,%s,%s,'mail_recent_recipients',%s,%s,NULL,NULL,%s,%s)""",
            (self._new_id("audit"), actor.companyId, actor.userId, actor.userName, actor.userId, event, reason, now),
        )

    def _upsert_recent_recipients(
        self,
        cursor,
        *,
        company_id: str,
        owner_user_id: str,
        recipient_emails: list[str],
        now: datetime,
    ) -> None:
        normalized = list(dict.fromkeys(email.strip().lower() for email in recipient_emails if email.strip()))
        if not normalized:
            return
        cursor.execute(
            """SELECT LOWER(u.email) AS email, u.name, d.name AS department_name
            FROM users u LEFT JOIN departments d ON d.id = u.department_id
            WHERE u.company_id = %s AND LOWER(u.email) = ANY(%s)""",
            (company_id, normalized),
        )
        directory = {row["email"]: row for row in cursor.fetchall()}
        for email in normalized:
            person = directory.get(email, {})
            cursor.execute(
                """INSERT INTO user_recent_mail_recipients (
                    id, company_id, owner_user_id, recipient_email, recipient_name,
                    department_name, last_used_at, use_count, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s,%s)
                ON CONFLICT (company_id, owner_user_id, (LOWER(recipient_email))) DO UPDATE SET
                    recipient_name = COALESCE(EXCLUDED.recipient_name, user_recent_mail_recipients.recipient_name),
                    department_name = COALESCE(EXCLUDED.department_name, user_recent_mail_recipients.department_name),
                    last_used_at = EXCLUDED.last_used_at,
                    use_count = user_recent_mail_recipients.use_count + 1,
                    updated_at = EXCLUDED.updated_at""",
                (
                    self._new_id("recent"), company_id, owner_user_id, email,
                    person.get("name"), person.get("department_name"), now, now, now,
                ),
            )
        cursor.execute(
            """DELETE FROM user_recent_mail_recipients WHERE id IN (
                SELECT id FROM user_recent_mail_recipients
                WHERE company_id = %s AND owner_user_id = %s
                ORDER BY last_used_at DESC, id OFFSET 200
            )""",
            (company_id, owner_user_id),
        )

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

    def get_basic_preferences(self, actor: AuthUserSummary) -> MailBasicPreferencesResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                row = self._ensure_basic_preferences(cursor, actor)
            connection.commit()
        return self._to_basic_preferences(row)

    def update_basic_preferences(self, actor: AuthUserSummary, payload: MailBasicPreferencesUpdateRequest) -> MailBasicPreferencesResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        values = payload.model_dump(exclude={"expectedVersion"})
        columns = {
            "senderDisplayMode": "sender_display_mode", "blockRemoteImages": "block_remote_images",
            "disableRiskyTags": "disable_risky_tags", "showRouteCountry": "show_route_country",
            "includeSpamTrashInSearch": "include_spam_trash_in_search", "showListPreview": "show_list_preview",
            "recipientInputMode": "recipient_input_mode", "confirmBeforeSend": "confirm_before_send",
            "saveSentCopy": "save_sent_copy", "readReceiptEnabled": "read_receipt_enabled",
            "editorMode": "editor_mode", "composeMode": "compose_mode", "messageEncoding": "message_encoding",
            "draftReminderEnabled": "draft_reminder_enabled", "senderDisplayName": "sender_display_name",
            "replyToEmail": "reply_to_email", "vcardEnabled": "vcard_enabled",
        }
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                before = self._ensure_basic_preferences(cursor, actor)
                changed = [key for key, column in columns.items() if before[column] != values[key]]
                assignments = ", ".join(f"{column} = %s" for column in columns.values())
                cursor.execute(
                    f"""UPDATE user_mail_basic_preferences SET {assignments}, version = version + 1, updated_at = %s
                    WHERE company_id = %s AND owner_user_id = %s AND version = %s RETURNING *""",
                    tuple(values[key] for key in columns) + (now, actor.companyId, actor.userId, payload.expectedVersion),
                )
                row = cursor.fetchone()
                if row is None:
                    raise MailPreferenceConflictError("다른 위치에서 설정이 변경되었습니다. 최신값을 다시 불러오세요.")
                self._write_preference_audit(cursor, actor, "mail.preferences.basic.update", changed, now)
            connection.commit()
        return self._to_basic_preferences(row)

    def reset_basic_preferences(self, actor: AuthUserSummary) -> MailBasicPreferencesResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._ensure_basic_preferences(cursor, actor)
                cursor.execute(
                    """UPDATE user_mail_basic_preferences SET
                    sender_display_mode = 'name_email', block_remote_images = TRUE, disable_risky_tags = TRUE,
                    show_route_country = FALSE, include_spam_trash_in_search = FALSE, show_list_preview = TRUE,
                    recipient_input_mode = 'autocomplete', confirm_before_send = TRUE, save_sent_copy = TRUE,
                    read_receipt_enabled = TRUE, editor_mode = 'html', compose_mode = 'normal',
                    message_encoding = 'utf-8', draft_reminder_enabled = FALSE, sender_display_name = '',
                    reply_to_email = NULL, vcard_enabled = FALSE, version = version + 1, updated_at = %s
                    WHERE company_id = %s AND owner_user_id = %s RETURNING *""",
                    (now, actor.companyId, actor.userId),
                )
                row = cursor.fetchone()
                if row is None:
                    raise PermissionError("메일 설정을 초기화할 권한이 없습니다.")
                self._write_preference_audit(cursor, actor, "mail.preferences.basic.reset", ["defaults"], now)
            connection.commit()
        return self._to_basic_preferences(row)

    def send_mail(self, actor: AuthUserSummary, payload: MailSendRequest) -> MailSendResponse:
        if not payload.to and not payload.cc and not payload.bcc:
            raise ValueError("수신자를 1명 이상 입력해야 합니다.")
        preferences = self.get_basic_preferences(actor)
        if preferences.confirmBeforeSend and not payload.confirmed:
            raise ValueError("발송 전 확인이 필요합니다.")
        status_value = "scheduled" if payload.scheduledAt is not None else "sent"
        return self._save_mail(actor, payload, status_value=status_value)

    def _ensure_basic_preferences(self, cursor, actor: AuthUserSummary) -> dict:
        cursor.execute("INSERT INTO user_mail_basic_preferences (owner_user_id, company_id) VALUES (%s, %s) ON CONFLICT (owner_user_id) DO NOTHING", (actor.userId, actor.companyId))
        cursor.execute("SELECT * FROM user_mail_basic_preferences WHERE company_id = %s AND owner_user_id = %s", (actor.companyId, actor.userId))
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("메일 설정을 조회할 권한이 없습니다.")
        return row

    @staticmethod
    def _to_basic_preferences(row: dict) -> MailBasicPreferencesResponse:
        return MailBasicPreferencesResponse(
            senderDisplayMode=row["sender_display_mode"], blockRemoteImages=row["block_remote_images"], disableRiskyTags=row["disable_risky_tags"],
            showRouteCountry=row["show_route_country"], includeSpamTrashInSearch=row["include_spam_trash_in_search"], showListPreview=row["show_list_preview"],
            recipientInputMode=row["recipient_input_mode"], confirmBeforeSend=row["confirm_before_send"], saveSentCopy=row["save_sent_copy"],
            readReceiptEnabled=row["read_receipt_enabled"], editorMode=row["editor_mode"], composeMode=row["compose_mode"], messageEncoding=row["message_encoding"],
            draftReminderEnabled=row["draft_reminder_enabled"], senderDisplayName=row["sender_display_name"], replyToEmail=row["reply_to_email"],
            vcardEnabled=row["vcard_enabled"], version=row["version"], updatedAt=row["updated_at"],
        )

    def _write_preference_audit(self, cursor, actor: AuthUserSummary, event: str, changed_fields: list[str], now: datetime) -> None:
        field_names = json.dumps({"changedFields": changed_fields}, ensure_ascii=False, sort_keys=True)
        cursor.execute(
            """INSERT INTO audit_logs (id, company_id, actor_user_id, actor_user_name, target_type, target_id, event, status_before, status_after, reason, created_at)
            VALUES (%s,%s,%s,%s,'mail_preferences',%s,%s,NULL,NULL,%s,%s)""",
            (self._new_id("audit"), actor.companyId, actor.userId, actor.userName, actor.userId, event, field_names, now),
        )

    def get_signatures(self, actor: AuthUserSummary) -> MailSignaturePreferencesResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                preferences = self._ensure_signature_preferences(cursor, actor)
                response = self._signature_preferences_response(cursor, actor, preferences)
            connection.commit()
        return response

    def create_signature(self, actor: AuthUserSummary, payload: MailSignatureCreateRequest) -> MailSignatureView:
        self.db.ensure_migrations_applied()
        now = self._now()
        signature_id = self._new_id("mailsig")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_signature_owner(cursor, actor)
                preferences = self._ensure_signature_preferences(cursor, actor, lock=True)
                cursor.execute(
                    "SELECT COUNT(*)::INTEGER AS count FROM user_mail_signatures WHERE company_id = %s AND owner_user_id = %s",
                    (actor.companyId, actor.userId),
                )
                count = int(cursor.fetchone()["count"])
                if count >= 20:
                    raise ValueError("서명은 최대 20개까지 등록할 수 있습니다.")
                self._assert_signature_name_available(cursor, actor, payload.name)
                try:
                    cursor.execute(
                        """INSERT INTO user_mail_signatures
                        (id, company_id, owner_user_id, name, content_text, version, created_at, updated_at)
                        VALUES (%s,%s,%s,%s,%s,1,%s,%s) RETURNING *""",
                        (signature_id, actor.companyId, actor.userId, payload.name, payload.contentText, now, now),
                    )
                except UniqueViolation as exc:
                    raise MailSignatureConflictError("같은 이름의 서명이 이미 있습니다.") from exc
                row = cursor.fetchone()
                if count == 0 or payload.makeDefault:
                    cursor.execute(
                        """UPDATE user_mail_signature_preferences
                        SET default_signature_id = %s, version = version + 1, updated_at = %s
                        WHERE company_id = %s AND owner_user_id = %s AND version = %s RETURNING *""",
                        (signature_id, now, actor.companyId, actor.userId, preferences["version"]),
                    )
                    if cursor.fetchone() is None:
                        raise MailSignatureConflictError("다른 위치에서 서명 설정이 변경되었습니다. 최신값을 다시 불러오세요.")
                self._write_signature_audit(cursor, actor, signature_id, "mail.signature.created", ["name", "contentText", "default" if count == 0 or payload.makeDefault else "created"], now)
            connection.commit()
        return self._to_signature_view(row)

    def update_signature(self, actor: AuthUserSummary, signature_id: str, payload: MailSignatureUpdateRequest) -> MailSignatureView:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM user_mail_signatures WHERE id = %s AND company_id = %s AND owner_user_id = %s FOR UPDATE",
                    (signature_id, actor.companyId, actor.userId),
                )
                before = cursor.fetchone()
                if before is None:
                    raise PermissionError("서명을 수정할 권한이 없습니다.")
                if before["version"] != payload.expectedVersion:
                    raise MailSignatureConflictError("다른 위치에서 서명이 변경되었습니다. 최신값을 다시 불러오세요.")
                self._assert_signature_name_available(cursor, actor, payload.name, exclude_id=signature_id)
                try:
                    cursor.execute(
                        """UPDATE user_mail_signatures SET name = %s, content_text = %s,
                        version = version + 1, updated_at = %s
                        WHERE id = %s AND company_id = %s AND owner_user_id = %s AND version = %s RETURNING *""",
                        (payload.name, payload.contentText, now, signature_id, actor.companyId, actor.userId, payload.expectedVersion),
                    )
                except UniqueViolation as exc:
                    raise MailSignatureConflictError("같은 이름의 서명이 이미 있습니다.") from exc
                row = cursor.fetchone()
                if row is None:
                    raise MailSignatureConflictError("다른 위치에서 서명이 변경되었습니다. 최신값을 다시 불러오세요.")
                changed = [field for field, key in (("name", "name"), ("contentText", "content_text")) if before[key] != getattr(payload, field)]
                self._write_signature_audit(cursor, actor, signature_id, "mail.signature.updated", changed, now)
            connection.commit()
        return self._to_signature_view(row)

    def delete_signature(self, actor: AuthUserSummary, signature_id: str, expected_version: int) -> MailSignaturePreferencesResponse:
        return self._delete_signatures(actor, [(signature_id, expected_version)])

    def bulk_delete_signatures(self, actor: AuthUserSummary, payload: MailSignatureBulkDeleteRequest) -> MailSignaturePreferencesResponse:
        return self._delete_signatures(actor, [(item.signatureId, item.expectedVersion) for item in payload.items])

    def _delete_signatures(self, actor: AuthUserSummary, items: list[tuple[str, int]]) -> MailSignaturePreferencesResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_signature_owner(cursor, actor)
                preferences = self._ensure_signature_preferences(cursor, actor, lock=True)
                rows: list[dict] = []
                for signature_id, expected_version in items:
                    cursor.execute(
                        "SELECT * FROM user_mail_signatures WHERE id = %s AND company_id = %s AND owner_user_id = %s FOR UPDATE",
                        (signature_id, actor.companyId, actor.userId),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        raise PermissionError("서명을 삭제할 권한이 없습니다.")
                    if row["version"] != expected_version:
                        raise MailSignatureConflictError("다른 위치에서 서명이 변경되었습니다. 최신값을 다시 불러오세요.")
                    rows.append(row)
                for row in rows:
                    cursor.execute(
                        "DELETE FROM user_mail_signatures WHERE id = %s AND company_id = %s AND owner_user_id = %s AND version = %s",
                        (row["id"], actor.companyId, actor.userId, row["version"]),
                    )
                    self._write_signature_audit(cursor, actor, row["id"], "mail.signature.deleted", ["deleted"], now)
                deleted_ids = {row["id"] for row in rows}
                if preferences["default_signature_id"] in deleted_ids:
                    cursor.execute(
                        """SELECT id FROM user_mail_signatures
                        WHERE company_id = %s AND owner_user_id = %s
                        ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1""",
                        (actor.companyId, actor.userId),
                    )
                    latest = cursor.fetchone()
                    next_default = latest["id"] if latest else None
                    cursor.execute(
                        """UPDATE user_mail_signature_preferences
                        SET default_signature_id = %s, enabled = CASE WHEN %s::TEXT IS NULL THEN FALSE ELSE enabled END,
                            version = version + 1, updated_at = %s
                        WHERE company_id = %s AND owner_user_id = %s AND version = %s RETURNING *""",
                        (next_default, next_default, now, actor.companyId, actor.userId, preferences["version"]),
                    )
                    preferences = cursor.fetchone()
                    if preferences is None:
                        raise MailSignatureConflictError("다른 위치에서 서명 설정이 변경되었습니다. 최신값을 다시 불러오세요.")
                    self._write_signature_audit(cursor, actor, actor.userId, "mail.signature.preferences.updated", ["defaultSignatureId", "enabled"], now)
                response = self._signature_preferences_response(cursor, actor, preferences)
            connection.commit()
        return response

    def update_signature_preferences(self, actor: AuthUserSummary, payload: MailSignaturePreferencesUpdateRequest) -> MailSignaturePreferencesResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                preferences = self._ensure_signature_preferences(cursor, actor, lock=True)
                if preferences["version"] != payload.expectedVersion:
                    raise MailSignatureConflictError("다른 위치에서 서명 설정이 변경되었습니다. 최신값을 다시 불러오세요.")
                if payload.defaultSignatureId:
                    cursor.execute(
                        "SELECT id FROM user_mail_signatures WHERE id = %s AND company_id = %s AND owner_user_id = %s",
                        (payload.defaultSignatureId, actor.companyId, actor.userId),
                    )
                    if cursor.fetchone() is None:
                        raise PermissionError("기본 서명을 지정할 권한이 없습니다.")
                cursor.execute(
                    """UPDATE user_mail_signature_preferences
                    SET enabled = %s, position = %s, default_signature_id = %s,
                        version = version + 1, updated_at = %s
                    WHERE company_id = %s AND owner_user_id = %s AND version = %s RETURNING *""",
                    (payload.enabled, payload.position, payload.defaultSignatureId, now, actor.companyId, actor.userId, payload.expectedVersion),
                )
                updated = cursor.fetchone()
                if updated is None:
                    raise MailSignatureConflictError("다른 위치에서 서명 설정이 변경되었습니다. 최신값을 다시 불러오세요.")
                changed = [field for field, key in (("enabled", "enabled"), ("position", "position"), ("defaultSignatureId", "default_signature_id")) if preferences[key] != getattr(payload, field)]
                self._write_signature_audit(cursor, actor, actor.userId, "mail.signature.preferences.updated", changed, now)
                response = self._signature_preferences_response(cursor, actor, updated)
            connection.commit()
        return response

    def _lock_signature_owner(self, cursor, actor: AuthUserSummary) -> None:
        cursor.execute("SELECT id FROM users WHERE id = %s AND company_id = %s FOR UPDATE", (actor.userId, actor.companyId))
        if cursor.fetchone() is None:
            raise PermissionError("서명을 관리할 권한이 없습니다.")

    def _ensure_signature_preferences(self, cursor, actor: AuthUserSummary, *, lock: bool = False) -> dict:
        cursor.execute(
            "INSERT INTO user_mail_signature_preferences (owner_user_id, company_id) VALUES (%s, %s) ON CONFLICT (owner_user_id) DO NOTHING",
            (actor.userId, actor.companyId),
        )
        suffix = " FOR UPDATE" if lock else ""
        cursor.execute(
            "SELECT * FROM user_mail_signature_preferences WHERE company_id = %s AND owner_user_id = %s" + suffix,
            (actor.companyId, actor.userId),
        )
        row = cursor.fetchone()
        if row is None:
            raise PermissionError("서명 설정을 조회할 권한이 없습니다.")
        return row

    def _assert_signature_name_available(self, cursor, actor: AuthUserSummary, name: str, *, exclude_id: str | None = None) -> None:
        query = "SELECT id FROM user_mail_signatures WHERE company_id = %s AND owner_user_id = %s AND LOWER(name) = LOWER(%s)"
        params: tuple[object, ...] = (actor.companyId, actor.userId, name)
        if exclude_id is not None:
            query += " AND id <> %s"
            params += (exclude_id,)
        cursor.execute(query, params)
        if cursor.fetchone() is not None:
            raise MailSignatureConflictError("같은 이름의 서명이 이미 있습니다.")

    def _signature_preferences_response(self, cursor, actor: AuthUserSummary, preferences: dict) -> MailSignaturePreferencesResponse:
        cursor.execute(
            """SELECT * FROM user_mail_signatures WHERE company_id = %s AND owner_user_id = %s
            ORDER BY updated_at DESC, created_at DESC, id DESC""",
            (actor.companyId, actor.userId),
        )
        return MailSignaturePreferencesResponse(
            enabled=preferences["enabled"], position=preferences["position"],
            defaultSignatureId=preferences["default_signature_id"], version=preferences["version"],
            updatedAt=preferences["updated_at"], signatures=[self._to_signature_view(row) for row in cursor.fetchall()],
        )

    @staticmethod
    def _to_signature_view(row: dict) -> MailSignatureView:
        return MailSignatureView(
            signatureId=row["id"], name=row["name"], contentText=row["content_text"],
            version=row["version"], createdAt=row["created_at"], updatedAt=row["updated_at"],
        )

    def _write_signature_audit(self, cursor, actor: AuthUserSummary, target_id: str, event: str, changed_fields: list[str], now: datetime) -> None:
        reason = json.dumps({"changedFields": changed_fields}, ensure_ascii=False, sort_keys=True)
        cursor.execute(
            """INSERT INTO audit_logs
            (id, company_id, actor_user_id, actor_user_name, target_type, target_id, event, status_before, status_after, reason, created_at)
            VALUES (%s,%s,%s,%s,'mail_signature',%s,%s,NULL,NULL,%s,%s)""",
            (self._new_id("audit"), actor.companyId, actor.userId, actor.userName, target_id, event, reason, now),
        )

    @staticmethod
    def _fetch_enabled_signature(cursor, actor: AuthUserSummary) -> dict | None:
        cursor.execute(
            """SELECT s.content_text, p.position
            FROM user_mail_signature_preferences p
            JOIN user_mail_signatures s ON s.id = p.default_signature_id
                AND s.company_id = p.company_id AND s.owner_user_id = p.owner_user_id
            WHERE p.company_id = %s AND p.owner_user_id = %s AND p.enabled = TRUE""",
            (actor.companyId, actor.userId),
        )
        return cursor.fetchone()

    @staticmethod
    def _compose_signature_body(body_text: str, body_html: str | None, signature: dict | None) -> tuple[str, str | None]:
        if not signature:
            return body_text, body_html
        signature_text = signature["content_text"]
        delimiter = "\n\n-- \n"
        if signature["position"] == "body_top":
            final_text = signature_text + delimiter + body_text
        else:
            final_text = body_text + delimiter + signature_text
        if body_html is None:
            return final_text, None
        signature_html = '<div data-mail-signature="true"><pre>' + escape(signature_text) + "</pre></div>"
        separator_html = '<hr data-mail-signature-separator="true">'
        final_html = signature_html + separator_html + body_html if signature["position"] == "body_top" else body_html + separator_html + signature_html
        return final_text, final_html

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
                    SELECT id, company_id, sender_user_id, sender_email, subject, body_text, attachment_count, is_auto_generated
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
                        """SELECT recipient_email FROM mail_recipients
                        WHERE message_id = %s AND delivery_source = 'direct'""",
                        (row["id"],),
                    )
                    self._upsert_recent_recipients(
                        cursor,
                        company_id=row["company_id"],
                        owner_user_id=row["sender_user_id"],
                        recipient_emails=[item["recipient_email"] for item in cursor.fetchall()],
                        now=now,
                    )
                    cursor.execute(
                        """SELECT id, recipient_user_id, recipient_email FROM mail_recipients
                           WHERE message_id = %s AND recipient_user_id IS NOT NULL
                             AND received_at IS NULL AND delivery_source = 'direct'
                           FOR UPDATE""",
                        (row["id"],),
                    )
                    internal_recipients = cursor.fetchall()
                    for recipient in internal_recipients:
                        spam_decision = self._evaluate_recipient_spam_for_company(
                            cursor,
                            row["company_id"],
                            recipient["recipient_user_id"],
                            row["sender_email"],
                            row["id"],
                        )
                        cursor.execute(
                            """UPDATE mail_recipients SET received_at = %s, is_spam = %s, spam_marked_at = %s
                               WHERE id = %s AND message_id = %s AND recipient_user_id = %s""",
                            (
                                now,
                                spam_decision.decision == "spam",
                                now if spam_decision.decision == "spam" else None,
                                recipient["id"],
                                row["id"],
                                recipient["recipient_user_id"],
                            ),
                        )
                        self._write_spam_classification_audit_for_actor(
                            cursor,
                            company_id=row["company_id"],
                            actor_user_id=row["sender_user_id"],
                            actor_user_name="system",
                            mail_id=row["id"],
                            recipient_user_id=recipient["recipient_user_id"],
                            decision=spam_decision,
                            now=now,
                        )
                        if spam_decision.decision != "spam":
                            self._apply_auto_classification(
                                cursor, company_id=row["company_id"], recipient_user_id=recipient["recipient_user_id"],
                                actor_user_id=row["sender_user_id"], actor_user_name="system", mail_id=row["id"],
                                recipient_id=recipient["id"], sender_email=row["sender_email"], recipient_email=recipient["recipient_email"],
                                subject=row.get("subject") or "", body=row.get("body_text") or "", has_attachment=bool(row.get("attachment_count")), now=now,
                            )
                            self._apply_auto_forwarding(
                                cursor, company_id=row["company_id"], recipient_user_id=recipient["recipient_user_id"],
                                actor_user_id=row["sender_user_id"], actor_user_name="system", mail_id=row["id"],
                                recipient_id=recipient["id"], sender_email=row["sender_email"], recipient_email=recipient["recipient_email"],
                                delivery_source="direct", subject=row.get("subject") or "", body=row.get("body_text") or "",
                                has_attachment=bool(row.get("attachment_count")), now=now,
                            )
                            self._apply_out_of_office(
                                cursor, company_id=row["company_id"], recipient_user_id=recipient["recipient_user_id"],
                                actor_user_id=row["sender_user_id"], actor_user_name="system", mail_id=row["id"],
                                recipient_id=recipient["id"], sender_email=row["sender_email"], delivery_source="direct",
                                is_auto_generated=bool(row.get("is_auto_generated")), is_spam=False, now=now,
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
                        SELECT %s || '_' || q.id, q.company_id, %s, 'system', 'mail_delivery_queue', q.id,
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
                cursor.execute("SELECT id FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s AND target_folder_id = %s LIMIT 1", (actor.companyId, actor.userId, folder_id))
                if cursor.fetchone():
                    raise AutoClassificationTargetInUseError("자동분류 규칙에서 사용하는 메일함은 삭제할 수 없습니다.")
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
                cursor.execute("SELECT r.id FROM mail_auto_classification_rule_tags rt JOIN mail_auto_classification_rules r ON r.id = rt.rule_id WHERE r.company_id = %s AND r.user_id = %s AND rt.tag_id = %s LIMIT 1", (actor.companyId, actor.userId, tag_id))
                if cursor.fetchone():
                    raise AutoClassificationTargetInUseError("자동분류 규칙에서 사용하는 태그는 삭제할 수 없습니다.")
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
            SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.sender_display_name, m.subject,
              LEFT(COALESCE(m.body_text, ''), 240) AS preview_text, m.status, m.sent_at, m.scheduled_at,
              m.retention_expires_at, m.attachment_count, r.is_read, r.is_starred, r.received_at,
              COALESCE(r.inbox_category, 'primary') AS category, 'inbox' AS source_mailbox,
              r.deleted_at AS trashed_at
            FROM mail_recipients r JOIN mail_messages m ON m.id = r.message_id
            WHERE m.company_id = %s AND (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
              AND r.deleted_at IS NOT NULL AND r.purged_at IS NULL {search_recipient}
            UNION ALL
            SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.sender_display_name, m.subject,
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
                    SELECT m.id AS mail_id, m.sender_account_id AS account_id, m.sender_email, m.sender_display_name, m.subject,
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
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT room.id AS room_id, room.room_type, room.room_name, room.created_by_user_id,
                       room.created_at, room.updated_at, room.retention_expires_at,
                       self_member.is_favorite,
                       COALESCE(member_ids.participant_ids, '[]'::jsonb) AS participant_ids,
                       COALESCE(member_ids.participant_count, 0) AS participant_count,
                       last_msg.body AS last_message, last_msg.created_at AS last_message_at,
                       COALESCE(unread.unread_count, 0) AS unread_count
                FROM messenger_rooms room
                JOIN messenger_room_members self_member ON self_member.room_id=room.id AND self_member.user_id=%s
                LEFT JOIN LATERAL (
                    SELECT jsonb_agg(member.user_id ORDER BY member.joined_at) AS participant_ids, COUNT(*) AS participant_count
                    FROM messenger_room_members member
                    JOIN users active_member ON active_member.id=member.user_id AND active_member.status='active'
                    WHERE member.room_id=room.id
                ) member_ids ON TRUE
                LEFT JOIN LATERAL (
                    SELECT body,created_at FROM messenger_messages WHERE room_id=room.id ORDER BY created_at DESC LIMIT 1
                ) last_msg ON TRUE
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS unread_count FROM messenger_messages msg
                    LEFT JOIN messenger_message_reads reads ON reads.message_id=msg.id AND reads.user_id=%s
                    WHERE msg.room_id=room.id AND msg.sender_user_id<>%s AND reads.id IS NULL
                ) unread ON TRUE
                WHERE room.company_id=%s
                ORDER BY self_member.is_favorite DESC,COALESCE(last_msg.created_at,room.updated_at) DESC
                """,
                (actor.userId, actor.userId, actor.userId, actor.companyId),
            )
            rooms = [self._to_room_summary(row, actor.userId) for row in cursor.fetchall()]
        return MessengerRoomListResponse(rooms=rooms)

    def create_room(self, actor: AuthUserSummary, payload: MessengerRoomCreateRequest) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        room_id = self._new_id("room")
        if len(payload.participantUserIds) > 100:
            raise ValueError("대화방 참여자는 최대 100명까지 지정할 수 있습니다.")
        participant_ids = self._dedupe([actor.userId, *payload.participantUserIds])
        if len(participant_ids) > 100:
            raise ValueError("대화방 참여자는 본인을 포함해 최대 100명입니다.")
        if len(participant_ids) < 2 or (payload.roomType == "direct" and len(participant_ids) != 2):
            raise ValueError("대화방은 본인을 포함해 2명 이상이어야 합니다.")
        with self.db.connect() as connection, connection.cursor() as cursor:
            users = self._fetch_company_users(cursor, actor.companyId, participant_ids, lock=True)
            if set(users) != set(participant_ids):
                raise ValueError("같은 회사의 활성 사용자만 참여할 수 있습니다.")
            cursor.execute(
                """INSERT INTO messenger_rooms
                (id,company_id,room_type,room_name,created_by_user_id,created_at,updated_at,retention_expires_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (room_id, actor.companyId, payload.roomType, payload.roomName, actor.userId, now, now, now + timedelta(days=14)),
            )
            for user_id in participant_ids:
                cursor.execute(
                    "INSERT INTO messenger_room_members (id,room_id,user_id,joined_at) VALUES (%s,%s,%s,%s)",
                    (self._new_id("member"), room_id, user_id, now),
                )
            self._write_messenger_audit(cursor, actor, room_id, "messenger.room.created", None, "active", {"participantUserIds": participant_ids}, now)
            connection.commit()
        return self.get_room(actor, room_id)

    def get_room(self, actor: AuthUserSummary, room_id: str) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection, connection.cursor() as cursor:
            room = self._fetch_accessible_room(cursor, actor, room_id)
            participants = self._fetch_room_participants(cursor, room_id)
            summary = self._room_row_to_summary_with_participants(cursor, actor, room)
        return MessengerRoomDetailResponse(**summary.model_dump(), participants=participants)

    def update_room_favorite(self, actor: AuthUserSummary, room_id: str, payload: MessengerRoomFavoriteRequest) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._fetch_accessible_room(cursor, actor, room_id)
            cursor.execute(
                "SELECT is_favorite FROM messenger_room_members WHERE room_id=%s AND user_id=%s FOR UPDATE",
                (room_id, actor.userId),
            )
            before = bool(cursor.fetchone()["is_favorite"])
            if before != payload.isFavorite:
                cursor.execute(
                    "UPDATE messenger_room_members SET is_favorite=%s WHERE room_id=%s AND user_id=%s",
                    (payload.isFavorite, room_id, actor.userId),
                )
                self._write_messenger_audit(cursor, actor, room_id, "messenger.room.favorite_changed", str(before).lower(), str(payload.isFavorite).lower(), None, now)
            connection.commit()
        return self.get_room(actor, room_id)

    def update_room_participants(self, actor: AuthUserSummary, room_id: str, payload: MessengerRoomParticipantsRequest) -> MessengerRoomDetailResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        if len(payload.participantUserIds) > 100:
            raise ValueError("대화방 참여자는 최대 100명까지 지정할 수 있습니다.")
        participant_ids = self._dedupe(payload.participantUserIds)
        if len(participant_ids) > 100:
            raise ValueError("대화방 참여자는 최대 100명까지 지정할 수 있습니다.")
        if actor.userId not in participant_ids or len(participant_ids) < 2:
            raise ValueError("방 생성자를 포함한 최소 2명의 참여자가 필요합니다.")
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM messenger_rooms WHERE id=%s AND company_id=%s FOR UPDATE",
                (room_id, actor.companyId),
            )
            room = cursor.fetchone()
            if room is None:
                raise PermissionError("대화방에 접근할 권한이 없습니다.")
            if room["created_by_user_id"] != actor.userId:
                raise PermissionError("방 생성자만 참여자를 변경할 수 있습니다.")
            if room["room_type"] == "direct" and len(participant_ids) != 2:
                raise ValueError("1:1 대화방은 본인을 포함해 정확히 2명이어야 합니다.")
            if room["updated_at"] != payload.expectedUpdatedAt:
                raise MessengerConflictError("대화방이 변경되었습니다. 새로고침 후 다시 시도하세요.")
            users = self._fetch_company_users(cursor, actor.companyId, participant_ids, lock=True)
            if set(users) != set(participant_ids):
                raise ValueError("같은 회사의 활성 사용자만 참여할 수 있습니다.")
            cursor.execute("SELECT user_id FROM messenger_room_members WHERE room_id=%s ORDER BY user_id FOR UPDATE", (room_id,))
            before_ids = [row["user_id"] for row in cursor.fetchall()]
            removed = [user_id for user_id in before_ids if user_id not in participant_ids]
            added = [user_id for user_id in participant_ids if user_id not in before_ids]
            if removed:
                cursor.execute("DELETE FROM messenger_room_members WHERE room_id=%s AND user_id=ANY(%s)", (room_id, removed))
            for user_id in added:
                cursor.execute(
                    "INSERT INTO messenger_room_members (id,room_id,user_id,joined_at) VALUES (%s,%s,%s,%s)",
                    (self._new_id("member"), room_id, user_id, now),
                )
            if removed or added:
                cursor.execute("UPDATE messenger_rooms SET updated_at=%s WHERE id=%s", (now, room_id))
                self._write_messenger_audit(cursor, actor, room_id, "messenger.room.participants_changed", "active", "active", {"beforeUserIds": before_ids, "afterUserIds": participant_ids}, now)
            connection.commit()
        return self.get_room(actor, room_id)

    def list_messages(self, actor: AuthUserSummary, room_id: str, limit: int = 100, before: datetime | None = None) -> MessengerMessageListResponse:
        self.db.ensure_migrations_applied()
        limit = max(1, min(limit, 100))
        where_before = "AND msg.created_at < %s" if before else ""
        params: tuple = (room_id, before, limit + 1) if before else (room_id, limit + 1)
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._fetch_accessible_room(cursor, actor, room_id)
            cursor.execute(
                f"""
                SELECT msg.id AS message_id,msg.room_id,msg.sender_user_id,u.name AS sender_user_name,
                       msg.message_type,msg.body,msg.attachment_meta,msg.created_at,msg.retention_expires_at,
                       COALESCE(reads.read_by,'[]'::jsonb) AS read_by,
                       COALESCE(members.recipient_count,0) AS recipient_count,
                       COALESCE(reads.read_count,0) AS read_count,
                       GREATEST(COALESCE(members.recipient_count,0)-COALESCE(reads.read_count,0),0) AS unread_count,
                       COALESCE(files.attachments,'[]'::jsonb) AS attachments
                FROM messenger_messages msg JOIN users u ON u.id=msg.sender_user_id
                LEFT JOIN LATERAL (
                    SELECT jsonb_agg(reads.user_id ORDER BY reads.read_at) FILTER (WHERE reads.user_id<>msg.sender_user_id) AS read_by,
                           COUNT(*) FILTER (WHERE reads.user_id<>msg.sender_user_id) AS read_count
                    FROM messenger_message_reads reads
                    JOIN messenger_room_members current_member ON current_member.room_id=msg.room_id AND current_member.user_id=reads.user_id
                    JOIN users active_reader ON active_reader.id=current_member.user_id AND active_reader.status='active'
                    WHERE reads.message_id=msg.id
                ) reads ON TRUE
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS recipient_count
                    FROM messenger_room_members member
                    JOIN users active_member ON active_member.id=member.user_id AND active_member.status='active'
                    WHERE member.room_id=msg.room_id AND member.user_id<>msg.sender_user_id
                ) members ON TRUE
                LEFT JOIN LATERAL (
                    SELECT jsonb_agg(jsonb_build_object('attachmentId',id,'fileName',file_name,'contentType',content_type,'sizeBytes',size_bytes) ORDER BY created_at) AS attachments
                    FROM messenger_attachments WHERE message_id=msg.id
                ) files ON TRUE
                WHERE msg.room_id=%s {where_before}
                ORDER BY msg.created_at DESC LIMIT %s
                """,
                params,
            )
            rows = [dict(row) for row in cursor.fetchall()]
        has_more = len(rows) > limit
        visible = rows[:limit]
        next_cursor = visible[-1]["created_at"] if has_more and visible else None
        return MessengerMessageListResponse(messages=[self._to_message_view(row) for row in reversed(visible)], nextCursor=next_cursor)

    def stage_messenger_attachment(self, actor: AuthUserSummary, file_name: str, content_type: str, content: bytes):
        self.messenger_attachment_storage.cleanup_expired()
        return self.messenger_attachment_storage.stage(actor, file_name, content_type, content)

    def download_messenger_attachment(self, actor: AuthUserSummary, room_id: str, message_id: str, attachment_id: str) -> dict:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._fetch_accessible_room(cursor, actor, room_id)
            cursor.execute(
                """SELECT attachment.file_name,attachment.content_type,attachment.size_bytes,attachment.storage_key
                FROM messenger_attachments attachment JOIN messenger_messages message ON message.id=attachment.message_id
                WHERE attachment.id=%s AND message.id=%s AND message.room_id=%s""",
                (attachment_id, message_id, room_id),
            )
            row = cursor.fetchone()
        if row is None:
            raise PermissionError("첨부 파일에 접근할 권한이 없습니다.")
        return {"path": self.messenger_attachment_storage.stored_path(row["storage_key"]), "fileName": row["file_name"], "contentType": row["content_type"], "sizeBytes": row["size_bytes"]}

    def send_message(self, actor: AuthUserSummary, room_id: str, payload: MessengerMessageSendRequest) -> MessengerMessageSendResponse:
        self.db.ensure_migrations_applied()
        resolved = [self.messenger_attachment_storage.resolve(actor, item) for item in payload.attachments]
        if len({item["upload_id"] for item in resolved}) != len(resolved):
            raise ValueError("같은 첨부 파일을 중복 사용할 수 없습니다.")
        if sum(item["size_bytes"] for item in resolved) > settings.mail_attachment_max_total_bytes:
            raise MessengerAttachmentTooLargeError("첨부 파일의 전체 용량 제한을 초과했습니다.")
        now = self._now()
        message_id = self._new_id("msg")
        marked_upload_ids: list[str] = []
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._fetch_accessible_room(cursor, actor, room_id)
            cursor.execute(
                """INSERT INTO messenger_messages
                (id,room_id,sender_user_id,message_type,body,attachment_meta,created_at,retention_expires_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (message_id, room_id, actor.userId, payload.messageType, payload.body, Jsonb([]), now, now + timedelta(days=14)),
            )
            for item in resolved:
                cursor.execute(
                    """INSERT INTO messenger_attachments
                    (id,message_id,upload_id,file_name,content_type,size_bytes,storage_key,created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (self._new_id("msgatt"), message_id, item["upload_id"], item["file_name"], item["content_type"], item["size_bytes"], item["storage_key"], now),
                )
            cursor.execute(
                "INSERT INTO messenger_message_reads (id,message_id,user_id,read_at) VALUES (%s,%s,%s,%s) ON CONFLICT (message_id, user_id) DO NOTHING",
                (self._new_id("read"), message_id, actor.userId, now),
            )
            cursor.execute("UPDATE messenger_rooms SET updated_at=%s WHERE id=%s", (now, room_id))
            self._write_messenger_audit(cursor, actor, message_id, "messenger.message.sent", None, "sent", {"messageType": payload.messageType, "attachmentCount": len(resolved)}, now)
            try:
                for item in resolved:
                    self.messenger_attachment_storage.mark_attached(item["upload_id"], message_id)
                    marked_upload_ids.append(item["upload_id"])
            except Exception:
                try:
                    connection.rollback()
                except Exception:
                    logger.exception("메신저 첨부 연결 실패 후 DB rollback에 실패했습니다.")
                    raise
                for upload_id in reversed(marked_upload_ids):
                    try:
                        self.messenger_attachment_storage.restore_unattached(upload_id, message_id)
                    except Exception:
                        logger.exception("rollback 완료 후 메신저 첨부 metadata 보상에 실패했습니다.")
                raise
            connection.commit()
        return MessengerMessageSendResponse(messageId=message_id, roomId=room_id, createdAt=now)

    def mark_room_read(self, actor: AuthUserSummary, room_id: str) -> MessengerReadResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._fetch_accessible_room(cursor, actor, room_id)
            cursor.execute("SELECT id FROM messenger_messages WHERE room_id=%s ORDER BY created_at DESC LIMIT 1", (room_id,))
            last_message = cursor.fetchone()
            last_message_id = last_message["id"] if last_message else None
            cursor.execute(
                """INSERT INTO messenger_message_reads (id,message_id,user_id,read_at)
                SELECT %s||'_'||message.id,message.id,%s,%s FROM messenger_messages message
                WHERE message.room_id=%s AND message.sender_user_id<>%s
                ON CONFLICT (message_id, user_id) DO NOTHING""",
                (self._new_id("read"), actor.userId, now, room_id, actor.userId),
            )
            inserted = max(getattr(cursor, "rowcount", 0), 0)
            cursor.execute(
                "UPDATE messenger_room_members SET last_read_message_id=%s,last_read_at=%s WHERE room_id=%s AND user_id=%s",
                (last_message_id, now, room_id, actor.userId),
            )
            if inserted:
                self._write_messenger_audit(cursor, actor, room_id, "messenger.room.read", "unread", "read", {"readCount": inserted}, now)
            connection.commit()
        return MessengerReadResponse(roomId=room_id, readAt=now, lastReadMessageId=last_message_id)

    def _write_messenger_audit(self, cursor, actor: AuthUserSummary, target_id: str, event: str, before: str | None, after: str | None, reason: dict | None, now: datetime) -> None:
        cursor.execute(
            """INSERT INTO audit_logs
            (id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at)
            VALUES (%s,%s,%s,%s,'messenger',%s,%s,%s,%s,%s,%s)""",
            (self._new_id("audit"), actor.companyId, actor.userId, actor.userName, target_id, event, before, after, json.dumps(reason, ensure_ascii=True, separators=(",", ":")) if reason else None, now),
        )

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

                preferences = self._ensure_basic_preferences(cursor, actor)
                signature = self._fetch_enabled_signature(cursor, actor)
                final_body_text, final_body_html = self._compose_signature_body(payload.bodyText, payload.bodyHtml, signature)
                cursor.execute(
                    """INSERT INTO mail_messages (
                        id, company_id, sender_user_id, sender_account_id, sender_email,
                        subject, body_text, body_html, status, sent_at, scheduled_at, created_at,
                        updated_at, retention_expires_at, attachment_count, source_message_id, source_action,
                        sender_display_name, reply_to_email, message_encoding, sender_copy_saved, read_receipt_requested
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (mail_id, actor.companyId, actor.userId, account["id"], account["email"],
                     payload.subject.strip(), final_body_text, final_body_html, status_value, sent_at, scheduled_at,
                     now, now, now + timedelta(days=30), len(resolved_attachments), payload.sourceMailId,
                     None if payload.composeAction == "new" else payload.composeAction,
                     preferences["sender_display_name"], preferences["reply_to_email"], preferences["message_encoding"],
                     preferences["save_sent_copy"], preferences["read_receipt_enabled"]),
                )
                for kind, email in recipient_pairs:
                    recipient_user_id = internal_by_email.get(email) if status_value != "draft" else self._resolve_user_id_by_email(cursor, actor.companyId, email)
                    recipient_id = self._new_id("rcpt")
                    spam_decision = SpamDecision("inbox")
                    if status_value == "sent" and recipient_user_id:
                        spam_decision = self._evaluate_recipient_spam(
                            cursor,
                            actor,
                            recipient_user_id,
                            account["email"],
                            mail_id,
                        )
                    cursor.execute(
                        """INSERT INTO mail_recipients (
                            id, message_id, recipient_user_id, recipient_email, recipient_kind,
                            is_read, is_starred, received_at, is_spam, spam_marked_at, delivery_source
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'direct')""",
                        (recipient_id, mail_id, recipient_user_id, email, kind, False, False,
                         now if status_value == "sent" and recipient_user_id else None,
                         spam_decision.decision == "spam",
                         now if spam_decision.decision == "spam" else None),
                    )
                    if status_value == "sent" and recipient_user_id:
                        self._write_spam_classification_audit(
                            cursor,
                            actor=actor,
                            mail_id=mail_id,
                            recipient_user_id=recipient_user_id,
                            decision=spam_decision,
                            now=now,
                        )
                        if spam_decision.decision != "spam":
                            self._apply_auto_classification(
                                cursor, company_id=actor.companyId, recipient_user_id=recipient_user_id,
                                actor_user_id=actor.userId, actor_user_name=actor.userName, mail_id=mail_id,
                                recipient_id=recipient_id, sender_email=account["email"], recipient_email=email,
                                subject=payload.subject.strip(), body=final_body_text,
                                has_attachment=bool(resolved_attachments), now=now,
                            )
                            self._apply_auto_forwarding(
                                cursor, company_id=actor.companyId, recipient_user_id=recipient_user_id,
                                actor_user_id=actor.userId, actor_user_name=actor.userName, mail_id=mail_id,
                                recipient_id=recipient_id, sender_email=account["email"], recipient_email=email,
                                delivery_source="direct", subject=payload.subject.strip(), body=final_body_text,
                                has_attachment=bool(resolved_attachments), now=now,
                            )
                            self._apply_out_of_office(
                                cursor, company_id=actor.companyId, recipient_user_id=recipient_user_id,
                                actor_user_id=actor.userId, actor_user_name=actor.userName, mail_id=mail_id,
                                recipient_id=recipient_id, sender_email=account["email"], delivery_source="direct",
                                is_auto_generated=False, is_spam=False, now=now,
                            )
                    if status_value == "sent" and email in external_emails:
                        queue_status = "queued" if provider["delivery_enabled"] and provider["last_test_status"] == "success" else "blocked"
                        queue_id = self._new_id("delivery")
                        cursor.execute(
                            """INSERT INTO mail_delivery_queue (
                                id, company_id, provider_config_id, mail_id, recipient_id, status,
                                attempt_count, next_attempt_at, created_at, updated_at
                            ) VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,%s)""",
                            (queue_id, actor.companyId, provider["id"], mail_id, recipient_id,
                             queue_status, now if queue_status == "queued" else None, now, now),
                        )
                        self._write_mail_delivery_audit(
                            cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                            actor_user_name=actor.userName, queue_id=queue_id, event=f"mail.delivery.{queue_status}",
                            status_before=None, status_after=queue_status, now=now,
                        )
                if status_value == "sent":
                    self._upsert_recent_recipients(
                        cursor,
                        company_id=actor.companyId,
                        owner_user_id=actor.userId,
                        recipient_emails=[email for _, email in recipient_pairs],
                        now=now,
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

    def _evaluate_recipient_spam(
        self,
        cursor,
        actor: AuthUserSummary,
        recipient_user_id: str,
        sender_email: str,
        mail_id: str,
    ) -> SpamDecision:
        return self._evaluate_recipient_spam_for_company(
            cursor,
            actor.companyId,
            recipient_user_id,
            sender_email,
            mail_id,
        )

    def _apply_auto_classification(
        self, cursor, *, company_id: str, recipient_user_id: str,
        actor_user_id: str, actor_user_name: str, mail_id: str, recipient_id: str,
        sender_email: str, recipient_email: str, subject: str, body: str,
        has_attachment: bool, now: datetime,
    ):
        normalized_sender = normalize_spam_email(sender_email)
        return self.auto_classification.apply_recipient(
            cursor,
            company_id=company_id,
            user_id=recipient_user_id,
            actor_user_id=actor_user_id,
            actor_user_name=actor_user_name,
            mail_id=mail_id,
            recipient_id=recipient_id,
            context={
                "sender_email": normalized_sender,
                "sender_domain": normalized_sender.rsplit("@", 1)[1],
                "recipient_email": normalize_spam_email(recipient_email),
                "subject": subject,
                "body": body,
                "has_attachment": has_attachment,
            },
            now=now,
        )

    def _apply_auto_forwarding(
        self, cursor, *, company_id: str, recipient_user_id: str,
        actor_user_id: str, actor_user_name: str, mail_id: str, recipient_id: str,
        sender_email: str, recipient_email: str, delivery_source: str, now: datetime,
        subject: str = "", body: str = "", has_attachment: bool = False,
    ):
        if delivery_source != "direct":
            return None

        def classify_internal(target_user_id: str, forwarded_recipient_id: str, target_email: str) -> None:
            decision = self._evaluate_recipient_spam_for_company(cursor, company_id, target_user_id, sender_email, mail_id)
            cursor.execute(
                "UPDATE mail_recipients SET is_spam=%s,spam_marked_at=%s WHERE id=%s AND recipient_user_id=%s AND delivery_source='auto_forward'",
                (decision.decision == "spam", now if decision.decision == "spam" else None, forwarded_recipient_id, target_user_id),
            )
            self._write_spam_classification_audit_for_actor(
                cursor, company_id=company_id, actor_user_id=actor_user_id, actor_user_name=actor_user_name,
                mail_id=mail_id, recipient_user_id=target_user_id, decision=decision, now=now,
            )
            if decision.decision != "spam":
                self._apply_auto_classification(
                    cursor, company_id=company_id, recipient_user_id=target_user_id,
                    actor_user_id=actor_user_id, actor_user_name=actor_user_name, mail_id=mail_id,
                    recipient_id=forwarded_recipient_id, sender_email=sender_email, recipient_email=target_email,
                    subject=subject, body=body, has_attachment=has_attachment, now=now,
                )

        return self.auto_forwarding.apply_recipient(
            cursor, company_id=company_id, user_id=recipient_user_id,
            actor_user_id=actor_user_id, actor_user_name=actor_user_name,
            mail_id=mail_id, recipient_id=recipient_id, sender_email=sender_email,
            now=now, classify_internal=classify_internal,
        )

    def _apply_out_of_office(
        self, cursor, *, company_id: str, recipient_user_id: str,
        actor_user_id: str, actor_user_name: str, mail_id: str, recipient_id: str,
        sender_email: str, delivery_source: str, is_auto_generated: bool,
        is_spam: bool, now: datetime,
    ):
        if delivery_source != "direct" or is_spam:
            return None
        return self.out_of_office.apply_recipient(
            cursor, company_id=company_id, user_id=recipient_user_id,
            actor_user_id=actor_user_id, actor_user_name=actor_user_name,
            mail_id=mail_id, recipient_id=recipient_id, sender_email=sender_email,
            delivery_source=delivery_source, is_auto_generated=is_auto_generated,
            is_spam=is_spam, now=now,
        )

    def _evaluate_recipient_spam_for_company(
        self,
        cursor,
        company_id: str,
        recipient_user_id: str,
        sender_email: str,
        mail_id: str,
    ) -> SpamDecision:
        cursor.execute("SAVEPOINT spam_evaluation")
        try:
            return self.spam_settings.evaluate_sender(
                cursor,
                company_id,
                recipient_user_id,
                sender_email,
            )
        except Exception:
            try:
                cursor.execute("ROLLBACK TO SAVEPOINT spam_evaluation")
            except Exception:
                raise
            logger.exception(
                "Spam evaluation failed open: company_id=%s recipient_user_id=%s mail_id=%s",
                company_id,
                recipient_user_id,
                mail_id,
            )
            return SpamDecision("inbox")
        finally:
            cursor.execute("RELEASE SAVEPOINT spam_evaluation")

    def _write_spam_classification_audit(
        self,
        cursor,
        *,
        actor: AuthUserSummary,
        mail_id: str,
        recipient_user_id: str,
        decision: SpamDecision,
        now: datetime,
    ) -> None:
        self._write_spam_classification_audit_for_actor(
            cursor,
            company_id=actor.companyId,
            actor_user_id=actor.userId,
            actor_user_name=actor.userName,
            mail_id=mail_id,
            recipient_user_id=recipient_user_id,
            decision=decision,
            now=now,
        )

    def _write_spam_classification_audit_for_actor(
        self,
        cursor,
        *,
        company_id: str,
        actor_user_id: str,
        actor_user_name: str,
        mail_id: str,
        recipient_user_id: str,
        decision: SpamDecision,
        now: datetime,
    ) -> None:
        reason = json.dumps(
            {"recipientUserId": recipient_user_id, "matchedRuleId": decision.matchedRuleId},
            ensure_ascii=True,
            separators=(",", ":"),
        )
        cursor.execute(
            """INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                event, status_before, status_after, reason, created_at
            ) VALUES (%s,%s,%s,%s,'mail',%s,'mail.spam.message.classified',NULL,%s,%s,%s)""",
            (self._new_id("audit"), company_id, actor_user_id, actor_user_name, mail_id, decision.decision, reason, now),
        )

    def _write_mail_delivery_audit(
        self, cursor, *, company_id: str, actor_user_id: str | None, actor_user_name: str,
        queue_id: str, event: str, status_before: str | None, status_after: str, now: datetime,
        reason: str = "UI-021 transaction outbox",
    ) -> None:
        cursor.execute(
            """INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                event, status_before, status_after, reason, created_at
            ) VALUES (%s,%s,%s,%s,'mail_delivery_queue',%s,%s,%s,%s,%s,%s)""",
            (self._new_id("audit"), company_id, actor_user_id, actor_user_name, queue_id,
             event, status_before, status_after, reason, now),
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
                m.sender_email, m.sender_display_name, m.subject, m.body_text, m.body_html, m.status, m.sent_at, m.scheduled_at,
                m.created_at, m.updated_at, m.retention_expires_at, m.attachment_count,
                m.read_receipt_requested,
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
              AND delivery_source = 'direct'
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
            WHERE q.mail_id = %s AND r.delivery_source = 'direct' ORDER BY r.recipient_kind, r.recipient_email""",
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

    def _fetch_company_users(self, cursor, company_id: str, user_ids: list[str], *, lock: bool = False) -> dict[str, dict]:
        lock_clause = " FOR UPDATE" if lock else ""
        cursor.execute(
            f"""
            SELECT id, name, email, status
            FROM users
            WHERE company_id = %s AND id = ANY(%s) AND status = 'active'
            ORDER BY id{lock_clause}
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
            SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email,
                   COALESCE(department.name, '') AS department_name, member.joined_at, member.last_read_at
            FROM messenger_room_members member
            JOIN users u ON u.id = member.user_id AND u.status='active'
            LEFT JOIN departments department ON department.id=u.department_id
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
                "departmentName": row["department_name"],
                "joinedAt": row["joined_at"].isoformat() if row["joined_at"] else None,
                "lastReadAt": row["last_read_at"].isoformat() if row["last_read_at"] else None,
            }
            for row in cursor.fetchall()
        ]

    def _room_row_to_summary_with_participants(self, cursor, actor: AuthUserSummary, room: dict) -> MessengerRoomSummary:
        cursor.execute(
            """
            SELECT
                room.created_by_user_id,
                self_member.is_favorite,
                COALESCE(member_ids.participant_ids, '[]'::jsonb) AS participant_ids,
                COALESCE(member_ids.participant_count, 0) AS participant_count,
                last_msg.body AS last_message,
                last_msg.created_at AS last_message_at,
                COALESCE(unread.unread_count, 0) AS unread_count
            FROM messenger_rooms room
            JOIN messenger_room_members self_member ON self_member.room_id=room.id AND self_member.user_id=%s
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(member.user_id ORDER BY member.joined_at) AS participant_ids, COUNT(*) AS participant_count
                FROM messenger_room_members member
                JOIN users active_member ON active_member.id=member.user_id AND active_member.status='active'
                WHERE member.room_id = room.id
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
            (actor.userId, actor.userId, actor.userId, room["id"]),
        )
        extra = cursor.fetchone()
        combined = dict(room)
        combined.update(extra)
        combined["room_id"] = room["id"]
        return self._to_room_summary(combined, actor.userId)

    def _to_mail_summary(self, row: dict) -> MailSummary:
        return MailSummary(
            mailId=row["mail_id"],
            accountId=row["account_id"],
            senderEmail=row["sender_email"],
            senderDisplayName=row.get("sender_display_name") or "",
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
        preferences: dict | None = None,
    ) -> MailDetailResponse:
        return MailDetailResponse(
            mailId=message["mail_id"],
            accountId=message["account_id"],
            senderUserId=message["sender_user_id"],
            senderEmail=message["sender_email"],
            senderDisplayName=message.get("sender_display_name") or "",
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
            canViewReadReceipts=bool(message["is_sender_view"] and message.get("read_receipt_requested", True)),
            effectiveReadPolicy={
                "blockRemoteImages": True if preferences is None else bool(preferences["block_remote_images"]),
                "disableRiskyTags": True if preferences is None else bool(preferences["disable_risky_tags"]),
            },
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

    def _to_room_summary(self, row: dict, actor_user_id: str | None = None) -> MessengerRoomSummary:
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
            isFavorite=bool(row.get("is_favorite", False)),
            participantCount=int(row.get("participant_count") or len(participant_ids or [])),
            createdByUserId=row.get("created_by_user_id") or "",
            canManageParticipants=bool(actor_user_id and row.get("created_by_user_id") == actor_user_id),
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            retentionExpiresAt=row["retention_expires_at"],
        )

    def _to_message_view(self, row: dict) -> MessengerMessageView:
        attachment_meta = row["attachment_meta"]
        attachments = row.get("attachments") or []
        read_by = row["read_by"]
        if isinstance(attachment_meta, str):
            attachment_meta = json.loads(attachment_meta)
        if isinstance(read_by, str):
            read_by = json.loads(read_by)
        if isinstance(attachments, str):
            attachments = json.loads(attachments)
        read_by_ids = [str(item) for item in (read_by or [])]
        return MessengerMessageView(
            messageId=row["message_id"],
            roomId=row["room_id"],
            senderUserId=row["sender_user_id"],
            senderUserName=row["sender_user_name"],
            messageType=row["message_type"],
            body=row["body"],
            attachmentMeta=list(attachment_meta or []),
            attachments=list(attachments or []),
            createdAt=row["created_at"],
            retentionExpiresAt=row["retention_expires_at"],
            readBy=read_by_ids,
            readState="read" if read_by_ids else "unread",
            recipientCount=int(row.get("recipient_count") or 0),
            readCount=int(row.get("read_count") or 0),
            unreadCount=int(row.get("unread_count") or 0),
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
