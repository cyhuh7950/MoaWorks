from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
from pathlib import Path
import shutil
import tempfile
import time
from uuid import uuid4

from app.core.config import settings
from app.services.operational_backup_runtime import BackupArchiveEngine, EncryptedBackupArtifact, PostgresBackupRuntime
from app.services.postgres_service import PostgresService


class OperationalBackupService:
    def __init__(self, db=None, postgres_runtime=None) -> None:
        self.db = db or PostgresService()
        self.postgres_runtime = postgres_runtime or PostgresBackupRuntime(
            host=settings.postgres_host,
            port=settings.postgres_port,
            database=settings.postgres_db,
            user=settings.postgres_user,
            password=settings.postgres_password,
        )
        self.archive = BackupArchiveEngine()
        self.cipher = EncryptedBackupArtifact(settings.setup_secret_key)

    def get_overview(self, actor) -> dict:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                policy = self._policy(cursor, actor.companyId)
                cursor.execute("SELECT * FROM operational_backup_jobs WHERE company_id=%s ORDER BY created_at DESC LIMIT 20", (actor.companyId,))
                backups = [self._backup_view(row) for row in cursor.fetchall()]
                cursor.execute("SELECT * FROM operational_restore_drills WHERE company_id=%s ORDER BY created_at DESC LIMIT 20", (actor.companyId,))
                drills = [self._drill_view(row) for row in cursor.fetchall()]
        return {"policy": self._policy_view(policy), "backups": backups, "restoreDrills": drills}

    def update_policy(self, actor, payload) -> dict:
        self.db.ensure_migrations_applied()
        now = datetime.now(UTC)
        next_run = now + timedelta(hours=payload.intervalHours) if payload.enabled else None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO operational_backup_policies(
                        company_id,enabled,interval_hours,retention_days,encryption_required,storage_path,
                        next_scheduled_at,updated_by,updated_at
                    ) VALUES(%s,%s,%s,%s,TRUE,%s,%s,%s,%s)
                    ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled,
                        interval_hours=EXCLUDED.interval_hours,retention_days=EXCLUDED.retention_days,
                        encryption_required=TRUE,storage_path=EXCLUDED.storage_path,
                        next_scheduled_at=EXCLUDED.next_scheduled_at,updated_by=EXCLUDED.updated_by,
                        updated_at=EXCLUDED.updated_at RETURNING *""",
                    (actor.companyId, payload.enabled, payload.intervalHours, payload.retentionDays,
                     str(settings.operational_backup_root_path), next_run, actor.userId, now),
                )
                row = cursor.fetchone()
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "operational_backup_policy", actor.companyId, "operations.backup.policy.updated", "enabled" if payload.enabled else "disabled")
            connection.commit()
        return self._policy_view(row)

    def queue_backup(self, actor) -> dict:
        self.db.ensure_migrations_applied()
        now = datetime.now(UTC)
        backup_id = f"backup_{uuid4().hex}"
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._policy(cursor, actor.companyId)
                cursor.execute(
                    """INSERT INTO operational_backup_jobs(id,company_id,trigger_type,status,created_by,created_at,updated_at)
                    VALUES(%s,%s,'manual','queued',%s,%s,%s) RETURNING *""",
                    (backup_id, actor.companyId, actor.userId, now, now),
                )
                row = cursor.fetchone()
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "operational_backup_job", backup_id, "operations.backup.queued", "queued")
            connection.commit()
        return self._backup_view(row)

    def queue_restore_drill(self, actor, backup_id: str) -> dict:
        self.db.ensure_migrations_applied()
        now = datetime.now(UTC)
        drill_id = f"restore_{uuid4().hex}"
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM operational_backup_jobs WHERE id=%s AND company_id=%s AND status='completed'", (backup_id, actor.companyId))
                if cursor.fetchone() is None:
                    raise ValueError("복구 훈련에는 완료된 백업이 필요합니다.")
                cursor.execute(
                    """INSERT INTO operational_restore_drills(id,company_id,backup_job_id,status,created_by,created_at,updated_at)
                    VALUES(%s,%s,%s,'queued',%s,%s,%s) RETURNING *""",
                    (drill_id, actor.companyId, backup_id, actor.userId, now, now),
                )
                row = cursor.fetchone()
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "operational_restore_drill", drill_id, "operations.restore.queued", "queued")
            connection.commit()
        return self._drill_view(row)

    def process_once(self) -> bool:
        self.db.ensure_migrations_applied()
        self._enqueue_due_backups()
        job = self._claim_backup()
        if job:
            self._run_backup(job)
            return True
        drill = self._claim_drill()
        if drill:
            self._run_restore_drill(drill)
            return True
        self._expire_backups()
        return False

    def _enqueue_due_backups(self) -> None:
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT * FROM operational_backup_policies p WHERE p.enabled=TRUE
                    AND (p.next_scheduled_at IS NULL OR p.next_scheduled_at<=%s) FOR UPDATE SKIP LOCKED""", (now,)
                )
                for policy in cursor.fetchall():
                    cursor.execute("SELECT 1 FROM operational_backup_jobs WHERE company_id=%s AND status IN ('queued','running')", (policy["company_id"],))
                    if cursor.fetchone() is None:
                        cursor.execute(
                            """INSERT INTO operational_backup_jobs(id,company_id,trigger_type,status,created_at,updated_at)
                            VALUES(%s,%s,'schedule','queued',%s,%s)""",
                            (f"backup_{uuid4().hex}", policy["company_id"], now, now),
                        )
                    cursor.execute(
                        "UPDATE operational_backup_policies SET last_scheduled_at=%s,next_scheduled_at=%s,updated_at=%s WHERE company_id=%s",
                        (now, now + timedelta(hours=policy["interval_hours"]), now, policy["company_id"]),
                    )
            connection.commit()

    def _claim_backup(self):
        return self._claim("operational_backup_jobs")

    def _claim_drill(self):
        return self._claim("operational_restore_drills")

    def _claim(self, table: str):
        if table not in {"operational_backup_jobs", "operational_restore_drills"}:
            raise ValueError("지원하지 않는 작업 테이블입니다.")
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT * FROM {table} WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")
                row = cursor.fetchone()
                if row:
                    cursor.execute(f"UPDATE {table} SET status='running',started_at=%s,updated_at=%s WHERE id=%s", (now, now, row["id"]))
                    row = {**dict(row), "status": "running", "started_at": now, "updated_at": now}
            connection.commit()
        return row

    def _run_backup(self, job) -> None:
        now = datetime.now(UTC)
        root = self._company_backup_root(job["company_id"])
        root.mkdir(parents=True, exist_ok=True)
        final_path = root / f"{job['id']}.mwbackup"
        try:
            with tempfile.TemporaryDirectory(prefix="moaworks-backup-", dir=root) as temp:
                work = Path(temp)
                dump_path = work / "database.dump"
                archive_path = work / "snapshot.zip"
                self.postgres_runtime.dump(dump_path)
                self.archive.create_archive(
                    output_path=archive_path,
                    database_dump=dump_path,
                    storage_root=settings.storage_path,
                    runtime_root=settings.operational_runtime_root_path,
                    metadata={"backupId": job["id"], "companyId": job["company_id"], "createdAt": now.isoformat()},
                )
                self.cipher.encrypt(archive_path, final_path)
            digest = self._sha256(final_path)
            self._complete_backup(job, final_path, digest, now)
        except Exception as exc:
            final_path.unlink(missing_ok=True)
            self._fail_job("operational_backup_jobs", job, "BACKUP_EXECUTION_FAILED", exc)

    def _complete_backup(self, job, final_path: Path, digest: str, snapshot_at: datetime) -> None:
        completed = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                policy = self._policy(cursor, job["company_id"])
                expires = completed + timedelta(days=policy["retention_days"])
                cursor.execute(
                    """UPDATE operational_backup_jobs SET status='completed',artifact_path=%s,artifact_sha256=%s,
                    size_bytes=%s,snapshot_at=%s,completed_at=%s,expires_at=%s,updated_at=%s WHERE id=%s""",
                    (str(final_path), digest, final_path.stat().st_size, snapshot_at, completed, expires, completed, job["id"]),
                )
                self._audit(cursor, job["company_id"], job.get("created_by"), "operational-backup-worker", "operational_backup_job", job["id"], "operations.backup.completed", digest)
            connection.commit()

    def _run_restore_drill(self, drill) -> None:
        started = time.monotonic()
        restore_database = f"moaworks_restore_{uuid4().hex[:12]}"
        try:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT * FROM operational_backup_jobs WHERE id=%s AND company_id=%s", (drill["backup_job_id"], drill["company_id"]))
                    backup = cursor.fetchone()
            if not backup or backup["status"] != "completed":
                raise ValueError("완료된 백업을 찾을 수 없습니다.")
            artifact = self._checked_artifact_path(backup["artifact_path"], drill["company_id"])
            if self._sha256(artifact) != backup["artifact_sha256"]:
                raise OSError("백업 artifact checksum이 일치하지 않습니다.")
            with tempfile.TemporaryDirectory(prefix="moaworks-restore-", dir=self._company_backup_root(drill["company_id"])) as temp:
                work = Path(temp)
                archive_path = work / "snapshot.zip"
                dump_path = work / "database.dump"
                self.cipher.decrypt(artifact, archive_path)
                verification = self.archive.verify_archive(archive_path)
                if not verification.valid:
                    raise OSError("백업 내부 파일 checksum이 일치하지 않습니다.")
                import zipfile
                with zipfile.ZipFile(archive_path) as archive:
                    dump_path.write_bytes(archive.read("database/database.dump"))
                self.postgres_runtime.restore_isolated(dump_path, restore_database)
            completed = datetime.now(UTC)
            rto = max(0, int(time.monotonic() - started))
            rpo = max(0, int((completed - backup["snapshot_at"]).total_seconds()))
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """UPDATE operational_restore_drills SET status='completed',isolated_database=%s,
                        checksum_verified=TRUE,rpo_seconds=%s,rto_seconds=%s,completed_at=%s,updated_at=%s WHERE id=%s""",
                        (restore_database, rpo, rto, completed, completed, drill["id"]),
                    )
                    self._audit(cursor, drill["company_id"], drill.get("created_by"), "operational-backup-worker", "operational_restore_drill", drill["id"], "operations.restore.completed", f"rpo={rpo},rto={rto}")
                connection.commit()
        except Exception as exc:
            self._fail_job("operational_restore_drills", drill, "RESTORE_DRILL_FAILED", exc)

    def _expire_backups(self) -> None:
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM operational_backup_jobs WHERE status='completed' AND expires_at<%s", (now,))
                for row in cursor.fetchall():
                    try:
                        self._checked_artifact_path(row["artifact_path"], row["company_id"]).unlink(missing_ok=True)
                    except (OSError, ValueError):
                        continue
                    cursor.execute("UPDATE operational_backup_jobs SET status='expired',updated_at=%s WHERE id=%s", (now, row["id"]))
            connection.commit()

    def _fail_job(self, table: str, job, code: str, exc: Exception) -> None:
        now = datetime.now(UTC)
        message = str(exc).replace(settings.postgres_password, "***")[:500]
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"UPDATE {table} SET status='failed',error_code=%s,error_message=%s,completed_at=%s,updated_at=%s WHERE id=%s", (code, message, now, now, job["id"]))
                self._audit(cursor, job["company_id"], job.get("created_by"), "operational-backup-worker", table[:-1], job["id"], "operations.job.failed", code)
            connection.commit()

    def _policy(self, cursor, company_id: str):
        cursor.execute("SELECT * FROM operational_backup_policies WHERE company_id=%s", (company_id,))
        row = cursor.fetchone()
        if row:
            return row
        return {"company_id": company_id, "enabled": False, "interval_hours": 24, "retention_days": 30,
                "encryption_required": True, "storage_path": str(settings.operational_backup_root_path),
                "last_scheduled_at": None, "next_scheduled_at": None, "updated_at": None}

    @staticmethod
    def _policy_view(row) -> dict:
        return {"enabled": bool(row["enabled"]), "intervalHours": row["interval_hours"], "retentionDays": row["retention_days"],
                "encryptionRequired": True, "storageMode": "managed_local", "lastScheduledAt": row.get("last_scheduled_at"),
                "nextScheduledAt": row.get("next_scheduled_at"), "updatedAt": row.get("updated_at")}

    @staticmethod
    def _backup_view(row) -> dict:
        return {"backupId": row["id"], "triggerType": row["trigger_type"], "status": row["status"],
                "artifactSha256": row.get("artifact_sha256"), "sizeBytes": row.get("size_bytes"), "snapshotAt": row.get("snapshot_at"),
                "completedAt": row.get("completed_at"), "expiresAt": row.get("expires_at"), "errorCode": row.get("error_code"),
                "errorMessage": row.get("error_message"), "createdAt": row["created_at"]}

    @staticmethod
    def _drill_view(row) -> dict:
        return {"drillId": row["id"], "backupId": row["backup_job_id"], "status": row["status"],
                "checksumVerified": bool(row.get("checksum_verified")), "rpoSeconds": row.get("rpo_seconds"),
                "rtoSeconds": row.get("rto_seconds"), "completedAt": row.get("completed_at"), "errorCode": row.get("error_code"),
                "errorMessage": row.get("error_message"), "createdAt": row["created_at"]}

    def _company_backup_root(self, company_id: str) -> Path:
        slug = hashlib.sha256(company_id.encode("utf-8")).hexdigest()[:24]
        return settings.operational_backup_root_path / slug

    def _checked_artifact_path(self, raw_path: str, company_id: str) -> Path:
        path = Path(raw_path).resolve()
        root = self._company_backup_root(company_id).resolve()
        if root not in path.parents:
            raise ValueError("백업 artifact가 관리 저장소 경계를 벗어났습니다.")
        return path

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _audit(cursor, company_id, actor_id, actor_name, target_type, target_id, event, after) -> None:
        cursor.execute(
            """INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
            status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s)""",
            (f"audit_{uuid4().hex}", company_id, actor_id, actor_name, target_type, target_id, event, after, "운영 백업·복구", datetime.now(UTC)),
        )
