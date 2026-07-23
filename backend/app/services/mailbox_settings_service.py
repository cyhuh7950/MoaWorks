from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
import json
import uuid

from app.schemas.auth import AuthUserSummary
from app.schemas.mail_messenger import (
    MailBackupJobView,
    MailMailboxEmptyRequest,
    MailMailboxEmptyResponse,
    MailMailboxPolicyUpdateRequest,
    MailMailboxSettingsResponse,
    MailboxSettingsRow,
)
from app.services.mail_messenger_service import MailMessengerService
from app.services.mailbox_backup_service import MailboxBackupService
from app.services.mailbox_scope import MailboxScope
from app.services.postgres_service import PostgresService


class MailboxSettingsConflictError(RuntimeError):
    pass


class MailboxCountConflictError(RuntimeError):
    def __init__(self, current_count: int) -> None:
        super().__init__("메일함 건수가 변경되었습니다.")
        self.current_count = current_count


class MailboxSettingsService:
    SYSTEM_NAMES = {
        "inbox": "받은편지함",
        "sent": "보낸편지함",
        "draft": "임시보관함",
        "scheduled": "예약메일함",
        "spam": "스팸함",
        "trash": "휴지통",
    }
    EDITABLE_TYPES = {"inbox", "sent", "draft", "folder"}
    RETENTION_VALUES = {None, 30, 90, 180, 365}
    RETENTION_LOCK_NAME = "moaworks-mail-retention-v1"

    def __init__(self) -> None:
        self.db = PostgresService()
        self.mail = MailMessengerService()
        self.backup = MailboxBackupService()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex}"

    def get_settings(self, actor: AuthUserSummary) -> MailMailboxSettingsResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    self._system_overview_sql(),
                    (
                        actor.companyId,
                        actor.userId,
                        actor.userEmail.lower(),
                        actor.companyId,
                        actor.userId,
                        actor.companyId,
                        actor.userId,
                    ),
                )
                system_rows = cursor.fetchall()
                cursor.execute(
                    self._folder_overview_sql(),
                    (
                        actor.userId,
                        actor.userEmail.lower(),
                        actor.companyId,
                        actor.companyId,
                        actor.userId,
                        actor.companyId,
                        actor.userId,
                    ),
                )
                folder_rows = cursor.fetchall()

        rows = [self._to_settings_row(row) for row in [*system_rows, *folder_rows]]
        storage = self.mail.get_mail_storage(actor)
        tags = self.mail.list_tags(actor).tags
        backup_jobs = self.backup.list_jobs(actor).jobs
        return MailMailboxSettingsResponse(
            mailboxes=rows,
            tags=tags,
            storage=storage,
            backupJobs=backup_jobs,
        )

    def update_policy(
        self,
        actor: AuthUserSummary,
        scope: MailboxScope,
        payload: MailMailboxPolicyUpdateRequest,
    ) -> MailboxSettingsRow:
        if scope.mailbox_type not in self.EDITABLE_TYPES:
            raise ValueError("이 메일함의 보관기간은 변경할 수 없습니다.")
        if payload.retentionDays not in self.RETENTION_VALUES:
            raise ValueError("지원하지 않는 보관기간입니다.")

        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                mailbox_name = self._authorize_scope(cursor, actor, scope)
                policy_id = self._new_id("mailbox_policy")
                cursor.execute(
                    """
                    INSERT INTO user_mailbox_policies (
                        id, company_id, user_id, mailbox_type, folder_id,
                        retention_days, version, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, NULL, 1, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        policy_id,
                        actor.companyId,
                        actor.userId,
                        scope.mailbox_type,
                        scope.folder_id,
                        now,
                        now,
                    ),
                )
                cursor.execute(
                    """
                    SELECT id, retention_days, version
                    FROM user_mailbox_policies
                    WHERE company_id = %s
                      AND user_id = %s
                      AND mailbox_type = %s
                      AND folder_id IS NOT DISTINCT FROM %s
                    FOR UPDATE
                    """,
                    (
                        actor.companyId,
                        actor.userId,
                        scope.mailbox_type,
                        scope.folder_id,
                    ),
                )
                current = cursor.fetchone()
                if current is None:
                    raise RuntimeError("메일함 정책을 생성하지 못했습니다.")
                if current["version"] != payload.expectedVersion:
                    raise MailboxSettingsConflictError(
                        "다른 위치에서 메일함 설정이 변경되었습니다."
                    )
                cursor.execute(
                    """
                    UPDATE user_mailbox_policies
                    SET retention_days = %s, version = version + 1, updated_at = %s
                    WHERE id = %s
                    RETURNING retention_days, version
                    """,
                    (payload.retentionDays, now, current["id"]),
                )
                updated = cursor.fetchone()
                self._write_audit(
                    cursor,
                    actor,
                    current["id"],
                    "mail.mailbox.policy.updated",
                    scope.key,
                    {"changedFields": ["retentionDays"]},
                )
            connection.commit()

        return MailboxSettingsRow(
            mailboxKey=scope.key,
            name=mailbox_name,
            mailboxType=scope.mailbox_type,
            retentionDays=updated["retention_days"],
            retentionEditable=True,
            unreadCount=None if scope.mailbox_type in {"sent", "draft"} else 0,
            totalCount=0,
            usedBytes=0,
            version=updated["version"],
        )

    def empty_mailbox(
        self,
        actor: AuthUserSummary,
        scope: MailboxScope,
        payload: MailMailboxEmptyRequest,
    ) -> MailMailboxEmptyResponse:
        if scope.mailbox_type == "trash" and not payload.confirmPermanent:
            raise ValueError("휴지통 비우기는 복구할 수 없음을 확인해야 합니다.")

        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._authorize_scope(cursor, actor, scope)
                locked_views = self._lock_current_views(cursor, actor, scope)
                current_count = self._logical_view_count(locked_views)
                if current_count != payload.expectedCount:
                    raise MailboxCountConflictError(current_count)
                changed_count = self._apply_empty(
                    cursor,
                    actor,
                    scope,
                    locked_views,
                    now,
                )
                self._write_audit(
                    cursor,
                    actor,
                    scope.key,
                    "mail.mailbox.emptied",
                    scope.key,
                    {"changedCount": changed_count},
                )
            connection.commit()
        return MailMailboxEmptyResponse(
            mailboxKey=scope.key,
            changedCount=changed_count,
            currentCount=0,
        )

    def run_retention_batch(self, worker_id: str, limit: int = 500) -> int:
        bounded_limit = max(1, min(limit, 500))
        self.db.ensure_migrations_applied()
        connection = self.db.connect()
        lock_acquired = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_try_advisory_lock(hashtext(%s)) AS acquired",
                    (self.RETENTION_LOCK_NAME,),
                )
                lock_row = cursor.fetchone()
                lock_acquired = bool(lock_row and lock_row["acquired"])
                if not lock_acquired:
                    return 0
                cursor.execute(self._retention_candidates_sql(), (bounded_limit,))
                candidates = cursor.fetchall()
                changed_counts = self._apply_retention_candidates(
                    cursor,
                    candidates,
                    self._now(),
                )
                for (
                    company_id,
                    user_id,
                    mailbox_key,
                ), count in changed_counts.items():
                    cursor.execute(
                        """
                        INSERT INTO audit_logs (
                            id, company_id, actor_user_id, actor_user_name,
                            target_type, target_id, event, status_before,
                            status_after, reason, created_at
                        ) VALUES (
                            %s, %s, NULL, %s, 'mailbox', %s,
                            'mail.retention.batch', '{}', '{}', %s, %s
                        )
                        """,
                        (
                            self._new_id("audit"),
                            company_id,
                            worker_id,
                            mailbox_key,
                            json.dumps(
                                {"mailboxKey": mailbox_key, "changedCount": count},
                                sort_keys=True,
                            ),
                            self._now(),
                        ),
                    )
            connection.commit()
            return sum(changed_counts.values())
        finally:
            if lock_acquired:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_advisory_unlock(hashtext(%s))",
                            (self.RETENTION_LOCK_NAME,),
                        )
                finally:
                    connection.close()
            else:
                connection.close()

    def _authorize_scope(self, cursor, actor: AuthUserSummary, scope: MailboxScope) -> str:
        if scope.mailbox_type != "folder":
            return self.SYSTEM_NAMES[scope.mailbox_type]
        cursor.execute(
            """
            SELECT name
            FROM mail_user_folders
            WHERE id = %s AND company_id = %s AND user_id = %s
            """,
            (scope.folder_id, actor.companyId, actor.userId),
        )
        folder = cursor.fetchone()
        if folder is None:
            raise PermissionError("메일함에 접근할 수 없습니다.")
        return folder["name"]

    def _lock_current_views(
        self,
        cursor,
        actor: AuthUserSummary,
        scope: MailboxScope,
    ) -> list[dict]:
        if scope.mailbox_type == "trash":
            cursor.execute(
                """
                SELECT mr.id AS view_id, 'recipient' AS view_type
                     , mr.message_id
                FROM mail_recipients mr
                JOIN mail_messages m ON m.id = mr.message_id
                WHERE m.company_id = %s
                  AND (
                    mr.recipient_user_id = %s
                    OR LOWER(mr.recipient_email) = %s
                  )
                  AND m.status = 'sent'
                  AND mr.deleted_at IS NOT NULL AND mr.purged_at IS NULL
                FOR UPDATE OF mr
                """,
                (actor.companyId, actor.userId, actor.userEmail.lower()),
            )
            recipients = cursor.fetchall()
            cursor.execute(
                """
                SELECT m.id AS view_id, 'sender' AS view_type
                     , m.id AS message_id
                FROM mail_messages m
                WHERE m.company_id = %s AND m.sender_user_id = %s
                  AND m.sender_deleted_at IS NOT NULL
                  AND m.sender_purged_at IS NULL
                  AND (m.status <> 'sent' OR m.sender_copy_saved = TRUE)
                FOR UPDATE OF m
                """,
                (actor.companyId, actor.userId),
            )
            return [*recipients, *cursor.fetchall()]

        if scope.mailbox_type in {"inbox", "spam", "folder"}:
            predicates = {
                "inbox": "mr.folder_id IS NULL AND mr.is_spam = FALSE",
                "spam": "mr.is_spam = TRUE",
                "folder": "mr.folder_id = %s AND mr.is_spam = FALSE",
            }
            params: list[object] = [
                actor.companyId,
                actor.userId,
                actor.userEmail.lower(),
            ]
            if scope.mailbox_type == "folder":
                params.append(scope.folder_id)
            cursor.execute(
                f"""
                SELECT mr.id AS view_id, 'recipient' AS view_type
                     , mr.message_id
                FROM mail_recipients mr
                JOIN mail_messages m ON m.id = mr.message_id
                WHERE m.company_id = %s
                  AND (
                    mr.recipient_user_id = %s
                    OR LOWER(mr.recipient_email) = %s
                  )
                  AND m.status = 'sent'
                  AND mr.deleted_at IS NULL AND mr.purged_at IS NULL
                  AND {predicates[scope.mailbox_type]}
                FOR UPDATE OF mr
                """,
                tuple(params),
            )
            return cursor.fetchall()

        cursor.execute(
            """
            SELECT m.id AS view_id, 'sender' AS view_type
                 , m.id AS message_id
            FROM mail_messages m
            WHERE m.company_id = %s AND m.sender_user_id = %s
              AND m.status = %s
              AND (%s <> 'sent' OR m.sender_copy_saved = TRUE)
              AND m.sender_deleted_at IS NULL
              AND m.sender_purged_at IS NULL
            FOR UPDATE OF m
            """,
            (
                actor.companyId,
                actor.userId,
                scope.mailbox_type,
                scope.mailbox_type,
            ),
        )
        return cursor.fetchall()

    def _apply_empty(
        self,
        cursor,
        actor: AuthUserSummary,
        scope: MailboxScope,
        locked_views: list[dict],
        now: datetime,
    ) -> int:
        if not locked_views:
            return 0
        logical_count = self._logical_view_count(locked_views)
        recipient_ids = [
            row["view_id"] for row in locked_views if row["view_type"] == "recipient"
        ]
        sender_ids = [
            row["view_id"] for row in locked_views if row["view_type"] == "sender"
        ]
        if scope.mailbox_type == "trash":
            if recipient_ids:
                cursor.execute(
                    """
                    UPDATE mail_recipients
                    SET purged_at = %s, purged_by_user_id = %s
                    WHERE id = ANY(%s) AND purged_at IS NULL
                    """,
                    (now, actor.userId, recipient_ids),
                )
            if sender_ids:
                cursor.execute(
                    """
                    UPDATE mail_messages
                    SET sender_purged_at = %s, sender_purged_by_user_id = %s
                    WHERE id = ANY(%s) AND sender_purged_at IS NULL
                    """,
                    (now, actor.userId, sender_ids),
                )
            return logical_count

        if recipient_ids:
            cursor.execute(
                """
                UPDATE mail_recipients
                SET deleted_at = %s, deleted_by_user_id = %s
                WHERE id = ANY(%s) AND deleted_at IS NULL AND purged_at IS NULL
                """,
                (now, actor.userId, recipient_ids),
            )
        if sender_ids:
            scheduled = scope.mailbox_type == "scheduled"
            cursor.execute(
                """
                UPDATE mail_messages
                SET sender_deleted_at = %s,
                    sender_deleted_by_user_id = %s,
                    status = CASE WHEN %s THEN 'cancelled' ELSE status END,
                    scheduled_at = CASE WHEN %s THEN NULL ELSE scheduled_at END
                WHERE id = ANY(%s)
                  AND sender_deleted_at IS NULL
                  AND sender_purged_at IS NULL
                """,
                (now, actor.userId, scheduled, scheduled, sender_ids),
            )
        return logical_count

    @staticmethod
    def _logical_view_count(locked_views: list[dict]) -> int:
        return len({
            (
                row.get("message_id") or row["view_id"],
                row.get("view_type") or "recipient",
            )
            for row in locked_views
        })

    def _apply_retention_candidates(
        self,
        cursor,
        candidates: list[dict],
        now: datetime,
    ) -> Counter:
        groups: dict[tuple[str, str, str, str, str], list[str]] = {}
        for row in candidates:
            key = (
                row["view_type"],
                row["action"],
                row["mailbox_key"],
                row["company_id"],
                row["user_id"],
            )
            groups.setdefault(key, []).append(row["view_id"])

        changed_counts: Counter = Counter()
        for (
            view_type,
            action,
            mailbox_key,
            company_id,
            user_id,
        ), ids in groups.items():
            if view_type == "recipient" and action == "purge":
                cursor.execute(
                    """
                    UPDATE mail_recipients mr
                    SET purged_at = %s
                    FROM mail_messages m, users u
                    WHERE mr.id = ANY(%s)
                      AND m.id = mr.message_id
                      AND m.company_id = %s
                      AND m.status = 'sent'
                      AND u.id = %s
                      AND u.company_id = m.company_id
                      AND (
                        mr.recipient_user_id = u.id
                        OR LOWER(mr.recipient_email) = LOWER(u.email)
                      )
                      AND mr.deleted_at IS NOT NULL
                      AND mr.deleted_at < NOW() - INTERVAL '30 days'
                      AND mr.purged_at IS NULL
                    RETURNING mr.id
                    """,
                    (now, ids, company_id, user_id),
                )
            elif view_type == "recipient" and mailbox_key == "system:spam":
                cursor.execute(
                    """
                    UPDATE mail_recipients mr
                    SET deleted_at = %s
                    FROM mail_messages m, users u
                    WHERE mr.id = ANY(%s)
                      AND m.id = mr.message_id
                      AND m.company_id = %s
                      AND m.status = 'sent'
                      AND u.id = %s
                      AND u.company_id = m.company_id
                      AND (
                        mr.recipient_user_id = u.id
                        OR LOWER(mr.recipient_email) = LOWER(u.email)
                      )
                      AND mr.deleted_at IS NULL
                      AND mr.purged_at IS NULL
                      AND mr.is_spam = TRUE
                      AND mr.received_at < NOW() - INTERVAL '30 days'
                    RETURNING mr.id
                    """,
                    (now, ids, company_id, user_id),
                )
            elif view_type == "recipient":
                is_folder = mailbox_key.startswith("folder:")
                folder_id = (
                    mailbox_key.removeprefix("folder:")
                    if is_folder
                    else None
                )
                folder_predicate = (
                    "mr.folder_id = %s"
                    if is_folder
                    else "mr.folder_id IS NULL"
                )
                cursor.execute(
                    f"""
                    UPDATE mail_recipients mr
                    SET deleted_at = %s
                    FROM mail_messages m, users u, user_mailbox_policies p
                    WHERE mr.id = ANY(%s)
                      AND m.id = mr.message_id
                      AND m.company_id = %s
                      AND m.status = 'sent'
                      AND u.id = %s
                      AND u.company_id = m.company_id
                      AND (
                        mr.recipient_user_id = u.id
                        OR LOWER(mr.recipient_email) = LOWER(u.email)
                      )
                      AND mr.deleted_at IS NULL
                      AND mr.purged_at IS NULL
                      AND mr.is_spam = FALSE
                      AND {folder_predicate}
                      AND p.company_id = m.company_id
                      AND p.user_id = u.id
                      AND p.mailbox_type = %s
                      AND p.folder_id IS NOT DISTINCT FROM %s
                      AND p.retention_days IS NOT NULL
                      AND mr.received_at
                          < NOW() - make_interval(days => p.retention_days)
                    RETURNING mr.id
                    """,
                    (
                        now,
                        ids,
                        company_id,
                        user_id,
                        *((folder_id,) if is_folder else ()),
                        "folder" if is_folder else "inbox",
                        folder_id,
                    ),
                )
            elif action == "purge":
                cursor.execute(
                    """
                    UPDATE mail_messages m
                    SET sender_purged_at = %s
                    WHERE m.id = ANY(%s)
                      AND m.company_id = %s
                      AND m.sender_user_id = %s
                      AND m.status IN ('sent', 'draft')
                      AND (
                        m.status <> 'sent'
                        OR m.sender_copy_saved = TRUE
                      )
                      AND m.sender_deleted_at IS NOT NULL
                      AND m.sender_deleted_at
                          < NOW() - INTERVAL '30 days'
                      AND m.sender_purged_at IS NULL
                    RETURNING m.id
                    """,
                    (now, ids, company_id, user_id),
                )
            else:
                mailbox_type = mailbox_key.removeprefix("system:")
                cursor.execute(
                    """
                    UPDATE mail_messages m
                    SET sender_deleted_at = %s
                    FROM user_mailbox_policies p
                    WHERE m.id = ANY(%s)
                      AND m.company_id = %s
                      AND m.sender_user_id = %s
                      AND m.status = %s
                      AND (
                        m.status <> 'sent'
                        OR m.sender_copy_saved = TRUE
                      )
                      AND m.sender_deleted_at IS NULL
                      AND m.sender_purged_at IS NULL
                      AND p.company_id = m.company_id
                      AND p.user_id = m.sender_user_id
                      AND p.mailbox_type = m.status
                      AND p.folder_id IS NULL
                      AND p.retention_days IS NOT NULL
                      AND (
                        CASE WHEN m.status = 'sent'
                             THEN m.sent_at ELSE m.updated_at END
                      ) < NOW() - make_interval(days => p.retention_days)
                    RETURNING m.id
                    """,
                    (
                        now,
                        ids,
                        company_id,
                        user_id,
                        mailbox_type,
                    ),
                )
            changed_rows = cursor.fetchall()
            if changed_rows:
                changed_counts[
                    (company_id, user_id, mailbox_key)
                ] += len(changed_rows)
        return changed_counts

    def _write_audit(
        self,
        cursor,
        actor: AuthUserSummary,
        target_id: str,
        event: str,
        mailbox_key: str,
        details: dict,
    ) -> None:
        reason = {"mailboxKey": mailbox_key, **details}
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type,
                target_id, event, status_before, status_after, reason, created_at
            ) VALUES (%s, %s, %s, %s, 'mailbox', %s, %s, '{}', '{}', %s, %s)
            """,
            (
                self._new_id("audit"),
                actor.companyId,
                actor.userId,
                actor.userName,
                target_id,
                event,
                json.dumps(reason, ensure_ascii=False, sort_keys=True),
                self._now(),
            ),
        )

    @staticmethod
    def _to_settings_row(row: dict) -> MailboxSettingsRow:
        return MailboxSettingsRow(
            mailboxKey=row["mailbox_key"],
            name=row["name"],
            mailboxType=row["mailbox_type"],
            retentionDays=row["retention_days"],
            retentionEditable=row["retention_editable"],
            unreadCount=row["unread_count"],
            totalCount=row["total_count"],
            usedBytes=row["used_bytes"],
            version=row["version"],
        )

    @staticmethod
    def _system_overview_sql() -> str:
        return """
            WITH attachment_bytes AS (
                SELECT message_id, COALESCE(SUM(size_bytes), 0) AS bytes
                FROM mail_attachments
                GROUP BY message_id
            ),
            raw_actor_views AS (
                SELECT
                    CASE
                        WHEN mr.deleted_at IS NOT NULL THEN 'system:trash'
                        WHEN mr.is_spam THEN 'system:spam'
                        ELSE 'system:inbox'
                    END AS mailbox_key,
                    m.id AS message_id,
                    'recipient' AS view_type,
                    mr.is_read,
                    OCTET_LENGTH(COALESCE(m.subject, ''))
                      + OCTET_LENGTH(COALESCE(m.body_text, ''))
                      + OCTET_LENGTH(COALESCE(m.body_html, ''))
                      + COALESCE(a.bytes, 0) AS used_bytes
                FROM mail_recipients mr
                JOIN mail_messages m ON m.id = mr.message_id
                LEFT JOIN attachment_bytes a ON a.message_id = m.id
                WHERE m.company_id = %s
                  AND (
                    mr.recipient_user_id = %s
                    OR LOWER(mr.recipient_email) = %s
                  )
                  AND m.status = 'sent'
                  AND mr.purged_at IS NULL
                  AND (
                    mr.deleted_at IS NOT NULL
                    OR mr.is_spam
                    OR mr.folder_id IS NULL
                  )
                UNION ALL
                SELECT
                    CASE
                        WHEN m.sender_deleted_at IS NOT NULL THEN 'system:trash'
                        ELSE 'system:' || m.status
                    END,
                    m.id,
                    'sender',
                    NULL,
                    OCTET_LENGTH(COALESCE(m.subject, ''))
                      + OCTET_LENGTH(COALESCE(m.body_text, ''))
                      + OCTET_LENGTH(COALESCE(m.body_html, ''))
                      + COALESCE(a.bytes, 0)
                FROM mail_messages m
                LEFT JOIN attachment_bytes a ON a.message_id = m.id
                WHERE m.company_id = %s
                  AND m.sender_user_id = %s
                  AND m.sender_purged_at IS NULL
                  AND (m.status <> 'sent' OR m.sender_copy_saved = TRUE)
                  AND (m.sender_deleted_at IS NOT NULL OR m.status IN ('sent', 'draft', 'scheduled'))
            ),
            actor_views AS (
                SELECT
                    mailbox_key,
                    message_id,
                    view_type,
                    CASE WHEN view_type = 'recipient'
                         THEN BOOL_AND(is_read) ELSE NULL END AS is_read,
                    MAX(used_bytes) AS used_bytes
                FROM raw_actor_views
                GROUP BY mailbox_key, message_id, view_type
            ),
            system_mailboxes(mailbox_key, name, mailbox_type, retention_editable, fixed_retention, sort_order) AS (
                VALUES
                    ('system:inbox', '받은편지함', 'inbox', TRUE, NULL, 1),
                    ('system:sent', '보낸편지함', 'sent', TRUE, NULL, 2),
                    ('system:draft', '임시보관함', 'draft', TRUE, NULL, 3),
                    ('system:scheduled', '예약메일함', 'scheduled', FALSE, NULL, 4),
                    ('system:spam', '스팸함', 'spam', FALSE, 30, 5),
                    ('system:trash', '휴지통', 'trash', FALSE, 30, 6)
            )
            SELECT
                s.mailbox_key,
                s.name,
                s.mailbox_type,
                CASE WHEN s.retention_editable THEN p.retention_days ELSE s.fixed_retention END AS retention_days,
                s.retention_editable,
                CASE WHEN s.mailbox_type IN ('sent', 'draft', 'scheduled')
                     THEN NULL ELSE COUNT(*) FILTER (WHERE v.is_read = FALSE) END AS unread_count,
                COUNT(v.message_id) AS total_count,
                COALESCE(SUM(v.used_bytes), 0) AS used_bytes,
                COALESCE(p.version, 1) AS version
            FROM system_mailboxes s
            LEFT JOIN actor_views v ON v.mailbox_key = s.mailbox_key
            LEFT JOIN user_mailbox_policies p
              ON p.company_id = %s AND p.user_id = %s
             AND p.mailbox_type = s.mailbox_type AND p.folder_id IS NULL
            GROUP BY s.mailbox_key, s.name, s.mailbox_type, s.retention_editable,
                     s.fixed_retention, s.sort_order, p.retention_days, p.version
            ORDER BY s.sort_order
        """

    @staticmethod
    def _folder_overview_sql() -> str:
        return """
            WITH attachment_bytes AS (
                SELECT message_id, COALESCE(SUM(size_bytes), 0) AS bytes
                FROM mail_attachments GROUP BY message_id
            ),
            folder_actor_views AS (
                SELECT
                    mr.folder_id,
                    m.id AS message_id,
                    BOOL_AND(mr.is_read) AS is_read,
                    MAX(
                        OCTET_LENGTH(COALESCE(m.subject, ''))
                        + OCTET_LENGTH(COALESCE(m.body_text, ''))
                        + OCTET_LENGTH(COALESCE(m.body_html, ''))
                        + COALESCE(a.bytes, 0)
                    ) AS used_bytes
                FROM mail_recipients mr
                JOIN mail_messages m
                  ON m.id = mr.message_id
                 AND m.status = 'sent'
                LEFT JOIN attachment_bytes a ON a.message_id = m.id
                WHERE (
                    mr.recipient_user_id = %s
                    OR LOWER(mr.recipient_email) = %s
                )
                  AND m.company_id = %s
                  AND mr.deleted_at IS NULL
                  AND mr.purged_at IS NULL
                  AND mr.is_spam = FALSE
                  AND mr.folder_id IS NOT NULL
                GROUP BY mr.folder_id, m.id
            )
            SELECT
                'folder:' || f.id AS mailbox_key,
                f.name,
                'folder' AS mailbox_type,
                p.retention_days,
                TRUE AS retention_editable,
                COUNT(*) FILTER (WHERE v.is_read = FALSE) AS unread_count,
                COUNT(v.message_id) AS total_count,
                COALESCE(SUM(v.used_bytes), 0) AS used_bytes,
                COALESCE(p.version, 1) AS version
            FROM mail_user_folders f
            LEFT JOIN folder_actor_views v ON v.folder_id = f.id
            LEFT JOIN user_mailbox_policies p
              ON p.folder_id = f.id AND p.company_id = %s AND p.user_id = %s
            WHERE f.company_id = %s AND f.user_id = %s
            GROUP BY f.id, f.name, f.sort_order, p.retention_days, p.version
            ORDER BY f.sort_order, f.created_at
        """

    @staticmethod
    def _retention_candidates_sql() -> str:
        return """
            WITH candidates AS (
                SELECT mr.id AS view_id, 'recipient' AS view_type,
                       CASE WHEN mr.deleted_at IS NOT NULL THEN 'system:trash'
                            WHEN mr.is_spam THEN 'system:spam'
                            WHEN mr.folder_id IS NOT NULL THEN 'folder:' || mr.folder_id
                            ELSE 'system:inbox' END AS mailbox_key,
                       CASE WHEN mr.deleted_at IS NOT NULL THEN 'purge' ELSE 'trash' END AS action,
                       COALESCE(mr.deleted_at, mr.received_at) AS eligible_at,
                       m.company_id,
                       u.id AS user_id
                FROM mail_recipients mr
                JOIN mail_messages m ON m.id = mr.message_id
                JOIN users u
                  ON u.company_id = m.company_id
                 AND (
                    u.id = mr.recipient_user_id
                    OR LOWER(u.email) = LOWER(mr.recipient_email)
                 )
                LEFT JOIN user_mailbox_policies p
                  ON p.company_id = m.company_id
                 AND p.user_id = u.id
                 AND (
                    (mr.folder_id IS NULL AND p.mailbox_type = 'inbox' AND p.folder_id IS NULL)
                    OR (mr.folder_id IS NOT NULL AND p.mailbox_type = 'folder' AND p.folder_id = mr.folder_id)
                 )
                WHERE m.status = 'sent'
                  AND mr.purged_at IS NULL
                  AND (
                    (mr.deleted_at IS NOT NULL AND mr.deleted_at < NOW() - INTERVAL '30 days')
                    OR (mr.deleted_at IS NULL AND mr.is_spam AND mr.received_at < NOW() - INTERVAL '30 days')
                    OR (mr.deleted_at IS NULL AND NOT mr.is_spam AND p.retention_days IS NOT NULL
                        AND mr.received_at < NOW() - make_interval(days => p.retention_days))
                  )
                UNION ALL
                SELECT m.id, 'sender',
                       CASE WHEN m.sender_deleted_at IS NOT NULL THEN 'system:trash'
                            ELSE 'system:' || m.status END,
                       CASE WHEN m.sender_deleted_at IS NOT NULL THEN 'purge' ELSE 'trash' END,
                       COALESCE(m.sender_deleted_at,
                           CASE WHEN m.status = 'sent' THEN m.sent_at ELSE m.updated_at END),
                       m.company_id,
                       m.sender_user_id
                FROM mail_messages m
                LEFT JOIN user_mailbox_policies p
                  ON p.company_id = m.company_id
                 AND p.user_id = m.sender_user_id
                 AND p.mailbox_type = m.status
                 AND p.folder_id IS NULL
                WHERE m.sender_purged_at IS NULL
                  AND m.status IN ('sent', 'draft')
                  AND (m.status <> 'sent' OR m.sender_copy_saved = TRUE)
                  AND (
                    (m.sender_deleted_at IS NOT NULL
                     AND m.sender_deleted_at < NOW() - INTERVAL '30 days')
                    OR (m.sender_deleted_at IS NULL AND p.retention_days IS NOT NULL
                        AND COALESCE(m.sent_at, m.updated_at)
                            < NOW() - make_interval(days => p.retention_days))
                  )
            )
            SELECT view_id, view_type, mailbox_key, action, company_id, user_id
            FROM candidates
            ORDER BY eligible_at
            LIMIT %s
        """
