from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path, PurePosixPath
from time import monotonic
from typing import Callable
import uuid

from psycopg.errors import UniqueViolation

from app.core.config import settings
from app.schemas.auth import AuthUserSummary
from app.schemas.mail_messenger import (
    MailBackupJobListResponse,
    MailBackupJobView,
)
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.mailbox_backup_archive import (
    BackupArtifactResult,
    BackupLeaseLostError,
    MailboxBackupArchive,
)
from app.services.mailbox_scope import MailboxScope
from app.services.postgres_service import PostgresService


BACKUP_ERROR_CODES = {
    "BACKUP_SOURCE_MISSING",
    "BACKUP_STORAGE_FULL",
    "BACKUP_IO_FAILED",
    "BACKUP_INTERNAL_FAILED",
}


@dataclass(frozen=True)
class BackupDownload:
    path: Path
    download_name: str


class MailboxBackupService:
    def __init__(
        self,
        *,
        storage_root: Path | None = None,
        monotonic_clock: Callable[[], float] | None = None,
    ) -> None:
        self.db = PostgresService()
        self._monotonic = monotonic_clock or monotonic
        self.storage_root = (storage_root or settings.storage_path).resolve()
        self.attachment_storage = MailAttachmentStorage(root=self.storage_root)
        self.archive = MailboxBackupArchive(
            attachment_resolver=self.attachment_storage.stored_path
        )

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex}"

    def create_job(
        self,
        actor: AuthUserSummary,
        scope: MailboxScope,
    ) -> MailBackupJobView:
        self.db.ensure_migrations_applied()
        now = self._now()
        job_id = self._new_id("mail_backup")
        with self.db.connect() as connection:
            try:
                with connection.cursor() as cursor:
                    label = self._authorize_scope(cursor, actor, scope)
                    cursor.execute(
                        """
                        INSERT INTO mailbox_backup_jobs (
                            id, company_id, user_id, mailbox_type, folder_id,
                            mailbox_label, status, total_count, processed_count,
                            artifact_size_bytes, attempt_count, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, 'queued',
                            0, 0, 0, 0, %s, %s
                        )
                        RETURNING *
                        """,
                        (
                            job_id,
                            actor.companyId,
                            actor.userId,
                            scope.mailbox_type,
                            scope.folder_id,
                            label,
                            now,
                            now,
                        ),
                    )
                    row = cursor.fetchone()
                    self._audit(
                        cursor,
                        company_id=actor.companyId,
                        actor_user_id=actor.userId,
                        actor_user_name=actor.userName,
                        job_id=job_id,
                        event="mail.backup.queued",
                        mailbox_key=scope.key,
                    )
                connection.commit()
            except UniqueViolation as exc:
                raise ValueError("진행 중인 메일함 백업이 있습니다.") from exc
        return self._job_view(row)

    def list_jobs(self, actor: AuthUserSummary) -> MailBackupJobListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM mailbox_backup_jobs
                    WHERE company_id = %s AND user_id = %s
                    ORDER BY created_at DESC
                    LIMIT 20
                    """,
                    (actor.companyId, actor.userId),
                )
                rows = cursor.fetchall()
        return MailBackupJobListResponse(
            jobs=[self._job_view(row) for row in rows]
        )

    def retry_job(
        self,
        actor: AuthUserSummary,
        job_id: str,
    ) -> MailBackupJobView:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT mailbox_type, folder_id, status
                    FROM mailbox_backup_jobs
                    WHERE id = %s AND company_id = %s AND user_id = %s
                    """,
                    (job_id, actor.companyId, actor.userId),
                )
                row = cursor.fetchone()
        if row is None:
            raise PermissionError("백업 작업에 접근할 수 없습니다.")
        if row["status"] not in {"failed", "expired"}:
            raise ValueError("이 백업 작업은 재시도할 수 없습니다.")
        if row["mailbox_type"] == "folder" and not row["folder_id"]:
            raise ValueError("삭제된 사용자 메일함은 다시 백업할 수 없습니다.")
        key = (
            f"folder:{row['folder_id']}"
            if row["mailbox_type"] == "folder"
            else f"system:{row['mailbox_type']}"
        )
        return self.create_job(actor, MailboxScope.parse(key))

    def claim_next(self, worker_id: str) -> dict | None:
        self.db.ensure_migrations_applied()
        now = self._now()
        lease_minutes = int(getattr(settings, "mail_backup_lease_minutes", 10))
        lease_expires = now + timedelta(minutes=lease_minutes)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET status = 'failed',
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        error_code = 'BACKUP_INTERNAL_FAILED',
                        updated_at = %s
                    WHERE status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at < %s
                      AND attempt_count >= 3
                    RETURNING *
                    """,
                    (now, now),
                )
                for terminal in cursor.fetchall():
                    self._audit(
                        cursor,
                        company_id=terminal["company_id"],
                        actor_user_id=None,
                        actor_user_name=worker_id,
                        job_id=terminal["id"],
                        event="mail.backup.failed",
                        mailbox_key=self._mailbox_key(terminal),
                        error_code="BACKUP_INTERNAL_FAILED",
                    )
                    self._cleanup_part(terminal)
                cursor.execute(
                    """
                    SELECT *
                    FROM mailbox_backup_jobs
                    WHERE (status = 'queued' AND attempt_count < 3)
                       OR (
                           status = 'running'
                           AND lease_expires_at IS NOT NULL
                           AND lease_expires_at < %s
                           AND attempt_count < 3
                       )
                    ORDER BY created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """,
                    (now,),
                )
                job = cursor.fetchone()
                if job is None:
                    connection.commit()
                    return None
                needs_snapshot = job.get("snapshot_at") is None
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET status = 'running',
                        snapshot_at = COALESCE(snapshot_at, %s),
                        started_at = COALESCE(started_at, %s),
                        lease_owner = %s,
                        lease_expires_at = %s,
                        attempt_count = attempt_count + 1,
                        error_code = NULL,
                        updated_at = %s
                    WHERE id = %s AND attempt_count < 3
                    RETURNING *
                    """,
                    (now, now, worker_id, lease_expires, now, job["id"]),
                )
                claimed = cursor.fetchone()
                if claimed is None:
                    return None
                if needs_snapshot:
                    cursor.execute(
                        self._snapshot_items_sql(claimed["mailbox_type"]),
                        self._snapshot_params(claimed),
                    )
                cursor.execute(
                    """
                    SELECT COUNT(*) AS total_count
                    FROM mailbox_backup_job_items
                    WHERE job_id = %s
                    """,
                    (claimed["id"],),
                )
                total = int(cursor.fetchone()["total_count"])
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET total_count = %s, updated_at = %s
                    WHERE id = %s
                    RETURNING *
                    """,
                    (total, now, claimed["id"]),
                )
                claimed = cursor.fetchone()
                self._audit(
                    cursor,
                    company_id=claimed["company_id"],
                    actor_user_id=None,
                    actor_user_name=worker_id,
                    job_id=claimed["id"],
                    event="mail.backup.started",
                    mailbox_key=self._mailbox_key(claimed),
                )
            connection.commit()
        return claimed

    def build_claimed(
        self,
        job: dict,
        worker_id: str,
    ) -> BackupArtifactResult:
        manifest_count, manifest_total_bytes = self._snapshot_totals(job)
        output = self.artifact_path(
            f"mail/backups/{job['company_id']}/{job['user_id']}/{job['id']}.zip"
        )
        lease_minutes = int(getattr(settings, "mail_backup_lease_minutes", 10))
        heartbeat_interval = min(30.0, max(0.0, lease_minutes * 60.0 / 3.0))
        last_heartbeat_at = self._monotonic()
        last_processed = 0

        def heartbeat_progress(processed: int) -> bool:
            nonlocal last_heartbeat_at, last_processed
            now = self._monotonic()
            message_boundary = processed > last_processed
            if (
                not message_boundary
                and now - last_heartbeat_at < heartbeat_interval
            ):
                return True
            if not self.heartbeat(worker_id, job["id"], processed):
                return False
            last_heartbeat_at = now
            last_processed = max(last_processed, processed)
            return True

        result = self.archive.build(
            job,
            self._iter_job_items(job),
            output,
            temp_path=self.attempt_temp_path(job, worker_id),
            progress_callback=heartbeat_progress,
            manifest_count=manifest_count,
            manifest_total_bytes=manifest_total_bytes,
        )
        if not self.heartbeat(
            worker_id,
            job["id"],
            result.processed_count,
        ):
            if result.temp_path is not None:
                result.temp_path.unlink(missing_ok=True)
            raise BackupLeaseLostError("백업 lease 소유권을 잃었습니다.")
        return result

    def _snapshot_totals(self, job: dict) -> tuple[int, int]:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    WITH attachment_bytes AS (
                        SELECT message_id, COALESCE(SUM(size_bytes), 0) AS bytes
                        FROM mail_attachments
                        GROUP BY message_id
                    )
                    SELECT COUNT(i.message_id) AS total_count,
                           COALESCE(SUM(
                               OCTET_LENGTH(COALESCE(m.subject, ''))
                               + OCTET_LENGTH(COALESCE(m.body_text, ''))
                               + OCTET_LENGTH(COALESCE(m.body_html, ''))
                               + COALESCE(a.bytes, 0)
                           ), 0) AS total_bytes
                    FROM mailbox_backup_job_items i
                    JOIN mailbox_backup_jobs j ON j.id = i.job_id
                    JOIN mail_messages m
                      ON m.id = i.message_id AND m.company_id = j.company_id
                    LEFT JOIN attachment_bytes a ON a.message_id = m.id
                    WHERE i.job_id = %s
                      AND j.company_id = %s
                      AND j.user_id = %s
                    """,
                    (job["id"], job["company_id"], job["user_id"]),
                )
                row = cursor.fetchone() or {}
        return int(row.get("total_count") or 0), int(
            row.get("total_bytes") or 0
        )

    def heartbeat(
        self,
        worker_id: str,
        job_id: str,
        processed_count: int,
    ) -> bool:
        now = self._now()
        lease_minutes = int(getattr(settings, "mail_backup_lease_minutes", 10))
        lease_expires = now + timedelta(minutes=lease_minutes)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET lease_expires_at = %s,
                        processed_count = GREATEST(
                            processed_count,
                            LEAST(total_count, %s)
                        ),
                        updated_at = %s
                    WHERE id = %s
                      AND status = 'running'
                      AND lease_owner = %s
                      AND lease_expires_at > %s
                    RETURNING id
                    """,
                    (
                        lease_expires,
                        max(0, processed_count),
                        now,
                        job_id,
                        worker_id,
                        now,
                    ),
                )
                owned = cursor.fetchone()
            connection.commit()
        return owned is not None

    def complete_job(
        self,
        worker_id: str,
        job: dict,
        result: BackupArtifactResult,
    ) -> bool:
        now = self._now()
        ttl_hours = int(getattr(settings, "mail_backup_ttl_hours", 24))
        expires = now + timedelta(hours=ttl_hours)
        temp_path = result.temp_path or self.attempt_temp_path(job, worker_id)
        final_path = self.artifact_path(result.artifact_key)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM mailbox_backup_jobs
                    WHERE id = %s
                      AND status = 'running'
                      AND lease_owner = %s
                      AND lease_expires_at > %s
                    FOR UPDATE
                    """,
                    (job["id"], worker_id, now),
                )
                owned = cursor.fetchone()
                if owned is None:
                    temp_path.unlink(missing_ok=True)
                    return False
                if not temp_path.is_file():
                    raise FileNotFoundError("백업 임시 파일이 없습니다.")
                if temp_path.stat().st_size != result.size_bytes:
                    raise OSError("백업 임시 파일 크기가 일치하지 않습니다.")
                final_path.parent.mkdir(parents=True, exist_ok=True)
                temp_path.replace(final_path)
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET status = 'completed',
                        processed_count = %s,
                        artifact_key = %s,
                        artifact_size_bytes = %s,
                        completed_at = %s,
                        expires_at = %s,
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        error_code = NULL,
                        updated_at = %s
                    WHERE id = %s
                      AND status = 'running'
                      AND lease_owner = %s
                    RETURNING *
                    """,
                    (
                        result.processed_count,
                        result.artifact_key,
                        result.size_bytes,
                        now,
                        expires,
                        now,
                        job["id"],
                        worker_id,
                    ),
                )
                completed = cursor.fetchone()
                if completed is None:
                    return False
                self._audit(
                    cursor,
                    company_id=completed["company_id"],
                    actor_user_id=None,
                    actor_user_name=worker_id,
                    job_id=completed["id"],
                    event="mail.backup.completed",
                    mailbox_key=self._mailbox_key(completed),
                )
            connection.commit()
        return True

    def fail_job(self, worker_id: str, job: dict, error_code: str) -> bool:
        sanitized = (
            error_code
            if error_code in BACKUP_ERROR_CODES
            else "BACKUP_INTERNAL_FAILED"
        )
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE mailbox_backup_jobs
                    SET status = CASE
                            WHEN attempt_count >= 3 THEN 'failed'
                            ELSE 'queued'
                        END,
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        error_code = %s,
                        updated_at = %s
                    WHERE id = %s
                      AND status = 'running'
                      AND lease_owner = %s
                    RETURNING *
                    """,
                    (sanitized, now, job["id"], worker_id),
                )
                failed = cursor.fetchone()
                if failed is None:
                    return False
                self.attempt_temp_path(job, worker_id).unlink(
                    missing_ok=True
                )
                self._audit(
                    cursor,
                    company_id=failed["company_id"],
                    actor_user_id=None,
                    actor_user_name=worker_id,
                    job_id=failed["id"],
                    event=(
                        "mail.backup.failed"
                        if failed["status"] == "failed"
                        else "mail.backup.retry_queued"
                    ),
                    mailbox_key=self._mailbox_key(failed),
                    error_code=sanitized,
                )
            connection.commit()
        return True

    def expire_artifacts(self) -> int:
        now = self._now()
        expired_count = 0
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM mailbox_backup_jobs
                    WHERE status = 'completed'
                      AND expires_at IS NOT NULL
                      AND expires_at <= %s
                    FOR UPDATE SKIP LOCKED
                    """,
                    (now,),
                )
                jobs = cursor.fetchall()
                for job in jobs:
                    if job.get("artifact_key"):
                        self.artifact_path(job["artifact_key"]).unlink(
                            missing_ok=True
                        )
                    self._cleanup_part(job)
                    cursor.execute(
                        """
                        DELETE FROM mailbox_backup_job_items
                        WHERE job_id = %s
                        """,
                        (job["id"],),
                    )
                    cursor.execute(
                        """
                        UPDATE mailbox_backup_jobs
                        SET status = 'expired',
                            artifact_key = NULL,
                            artifact_size_bytes = 0,
                            updated_at = %s
                        WHERE id = %s
                        """,
                        (now, job["id"]),
                    )
                    self._audit(
                        cursor,
                        company_id=job["company_id"],
                        actor_user_id=None,
                        actor_user_name="mail-backup-worker",
                        job_id=job["id"],
                        event="mail.backup.expired",
                        mailbox_key=self._mailbox_key(job),
                    )
                    expired_count += 1
            connection.commit()
        return expired_count

    def download_artifact(
        self,
        actor: AuthUserSummary,
        job_id: str,
    ) -> BackupDownload:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM mailbox_backup_jobs
                    WHERE id = %s
                      AND company_id = %s
                      AND user_id = %s
                      AND status = 'completed'
                      AND expires_at > %s
                    """,
                    (job_id, actor.companyId, actor.userId, self._now()),
                )
                job = cursor.fetchone()
        if job is None:
            raise PermissionError("다운로드할 백업을 찾을 수 없습니다.")
        if not job.get("artifact_key"):
            raise FileNotFoundError("백업 파일이 없습니다.")
        path = self.artifact_path(job["artifact_key"])
        if not path.is_file() or path.stat().st_size != int(
            job["artifact_size_bytes"]
        ):
            raise FileNotFoundError("백업 파일을 찾을 수 없습니다.")
        created_at = job["created_at"]
        stamp = created_at.astimezone(UTC).strftime("%Y%m%d-%H%M%S")
        return BackupDownload(
            path=path,
            download_name=f"moaworks-mail-backup-{stamp}.zip",
        )

    def artifact_path(self, artifact_key: str) -> Path:
        pure = PurePosixPath(artifact_key)
        if (
            pure.is_absolute()
            or ".." in pure.parts
            or len(pure.parts) != 5
            or pure.parts[:2] != ("mail", "backups")
            or pure.suffix != ".zip"
        ):
            raise ValueError("백업 저장 식별자가 올바르지 않습니다.")
        path = (self.storage_root / Path(*pure.parts)).resolve()
        backup_root = (self.storage_root / "mail" / "backups").resolve()
        if backup_root not in path.parents:
            raise ValueError("백업 저장 경계를 벗어났습니다.")
        return path

    def attempt_temp_path(self, job: dict, worker_id: str) -> Path:
        artifact_key = (
            f"mail/backups/{job['company_id']}/{job['user_id']}/{job['id']}.zip"
        )
        final_path = self.artifact_path(artifact_key)
        owner_hash = hashlib.sha256(worker_id.encode("utf-8")).hexdigest()[:16]
        attempt = max(0, int(job.get("attempt_count") or 0))
        return final_path.with_name(
            f"{final_path.name}.{attempt}.{owner_hash}.part"
        )

    def _iter_job_items(
        self,
        job: dict,
        batch_size: int = 50,
    ):
        bounded_batch = max(1, min(int(batch_size), 100))
        last_ordinal = 0
        while True:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            i.ordinal, i.message_id, i.view_type, i.recipient_id,
                            m.sender_email, m.subject, m.body_text, m.body_html,
                            COALESCE(m.sent_at, m.updated_at) AS sent_at
                        FROM mailbox_backup_job_items i
                        JOIN mailbox_backup_jobs j ON j.id = i.job_id
                        JOIN mail_messages m
                          ON m.id = i.message_id
                         AND m.company_id = j.company_id
                        WHERE i.job_id = %s
                          AND j.company_id = %s
                          AND j.user_id = %s
                          AND i.ordinal > %s
                        ORDER BY i.ordinal
                        LIMIT %s
                        """,
                        (
                            job["id"],
                            job["company_id"],
                            job["user_id"],
                            last_ordinal,
                            bounded_batch,
                        ),
                    )
                    rows = cursor.fetchall()
                    if not rows:
                        return
                    message_ids = list(
                        dict.fromkeys(row["message_id"] for row in rows)
                    )
                    cursor.execute(
                        """
                        SELECT message_id, recipient_email, recipient_kind
                        FROM mail_recipients
                        WHERE message_id = ANY(%s)
                        ORDER BY message_id, id
                        """,
                        (message_ids,),
                    )
                    recipients = cursor.fetchall()
                    cursor.execute(
                        """
                        SELECT message_id, file_name, content_type,
                               size_bytes, storage_key
                        FROM mail_attachments
                        WHERE message_id = ANY(%s)
                        ORDER BY message_id, created_at, id
                        """,
                        (message_ids,),
                    )
                    attachments = cursor.fetchall()

            recipient_map: dict[str, dict[str, list[str]]] = {}
            for recipient in recipients:
                recipient_map.setdefault(
                    recipient["message_id"],
                    {"to": [], "cc": [], "bcc": []},
                )[recipient["recipient_kind"]].append(
                    recipient["recipient_email"]
                )
            attachment_map: dict[str, list[dict]] = {}
            for attachment in attachments:
                attachment_map.setdefault(
                    attachment["message_id"],
                    [],
                ).append(dict(attachment))

            for row in rows:
                addresses = recipient_map.get(
                    row["message_id"],
                    {"to": [], "cc": [], "bcc": []},
                )
                yield {
                    **dict(row),
                    "to": addresses["to"],
                    "cc": addresses["cc"],
                    "bcc": (
                        addresses["bcc"]
                        if row["view_type"] == "sender"
                        else []
                    ),
                    "attachments": attachment_map.get(
                        row["message_id"],
                        [],
                    ),
                }
            last_ordinal = int(rows[-1]["ordinal"])
            if len(rows) < bounded_batch:
                return

    @staticmethod
    def _snapshot_params(job: dict) -> tuple:
        return (job["id"],)

    @staticmethod
    def _snapshot_items_sql(mailbox_type: str) -> str:
        recipient_conditions = {
            "inbox": "mr.folder_id IS NULL AND mr.is_spam = FALSE AND mr.deleted_at IS NULL",
            "spam": "mr.is_spam = TRUE AND mr.deleted_at IS NULL",
            "folder": "mr.folder_id = %s AND mr.is_spam = FALSE AND mr.deleted_at IS NULL",
        }
        if mailbox_type in recipient_conditions:
            condition = recipient_conditions[mailbox_type]
            return f"""
                WITH owned_job AS (
                    SELECT j.id, j.company_id, j.user_id, j.folder_id,
                           LOWER(u.email) AS user_email
                    FROM mailbox_backup_jobs j
                    JOIN users u
                      ON u.id = j.user_id AND u.company_id = j.company_id
                    WHERE j.id = %s
                ),
                candidate_views AS (
                    SELECT j.id AS job_id,
                           mr.message_id,
                           mr.id AS recipient_id,
                           mr.received_at,
                           ROW_NUMBER() OVER (
                               PARTITION BY j.id, mr.message_id
                               ORDER BY mr.received_at, mr.id
                           ) AS actor_view_rank
                    FROM owned_job j
                    JOIN mail_recipients mr
                      ON (
                        mr.recipient_user_id = j.user_id
                        OR LOWER(mr.recipient_email) = j.user_email
                      )
                    JOIN mail_messages m ON m.id = mr.message_id
                    WHERE m.company_id = j.company_id
                      AND m.status = 'sent'
                      AND mr.purged_at IS NULL
                      AND {condition.replace("%s", "j.folder_id")}
                )
                INSERT INTO mailbox_backup_job_items (
                    job_id, ordinal, message_id, view_type, recipient_id
                )
                SELECT job_id,
                       ROW_NUMBER() OVER (ORDER BY received_at, recipient_id),
                       message_id, 'recipient', recipient_id
                FROM candidate_views
                WHERE actor_view_rank = 1
                ON CONFLICT DO NOTHING
            """
        if mailbox_type == "trash":
            return """
                WITH owned_job AS (
                    SELECT j.id, j.company_id, j.user_id,
                           LOWER(u.email) AS user_email
                    FROM mailbox_backup_jobs j
                    JOIN users u
                      ON u.id = j.user_id AND u.company_id = j.company_id
                    WHERE j.id = %s
                ),
                raw_views AS (
                    SELECT j.id AS job_id, mr.message_id,
                           'recipient' AS view_type,
                           mr.id AS recipient_id, mr.id AS view_id,
                           mr.deleted_at AS source_time
                    FROM owned_job j
                    JOIN mail_recipients mr
                      ON (
                        mr.recipient_user_id = j.user_id
                        OR LOWER(mr.recipient_email) = j.user_email
                      )
                    JOIN mail_messages m ON m.id = mr.message_id
                    WHERE m.company_id = j.company_id
                      AND m.status = 'sent'
                      AND mr.deleted_at IS NOT NULL
                      AND mr.purged_at IS NULL
                    UNION ALL
                    SELECT j.id, m.id, 'sender', NULL, m.id,
                           m.sender_deleted_at
                    FROM owned_job j
                    JOIN mail_messages m
                      ON m.company_id = j.company_id
                     AND m.sender_user_id = j.user_id
                    WHERE m.sender_deleted_at IS NOT NULL
                      AND m.sender_purged_at IS NULL
                      AND (
                        m.status <> 'sent'
                        OR m.sender_copy_saved = TRUE
                      )
                ),
                views AS (
                    SELECT job_id, message_id, view_type, recipient_id,
                           view_id, source_time
                    FROM (
                        SELECT raw_views.*,
                               ROW_NUMBER() OVER (
                                   PARTITION BY job_id, message_id, view_type
                                   ORDER BY source_time, view_id
                               ) AS actor_view_rank
                        FROM raw_views
                    ) ranked_views
                    WHERE actor_view_rank = 1
                )
                INSERT INTO mailbox_backup_job_items (
                    job_id, ordinal, message_id, view_type, recipient_id
                )
                SELECT job_id,
                       ROW_NUMBER() OVER (ORDER BY source_time, view_type, view_id),
                       message_id, view_type, recipient_id
                FROM views
                ON CONFLICT DO NOTHING
            """
        return """
            WITH owned_job AS (
                SELECT id, company_id, user_id, mailbox_type
                FROM mailbox_backup_jobs
                WHERE id = %s
            )
            INSERT INTO mailbox_backup_job_items (
                job_id, ordinal, message_id, view_type, recipient_id
            )
            SELECT j.id,
                   ROW_NUMBER() OVER (ORDER BY COALESCE(m.sent_at, m.updated_at), m.id),
                   m.id, 'sender', NULL
            FROM owned_job j
            JOIN mail_messages m
              ON m.company_id = j.company_id
             AND m.sender_user_id = j.user_id
            WHERE m.status = j.mailbox_type
              AND (
                m.status <> 'sent'
                OR m.sender_copy_saved = TRUE
              )
              AND m.sender_deleted_at IS NULL
              AND m.sender_purged_at IS NULL
            ON CONFLICT DO NOTHING
        """

    def _authorize_scope(
        self,
        cursor,
        actor: AuthUserSummary,
        scope: MailboxScope,
    ) -> str:
        if scope.mailbox_type != "folder":
            return {
                "inbox": "받은편지함",
                "sent": "보낸편지함",
                "draft": "임시보관함",
                "scheduled": "예약메일함",
                "spam": "스팸함",
                "trash": "휴지통",
            }[scope.mailbox_type]
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

    @staticmethod
    def _mailbox_key(row: dict) -> str:
        if row["mailbox_type"] == "folder":
            return (
                f"folder:{row['folder_id']}"
                if row.get("folder_id")
                else "folder:deleted"
            )
        return f"system:{row['mailbox_type']}"

    def _job_view(self, row: dict) -> MailBackupJobView:
        return MailBackupJobView(
            jobId=row["id"],
            mailboxKey=self._mailbox_key(row),
            mailboxLabel=row["mailbox_label"],
            status=row["status"],
            totalCount=int(row["total_count"]),
            processedCount=int(row["processed_count"]),
            artifactSizeBytes=int(row["artifact_size_bytes"]),
            errorCode=row.get("error_code"),
            expiresAt=row.get("expires_at"),
        )

    def _cleanup_part(self, job: dict) -> None:
        key = (
            f"mail/backups/{job['company_id']}/{job['user_id']}/{job['id']}.zip"
        )
        final_path = self.artifact_path(key)
        final_path.with_suffix(final_path.suffix + ".part").unlink(
            missing_ok=True
        )
        for attempt_path in final_path.parent.glob(f"{final_path.name}.*.part"):
            attempt_path.unlink(missing_ok=True)

    def _audit(
        self,
        cursor,
        *,
        company_id: str,
        actor_user_id: str | None,
        actor_user_name: str,
        job_id: str,
        event: str,
        mailbox_key: str,
        error_code: str | None = None,
    ) -> None:
        reason = {"mailboxKey": mailbox_key}
        if error_code:
            reason["errorCode"] = error_code
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type,
                target_id, event, status_before, status_after, reason, created_at
            ) VALUES (
                %s, %s, %s, %s, 'mailbox_backup_job',
                %s, %s, NULL, NULL, %s, %s
            )
            """,
            (
                self._new_id("audit"),
                company_id,
                actor_user_id,
                actor_user_name,
                job_id,
                event,
                json.dumps(reason, ensure_ascii=False, sort_keys=True),
                self._now(),
            ),
        )
