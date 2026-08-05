from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from app.services.operational_backup_runtime import BackupArchiveEngine, EncryptedBackupArtifact, PostgresBackupRuntime


ROOT = Path(__file__).resolve().parent


class Stage04OperationalBackupContractTest(unittest.TestCase):
    def test_migration_defines_policy_backup_and_restore_drill_tables(self) -> None:
        sql = (ROOT / "migrations" / "054_operational_backup.sql").read_text(encoding="utf-8").lower()

        self.assertIn("create table if not exists operational_backup_policies", sql)
        self.assertIn("create table if not exists operational_backup_jobs", sql)
        self.assertIn("create table if not exists operational_restore_drills", sql)
        self.assertIn("artifact_sha256", sql)
        self.assertIn("rpo_seconds", sql)
        self.assertIn("rto_seconds", sql)

    def test_server_image_includes_postgres_backup_runtime(self) -> None:
        dockerfile = (ROOT.parent / "deploy" / "server.Dockerfile").read_text(encoding="utf-8").lower()
        self.assertIn("postgresql-client", dockerfile)

    def test_archive_contains_database_storage_runtime_and_verified_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-") as temp:
            root = Path(temp)
            database_dump = root / "database.dump"
            database_dump.write_bytes(b"postgres-custom-dump")
            storage = root / "storage"
            storage.mkdir()
            (storage / "attachment.txt").write_text("attachment", encoding="utf-8")
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "setup-state.json").write_text('{"ready":true}', encoding="utf-8")
            output = root / "backup.zip"

            result = BackupArchiveEngine().create_archive(
                output_path=output,
                database_dump=database_dump,
                storage_root=storage,
                runtime_root=runtime,
                metadata={"backupId": "backup-test", "createdAt": "2026-08-05T00:00:00+00:00"},
            )

            self.assertEqual(result.artifact_sha256, hashlib.sha256(output.read_bytes()).hexdigest())
            with zipfile.ZipFile(output) as archive:
                names = set(archive.namelist())
                self.assertIn("database/database.dump", names)
                self.assertIn("storage/attachment.txt", names)
                self.assertIn("runtime/setup-state.json", names)
                manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["schemaVersion"], "1.0")
            self.assertEqual(manifest["backupId"], "backup-test")
            self.assertEqual(set(manifest["components"]), {"database", "runtime", "storage"})
            self.assertTrue(BackupArchiveEngine().verify_archive(output).valid)

    def test_verify_archive_detects_tampered_member(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-") as temp:
            root = Path(temp)
            database_dump = root / "database.dump"
            database_dump.write_bytes(b"original")
            storage = root / "storage"
            runtime = root / "runtime"
            storage.mkdir()
            runtime.mkdir()
            output = root / "backup.zip"
            BackupArchiveEngine().create_archive(
                output_path=output,
                database_dump=database_dump,
                storage_root=storage,
                runtime_root=runtime,
                metadata={"backupId": "backup-tamper", "createdAt": "2026-08-05T00:00:00+00:00"},
            )
            with zipfile.ZipFile(output, "a") as archive:
                archive.writestr("database/database.dump", b"tampered")

            verification = BackupArchiveEngine().verify_archive(output)

            self.assertFalse(verification.valid)
            self.assertIn("database/database.dump", verification.failed_files)

    def test_encrypted_artifact_round_trip_does_not_expose_zip_payload(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-") as temp:
            root = Path(temp)
            source = root / "snapshot.zip"
            source.write_bytes(b"PK secret operational backup payload")
            encrypted = root / "snapshot.mwbackup"
            restored = root / "restored.zip"

            cipher = EncryptedBackupArtifact("stage04-test-secret")
            cipher.encrypt(source, encrypted)
            self.assertNotIn(b"secret operational backup payload", encrypted.read_bytes())
            cipher.decrypt(encrypted, restored)

            self.assertEqual(restored.read_bytes(), source.read_bytes())

    def test_postgres_dump_uses_argument_list_and_password_only_in_environment(self) -> None:
        calls: list[tuple[list[str], dict[str, str]]] = []

        def runner(command: list[str], env: dict[str, str]) -> None:
            calls.append((command, env))
            Path(command[-1]).write_bytes(b"dump")

        runtime = PostgresBackupRuntime(
            host="postgres",
            port=5432,
            database="moaworks",
            user="moaworks",
            password="private-password",
            runner=runner,
        )
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-") as temp:
            output = Path(temp) / "database.dump"
            runtime.dump(output)

        command, env = calls[0]
        self.assertEqual(command[0], "pg_dump")
        self.assertIn("--format=custom", command)
        self.assertNotIn("private-password", command)
        self.assertEqual(env["PGPASSWORD"], "private-password")


if __name__ == "__main__":
    unittest.main()
