from __future__ import annotations

import unittest
from collections import Counter
from datetime import UTC, datetime, timedelta
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import zipfile

from pydantic import ValidationError

from app.schemas.mail_messenger import (
    MailBackupCreateRequest,
    MailBackupJobListResponse,
    MailBackupJobView,
    MailMailboxEmptyRequest,
    MailMailboxPolicyUpdateRequest,
    MailStorageResponse,
)
from app.services.mailbox_settings_service import (
    MailboxCountConflictError,
    MailboxSettingsConflictError,
    MailboxSettingsService,
)
from app.services.mailbox_backup_archive import MailboxBackupArchive
from app.services.mailbox_backup_service import MailboxBackupService
from app.services.mailbox_scope import MailboxScope
from app.workers.mail_backup_worker import run_worker_iteration
from test_ui016_mail_list import FakeDb


class Ui024MigrationContractTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_owner_scoped_policy_and_durable_backup_queue(self):
        sql = (self.root / "migrations" / "028_mailbox_settings.sql").read_text(
            encoding="utf-8"
        ).lower()
        self.assertIn("create table if not exists user_mailbox_policies", sql)
        self.assertIn("create table if not exists mailbox_backup_jobs", sql)
        self.assertIn("create table if not exists mailbox_backup_job_items", sql)
        self.assertIn("where status in ('queued', 'running')", sql)
        self.assertIn("foreign key (folder_id, company_id, user_id)", sql)
        self.assertIn("on delete set null (folder_id)", sql)

    def test_mailbox_key_parser_rejects_unowned_shapes(self):
        self.assertEqual(MailboxScope.parse("system:inbox").mailbox_type, "inbox")
        self.assertEqual(
            MailboxScope.parse("folder:folder_123").folder_id,
            "folder_123",
        )
        for value in ("folder:", "system:all", "../trash", "folder:folder/1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                MailboxScope.parse(value)


class Ui024SchemaContractTests(unittest.TestCase):
    def test_policy_accepts_only_editable_retention_values(self):
        for value in (None, 30, 90, 180, 365):
            payload = MailMailboxPolicyUpdateRequest(
                retentionDays=value,
                expectedVersion=1,
            )
            self.assertEqual(payload.retentionDays, value)

        for value in (0, 29, 31, 366):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MailMailboxPolicyUpdateRequest(
                    retentionDays=value,
                    expectedVersion=1,
                )

    def test_empty_and_backup_requests_do_not_accept_actor_identity(self):
        empty = MailMailboxEmptyRequest(
            expectedCount=0,
            confirmPermanent=False,
        )
        backup = MailBackupCreateRequest(mailboxKey="system:inbox")
        self.assertEqual(empty.expectedCount, 0)
        self.assertEqual(backup.mailboxKey, "system:inbox")
        self.assertFalse(hasattr(empty, "userId"))
        self.assertFalse(hasattr(backup, "companyId"))


class Ui024MailboxSettingsServiceTests(unittest.TestCase):
    root = Path(__file__).parent

    @staticmethod
    def actor():
        return SimpleNamespace(
            companyId="company-a",
            userId="user-a",
            userEmail="user@example.test",
            userName="사용자",
        )

    def test_fixed_retention_policy_is_rejected_before_database_access(self):
        service = MailboxSettingsService()
        service.db = FakeDb()

        with self.assertRaises(ValueError):
            service.update_policy(
                self.actor(),
                MailboxScope.parse("system:trash"),
                MailMailboxPolicyUpdateRequest(
                    retentionDays=30,
                    expectedVersion=1,
                ),
            )

        self.assertEqual(service.db.connect_count, 0)

    def test_policy_version_conflict_does_not_commit(self):
        service = MailboxSettingsService()
        service.db = FakeDb(fetchone=[{"id": "policy-1", "version": 2}])

        with self.assertRaises(MailboxSettingsConflictError):
            service.update_policy(
                self.actor(),
                MailboxScope.parse("system:inbox"),
                MailMailboxPolicyUpdateRequest(
                    retentionDays=90,
                    expectedVersion=1,
                ),
            )

        self.assertEqual(service.db.connection.commit_count, 0)

    def test_trash_empty_requires_permanent_confirmation_without_db_access(self):
        service = MailboxSettingsService()
        service.db = FakeDb()

        with self.assertRaises(ValueError):
            service.empty_mailbox(
                self.actor(),
                MailboxScope.parse("system:trash"),
                MailMailboxEmptyRequest(
                    expectedCount=2,
                    confirmPermanent=False,
                ),
            )

        self.assertEqual(service.db.connect_count, 0)

    def test_empty_count_conflict_does_not_update_or_commit(self):
        service = MailboxSettingsService()
        service.db = FakeDb(
            fetchall=[[{"view_id": "recipient-a"}, {"view_id": "recipient-b"}]]
        )

        with self.assertRaises(MailboxCountConflictError):
            service.empty_mailbox(
                self.actor(),
                MailboxScope.parse("system:inbox"),
                MailMailboxEmptyRequest(
                    expectedCount=1,
                    confirmPermanent=False,
                ),
            )

        statements = [
            statement.upper()
            for statement, _ in service.db.cursor_instance.executions
        ]
        self.assertFalse(any(statement.startswith("UPDATE ") for statement in statements))
        self.assertEqual(service.db.connection.commit_count, 0)

    def test_service_source_keeps_shared_data_and_uses_required_sql_boundaries(self):
        source = (
            self.root / "app" / "services" / "mailbox_settings_service.py"
        ).read_text(encoding="utf-8")
        normalized = source.lower()
        self.assertIn("octet_length(coalesce(m.subject", normalized)
        self.assertIn("pg_try_advisory_lock", normalized)
        self.assertIn("limit %s", normalized)
        self.assertIn("update mail_recipients", normalized)
        self.assertIn("update mail_messages", normalized)
        self.assertIn("status = case when %s then 'cancelled'", normalized)
        self.assertNotIn("where false", normalized)
        self.assertNotIn("delete from mail_messages", normalized)
        self.assertNotIn("delete from mail_attachments", normalized)

    def test_overview_queries_bind_all_values_and_owner_scope_folders(self):
        service = MailboxSettingsService()
        service.db = FakeDb(fetchall=[[], []])
        service.mail = SimpleNamespace(
            get_mail_storage=lambda _actor: MailStorageResponse(
                usedBytes=0,
                quotaBytes=1,
                usagePercent=0,
            ),
            list_tags=lambda _actor: SimpleNamespace(tags=[]),
        )
        service.backup = SimpleNamespace(
            list_jobs=lambda _actor: MailBackupJobListResponse(
                jobs=[
                    MailBackupJobView(
                        jobId="job-1",
                        mailboxKey="system:inbox",
                        mailboxLabel="받은편지함",
                        status="queued",
                        totalCount=0,
                        processedCount=0,
                        artifactSizeBytes=0,
                        errorCode=None,
                        expiresAt=None,
                    )
                ]
            )
        )

        response = service.get_settings(self.actor())
        self.assertEqual(response.backupJobs[0].jobId, "job-1")

        executions = service.db.cursor_instance.executions
        for sql, params in executions[:2]:
            with self.subTest(sql=sql[:80]):
                self.assertEqual(sql.count("%s"), len(params))
        folder_sql = executions[1][0].lower()
        self.assertIn(
            "where f.company_id = %s and f.user_id = %s",
            folder_sql,
        )

    def test_overview_and_empty_use_existing_recipient_visibility_semantics(self):
        service = MailboxSettingsService()
        system_sql = " ".join(service._system_overview_sql().lower().split())
        folder_sql = " ".join(service._folder_overview_sql().lower().split())

        for sql in (system_sql, folder_sql):
            self.assertIn("mr.recipient_user_id = %s", sql)
            self.assertIn("or lower(mr.recipient_email) = %s", sql)
            self.assertIn("m.status = 'sent'", sql)
        self.assertIn("mr.deleted_at is not null", system_sql)
        self.assertIn("or mr.is_spam", system_sql)
        self.assertIn("or mr.folder_id is null", system_sql)
        self.assertIn("m.sender_copy_saved = true", system_sql)

        service.db = FakeDb(fetchall=[[]])
        service._lock_current_views(
            service.db.cursor_instance,
            self.actor(),
            MailboxScope.parse("system:inbox"),
        )
        lock_sql, lock_params = service.db.cursor_instance.executions[-1]
        normalized_lock = " ".join(lock_sql.lower().split())
        self.assertIn("mr.recipient_user_id = %s", normalized_lock)
        self.assertIn("or lower(mr.recipient_email) = %s", normalized_lock)
        self.assertIn("m.status = 'sent'", normalized_lock)
        self.assertEqual(
            lock_params,
            ("company-a", "user-a", "user@example.test"),
        )

    def test_folder_origin_spam_and_trash_are_not_hidden_from_system_rows(self):
        sql = " ".join(
            MailboxSettingsService._system_overview_sql().lower().split()
        )
        deleted_case = sql.index("when mr.deleted_at is not null")
        spam_case = sql.index("when mr.is_spam")
        self.assertLess(deleted_case, spam_case)
        self.assertIn("mr.deleted_at is not null", sql)
        self.assertIn("or mr.is_spam", sql)
        self.assertIn("or mr.folder_id is null", sql)

    def test_actor_view_sql_normalizes_duplicate_recipients_for_overview_and_snapshot(self):
        overview_sql = " ".join(
            MailboxSettingsService._system_overview_sql().lower().split()
        )
        snapshot_sql = " ".join(
            MailboxBackupService._snapshot_items_sql("inbox").lower().split()
        )

        self.assertIn("raw_actor_views as", overview_sql)
        self.assertIn(
            "group by mailbox_key, message_id, view_type",
            overview_sql,
        )
        self.assertIn(
            "partition by j.id, mr.message_id",
            snapshot_sql,
        )
        self.assertIn("actor_view_rank = 1", snapshot_sql)

    def test_empty_counts_logical_view_once_and_updates_all_duplicate_rows(self):
        service = MailboxSettingsService()
        service.db = FakeDb(
            fetchall=[[
                {
                    "view_id": "recipient-a",
                    "message_id": "mail-1",
                    "view_type": "recipient",
                },
                {
                    "view_id": "recipient-b",
                    "message_id": "mail-1",
                    "view_type": "recipient",
                },
            ]]
        )

        result = service.empty_mailbox(
            self.actor(),
            MailboxScope.parse("system:inbox"),
            MailMailboxEmptyRequest(
                expectedCount=1,
                confirmPermanent=False,
            ),
        )

        self.assertEqual(result.changedCount, 1)
        update = next(
            (sql, params)
            for sql, params in service.db.cursor_instance.executions
            if "UPDATE mail_recipients" in sql
        )
        self.assertEqual(
            update[1][2],
            ["recipient-a", "recipient-b"],
        )

    def test_folder_overview_filters_sent_before_unread_and_deduplicates(self):
        sql = " ".join(
            MailboxSettingsService._folder_overview_sql().lower().split()
        )

        self.assertIn("folder_actor_views as", sql)
        self.assertIn("join mail_messages m", sql)
        self.assertIn("and m.status = 'sent'", sql)
        self.assertIn("group by mr.folder_id, m.id", sql)
        self.assertIn(
            "count(*) filter (where v.is_read = false)",
            sql,
        )
        self.assertNotIn(
            "count(*) filter (where mr.is_read = false)",
            sql,
        )

    def test_retention_resolves_email_owner_and_counts_only_revalidated_updates(self):
        service = MailboxSettingsService()
        candidate_sql = " ".join(
            service._retention_candidates_sql().lower().split()
        )
        self.assertIn("join users u", candidate_sql)
        self.assertIn("lower(u.email) = lower(mr.recipient_email)", candidate_sql)
        self.assertIn("m.status = 'sent'", candidate_sql)
        self.assertIn("u.id as user_id", candidate_sql)

        candidates = [
            {
                "view_id": "restored-trash",
                "view_type": "recipient",
                "mailbox_key": "system:trash",
                "action": "purge",
                "company_id": "company-a",
                "user_id": "user-a",
            },
            {
                "view_id": "policy-now-unlimited",
                "view_type": "recipient",
                "mailbox_key": "system:inbox",
                "action": "trash",
                "company_id": "company-a",
                "user_id": "user-a",
            },
            {
                "view_id": "moved-folder",
                "view_type": "recipient",
                "mailbox_key": "folder:folder_1",
                "action": "trash",
                "company_id": "company-a",
                "user_id": "user-a",
            },
            {
                "view_id": "sent-copy-disabled",
                "view_type": "sender",
                "mailbox_key": "system:sent",
                "action": "trash",
                "company_id": "company-a",
                "user_id": "user-a",
            },
        ]
        db = FakeDb(fetchall=[[], [], [], []])
        changed = service._apply_retention_candidates(
            db.cursor_instance,
            candidates,
            datetime(2026, 7, 23, tzinfo=UTC),
        )

        self.assertEqual(changed, Counter())
        update_sql = " ".join(
            sql.lower()
            for sql, _params in db.cursor_instance.executions
            if sql.strip().lower().startswith("update")
        )
        self.assertGreaterEqual(update_sql.count("returning"), 4)
        self.assertIn("retention_days is not null", update_sql)
        self.assertIn("mr.folder_id = %s", update_sql)
        self.assertIn("mr.deleted_at < now() - interval '30 days'", update_sql)
        self.assertIn("m.sender_copy_saved = true", update_sql)


class Ui024MailboxBackupTests(unittest.TestCase):
    @staticmethod
    def job():
        return {
            "id": "backup_1",
            "company_id": "company-a",
            "user_id": "user-a",
            "mailbox_key": "system:inbox",
            "mailbox_label": "받은편지함",
            "snapshot_at": datetime(2026, 7, 23, 0, 0, tzinfo=UTC),
        }

    @staticmethod
    def item(storage_key: str | None = None):
        attachments = []
        if storage_key:
            attachments.append(
                {
                    "file_name": "증빙?.txt",
                    "content_type": "text/plain",
                    "storage_key": storage_key,
                    "size_bytes": 12,
                }
            )
        return {
            "ordinal": 1,
            "message_id": "mail-1",
            "view_type": "recipient",
            "sender_email": "sender@example.test",
            "to": ["user@example.test"],
            "cc": [],
            "bcc": ["hidden@example.test"],
            "subject": "분기/보고: 1",
            "body_text": "본문",
            "body_html": "<p>본문</p>",
            "sent_at": datetime(2026, 7, 22, 1, 2, tzinfo=UTC),
            "attachments": attachments,
        }

    def test_recipient_archive_omits_bcc_and_streams_utf8_attachment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            attachment = root / "attachment.bin"
            attachment.write_bytes(b"evidence-123")
            archive = MailboxBackupArchive(
                attachment_resolver=lambda _key: attachment
            )
            output = root / "result.zip"

            result = archive.build(
                self.job(),
                [self.item("mail/uploads/a.bin")],
                output,
            )

            self.assertEqual(result.processed_count, 1)
            self.assertTrue(output.is_file())
            self.assertFalse((root / "result.zip.part").exists())
            with zipfile.ZipFile(output) as zipped:
                names = zipped.namelist()
                self.assertEqual(names[0], "manifest.json")
                eml_name = next(name for name in names if name.endswith(".eml"))
                self.assertNotIn("/", eml_name.removeprefix("messages/"))
                message = BytesParser(policy=policy.default).parsebytes(
                    zipped.read(eml_name)
                )
                self.assertEqual(message["Subject"], "분기/보고: 1")
                self.assertIsNone(message["Bcc"])
                self.assertNotIn(
                    b"hidden@example.test",
                    zipped.read(eml_name),
                )
                attachments = list(message.iter_attachments())
                self.assertEqual(len(attachments), 1)
                self.assertEqual(
                    attachments[0].get_payload(decode=True),
                    b"evidence-123",
                )

    def test_archive_streams_single_pass_items_and_wraps_attachment_base64(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            attachment = root / "large.bin"
            attachment.write_bytes(b"x" * (58 * 1024))
            archive = MailboxBackupArchive(
                attachment_resolver=lambda _key: attachment
            )
            events: list[int] = []
            first = self.item("mail/uploads/large.bin")
            first["attachments"][0]["size_bytes"] = attachment.stat().st_size
            second = {**self.item(), "ordinal": 2, "message_id": "mail-2"}

            def single_pass_items():
                yield first
                self.assertTrue(events, "첫 item 처리 전에 전체 iterable을 복제했습니다.")
                yield second

            output = root / "streamed.zip"
            result = archive.build(
                self.job(),
                single_pass_items(),
                output,
                manifest_count=2,
                manifest_total_bytes=1234,
                progress_callback=lambda processed: events.append(processed) or True,
            )

            self.assertEqual(result.processed_count, 2)
            self.assertGreaterEqual(events.count(0), 2)
            with zipfile.ZipFile(output) as zipped:
                manifest = json.loads(zipped.read("manifest.json"))
                self.assertEqual(manifest["messageCount"], 2)
                self.assertEqual(manifest["totalBytes"], 1234)
                first_eml = zipped.read(
                    next(
                        name
                        for name in zipped.namelist()
                        if name.startswith("messages/000001-")
                    )
                )
            attachment_body = first_eml.split(
                b"Content-Disposition: attachment;",
                1,
            )[1].split(b"\r\n\r\n", 1)[1]
            attachment_body = attachment_body.split(
                b"\r\n--moaworks-mixed-",
                1,
            )[0]
            encoded_lines = [
                line for line in attachment_body.split(b"\r\n") if line
            ]
            self.assertTrue(encoded_lines)
            self.assertLessEqual(max(map(len, encoded_lines)), 76)

    def test_empty_archive_contains_only_manifest_and_atomic_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "empty.zip"
            result = MailboxBackupArchive(
                attachment_resolver=lambda _key: Path("missing")
            ).build(self.job(), [], output)
            self.assertEqual(result.processed_count, 0)
            with zipfile.ZipFile(output) as zipped:
                self.assertEqual(zipped.namelist(), ["manifest.json"])
                manifest = json.loads(zipped.read("manifest.json"))
                self.assertEqual(manifest["messageCount"], 0)
            self.assertFalse(output.with_suffix(".zip.part").exists())

    def test_artifact_path_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            service = MailboxBackupService(storage_root=Path(directory))
            with self.assertRaises(ValueError):
                service.artifact_path("../outside.zip")

    def test_queue_and_worker_sources_have_durable_retry_contract(self):
        service_source = (
            Path(__file__).parent
            / "app"
            / "services"
            / "mailbox_backup_service.py"
        ).read_text(encoding="utf-8")
        worker_source = (
            Path(__file__).parent / "app" / "workers" / "mail_backup_worker.py"
        ).read_text(encoding="utf-8")
        self.assertIn("FOR UPDATE SKIP LOCKED", service_source)
        self.assertIn("lease_expires_at < %s", service_source)
        self.assertIn("attempt_count", service_source)
        self.assertIn("attempt_count >= 3", service_source)
        self.assertIn("expires_at", service_source)
        self.assertIn("DELETE FROM mailbox_backup_job_items", service_source)
        self.assertIn("mailbox_backup_job_items", service_source)
        self.assertNotIn("or not self._has_items", service_source)
        self.assertIn("BACKUP_INTERNAL_FAILED", worker_source)
        self.assertNotIn("mail_provider_configs", service_source)
        self.assertNotIn("delivery_enabled", worker_source)
        self.assertIn("def _iter_job_items", service_source)
        self.assertIn("limit %s", service_source.lower())
        self.assertNotIn("def _load_job_items", service_source)

    def test_snapshot_sql_binds_every_mailbox_scope(self):
        service = MailboxBackupService()
        for mailbox_type, folder_id in (
            ("inbox", None),
            ("sent", None),
            ("draft", None),
            ("scheduled", None),
            ("spam", None),
            ("trash", None),
            ("folder", "folder_1"),
        ):
            job = {
                "id": "job-1",
                "company_id": "company-a",
                "user_id": "user-a",
                "mailbox_type": mailbox_type,
                "folder_id": folder_id,
            }
            sql = service._snapshot_items_sql(mailbox_type)
            params = service._snapshot_params(job)
            with self.subTest(mailbox_type=mailbox_type):
                self.assertEqual(sql.count("%s"), len(params))

    def test_snapshot_uses_owner_email_sent_status_and_sender_copy_boundary(self):
        service = MailboxBackupService()
        for mailbox_type in ("inbox", "spam", "folder", "trash"):
            sql = " ".join(
                service._snapshot_items_sql(mailbox_type).lower().split()
            )
            with self.subTest(mailbox_type=mailbox_type):
                self.assertIn("lower(mr.recipient_email)", sql)
                self.assertIn("m.status = 'sent'", sql)
        sent_sql = " ".join(
            service._snapshot_items_sql("sent").lower().split()
        )
        self.assertIn("m.sender_copy_saved = true", sent_sql)

    def test_worker_iteration_expires_when_idle_and_sanitizes_failure(self):
        class FakeWorkerService:
            def __init__(self):
                self.expired = False
                self.failed = []

            def claim_next(self, _worker_id):
                return None

            def expire_artifacts(self):
                self.expired = True

        idle = FakeWorkerService()
        self.assertFalse(run_worker_iteration(idle, "worker-1"))
        self.assertTrue(idle.expired)

    def test_claim_terminalizes_expired_third_attempt_before_selecting_work(self):
        expired = {
            "id": "job-third",
            "company_id": "company-a",
            "user_id": "user-a",
            "mailbox_type": "inbox",
            "folder_id": None,
            "attempt_count": 3,
        }
        service = MailboxBackupService()
        service.db = FakeDb(fetchone=[None], fetchall=[[expired]])

        self.assertIsNone(service.claim_next("worker-new"))

        sql = " ".join(
            statement.lower()
            for statement, _params in service.db.cursor_instance.executions
        )
        self.assertIn("attempt_count >= 3", sql)
        self.assertIn("status = 'failed'", sql)
        self.assertIn("lease_owner = null", sql)
        self.assertLess(
            sql.index("attempt_count >= 3"),
            sql.index("for update skip locked"),
        )
        self.assertEqual(service.db.connection.commit_count, 1)

    def test_attempt_temp_is_unique_and_stale_finalizer_preserves_final(self):
        with tempfile.TemporaryDirectory() as directory:
            service = MailboxBackupService(storage_root=Path(directory))
            job = {
                "id": "job-1",
                "company_id": "company-a",
                "user_id": "user-a",
                "mailbox_type": "inbox",
                "attempt_count": 2,
            }
            first = service.attempt_temp_path(job, "worker-a")
            second = service.attempt_temp_path(job, "worker-b")
            self.assertNotEqual(first, second)
            self.assertTrue(first.name.endswith(".part"))

            artifact_key = "mail/backups/company-a/user-a/job-1.zip"
            final_path = service.artifact_path(artifact_key)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            final_path.write_bytes(b"new-owner-final")
            first.write_bytes(b"stale-temp")
            service.db = FakeDb(fetchone=[None])
            result = SimpleNamespace(
                processed_count=1,
                artifact_key=artifact_key,
                size_bytes=len(b"stale-temp"),
                temp_path=first,
            )

            self.assertFalse(service.complete_job("worker-a", job, result))
            self.assertEqual(final_path.read_bytes(), b"new-owner-final")
            self.assertFalse(first.exists())

    def test_complete_renames_only_owned_temp_and_lost_heartbeat_cleans_temp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = MailboxBackupService(storage_root=root)
            job = {
                "id": "job-owned",
                "company_id": "company-a",
                "user_id": "user-a",
                "mailbox_type": "inbox",
                "folder_id": None,
                "attempt_count": 1,
            }
            artifact_key = "mail/backups/company-a/user-a/job-owned.zip"
            temp_path = service.attempt_temp_path(job, "worker-owner")
            temp_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path.write_bytes(b"owned-temp")
            owned = {**job, "status": "running"}
            completed = {
                **job,
                "status": "completed",
                "mailbox_label": "받은편지함",
            }
            service.db = FakeDb(fetchone=[owned, completed])
            result = SimpleNamespace(
                processed_count=1,
                artifact_key=artifact_key,
                size_bytes=len(b"owned-temp"),
                temp_path=temp_path,
            )

            self.assertTrue(
                service.complete_job("worker-owner", job, result)
            )
            self.assertEqual(
                service.artifact_path(artifact_key).read_bytes(),
                b"owned-temp",
            )
            self.assertFalse(temp_path.exists())

            lost_output = root / "lost.zip"
            lost_temp = root / "lost.unique.part"
            with self.assertRaises(RuntimeError):
                MailboxBackupArchive(
                    attachment_resolver=lambda _key: root / "missing"
                ).build(
                    self.job(),
                    [self.item()],
                    lost_output,
                    temp_path=lost_temp,
                    manifest_count=1,
                    manifest_total_bytes=1,
                    progress_callback=lambda _processed: False,
                )
            self.assertFalse(lost_temp.exists())
            self.assertFalse(lost_output.exists())

    def test_expiry_cleanup_removes_all_attempt_temp_files_for_job(self):
        with tempfile.TemporaryDirectory() as directory:
            service = MailboxBackupService(storage_root=Path(directory))
            job = {
                "id": "job-expired",
                "company_id": "company-a",
                "user_id": "user-a",
                "attempt_count": 2,
            }
            temps = [
                service.attempt_temp_path(job, "worker-a"),
                service.attempt_temp_path(job, "worker-b"),
            ]
            for temp_path in temps:
                temp_path.parent.mkdir(parents=True, exist_ok=True)
                temp_path.write_bytes(b"partial")

            service._cleanup_part(job)

            self.assertFalse(any(path.exists() for path in temps))

    def test_heartbeat_is_owner_conditional_and_worker_runs_ttl_with_queue(self):
        service = MailboxBackupService()
        service.db = FakeDb(fetchone=[None])
        self.assertFalse(service.heartbeat("worker-stale", "job-1", 7))
        heartbeat_sql = " ".join(
            service.db.cursor_instance.executions[0][0].lower().split()
        )
        self.assertIn("lease_owner = %s", heartbeat_sql)
        self.assertIn("lease_expires_at > %s", heartbeat_sql)
        self.assertIn("processed_count = greatest", heartbeat_sql)

        class BusyWorkerService:
            def __init__(self):
                self.expire_count = 0

            def expire_artifacts(self):
                self.expire_count += 1

            def claim_next(self, worker_id):
                return {
                    "id": "job-1",
                    "lease_owner": worker_id,
                    "attempt_count": 1,
                }

            def build_claimed(self, job, worker_id):
                return SimpleNamespace(processed_count=0)

            def complete_job(self, worker_id, job, result):
                return True

            def fail_job(self, worker_id, job, error_code):
                raise AssertionError(error_code)

        busy = BusyWorkerService()
        self.assertTrue(run_worker_iteration(busy, "worker-live"))
        self.assertEqual(busy.expire_count, 1)

    def test_large_attachment_heartbeat_is_monotonic_throttled_and_forced_at_boundaries(self):
        class FakeMonotonic:
            def __init__(self):
                self.value = 0.0

            def __call__(self):
                current = self.value
                self.value += 0.1
                return current

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            attachment = root / "large.bin"
            with attachment.open("wb") as stream:
                stream.truncate(25 * 1024 * 1024)

            clock = FakeMonotonic()
            service = MailboxBackupService(
                storage_root=root,
                monotonic_clock=clock,
            )
            service.archive = MailboxBackupArchive(
                attachment_resolver=lambda _key: attachment
            )
            job = {
                **self.job(),
                "attempt_count": 1,
                "total_count": 1,
            }
            item = self.item()
            item["attachments"] = [{
                "storage_key": "large",
                "file_name": "large.bin",
                "content_type": "application/octet-stream",
                "size_bytes": 25 * 1024 * 1024,
            }]
            service._snapshot_totals = lambda _job: (1, 25 * 1024 * 1024)
            service._iter_job_items = lambda _job: iter([item])
            heartbeats = []
            service.heartbeat = lambda _worker, _job, processed: (
                heartbeats.append(processed) or True
            )

            result = service.build_claimed(job, "worker-owner")

            self.assertEqual(result.processed_count, 1)
            self.assertEqual(heartbeats[-2:], [1, 1])
            self.assertIn(0, heartbeats)
            self.assertLess(len(heartbeats), 10)


class Ui024ApiDeploymentContractTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_count_conflict_response_and_client_keep_current_count(self):
        from fastapi import HTTPException
        from app.api.routes import mail

        with self.assertRaises(HTTPException) as caught:
            mail._handle_error(MailboxCountConflictError(7))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["currentCount"], 7)

        api_source = (
            self.root.parent / "frontend" / "user-web" / "src" / "api.ts"
        ).read_text(encoding="utf-8")
        app_source = (
            self.root.parent / "frontend" / "user-web" / "src" / "App.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("currentCount: number | null", api_source)
        self.assertIn("source.currentCount", api_source)
        self.assertIn("error.currentCount", app_source)
        conflict_branch = app_source[
            app_source.index("async function runEmptyMailbox"):
            app_source.index("async function startMailboxBackup")
        ]
        self.assertIn("loadMailboxSettings(token, false)", conflict_branch)

    def test_mailbox_settings_table_has_accessible_caption_and_real_help_text(self):
        app_source = (
            self.root.parent / "frontend" / "user-web" / "src" / "App.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("<caption>", app_source)
        self.assertIn("보관기간이 지난 메일은", app_source)
        self.assertIn("사용량은 사용자 보기 기준", app_source)

    def test_api_routes_precede_dynamic_mail_route_and_use_read_permission(self):
        source = (
            self.root / "app" / "api" / "routes" / "mail.py"
        ).read_text(encoding="utf-8")
        first_dynamic = source.index('@router.post("/{mail_id}/category"')
        for marker in (
            '@router.get("/mailbox-settings"',
            '@router.patch("/mailbox-settings/{mailbox_key}"',
            '@router.post("/mailbox-settings/{mailbox_key}/empty"',
            '@router.post("/mailbox-backups"',
            '@router.get("/mailbox-backups"',
            '@router.post("/mailbox-backups/{job_id}/retry"',
            '@router.get("/mailbox-backups/{job_id}/download")',
        ):
            with self.subTest(marker=marker):
                self.assertLess(source.index(marker), first_dynamic)
        ui024_source = source[
            source.index('@router.get("/mailbox-settings"'):first_dynamic
        ]
        self.assertGreaterEqual(
            ui024_source.count('permission_required("mail:read")'),
            7,
        )
        self.assertIn("FileResponse(", ui024_source)

    def test_typed_settings_and_compose_workers_are_production_bounded(self):
        config = (
            self.root / "app" / "core" / "config.py"
        ).read_text(encoding="utf-8")
        compose = (
            self.root.parent / "deploy" / "docker-compose.oracle.yml"
        ).read_text(encoding="utf-8")
        for marker in (
            "mail_backup_poll_seconds: int = 5",
            "mail_backup_lease_minutes: int = 10",
            "mail_backup_ttl_hours: int = 24",
            "mail_retention_poll_seconds: int = 60",
            "mail_retention_batch_size: int = 500",
        ):
            self.assertIn(marker, config)
        for service, module in (
            ("mail-backup-worker:", "app.workers.mail_backup_worker"),
            ("mail-retention-worker:", "app.workers.mail_retention_worker"),
        ):
            self.assertIn(service, compose)
            self.assertIn(module, compose)
        self.assertGreaterEqual(compose.count("../data:/app/data"), 3)
        worker_section = compose[compose.index("mail-backup-worker:"):]
        self.assertNotIn("MAIL_DELIVERY_ENABLED", worker_section)
        self.assertNotIn("delivery_enabled", worker_section.lower())


if __name__ == "__main__":
    unittest.main()
