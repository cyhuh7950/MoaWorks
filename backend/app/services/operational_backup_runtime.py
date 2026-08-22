from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Any
import zipfile

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


@dataclass(frozen=True)
class BackupArchiveResult:
    artifact_path: Path
    artifact_sha256: str
    size_bytes: int
    file_count: int


@dataclass(frozen=True)
class BackupVerificationResult:
    valid: bool
    failed_files: tuple[str, ...]
    file_count: int


class BackupArchiveEngine:
    """DB dump와 운영 파일을 하나의 검증 가능한 snapshot으로 묶는다."""

    def create_archive(
        self,
        *,
        output_path: Path,
        database_dump: Path,
        storage_root: Path,
        runtime_root: Path,
        metadata: dict[str, Any],
    ) -> BackupArchiveResult:
        if not database_dump.is_file():
            raise FileNotFoundError("PostgreSQL 백업 파일이 없습니다.")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        members: list[tuple[Path, str, str]] = []
        self._append_member(members, database_dump, "database/database.dump")
        self._append_tree(members, storage_root, "storage")
        self._append_tree(members, runtime_root, "runtime")
        manifest = {
            "schemaVersion": "1.0",
            **metadata,
            "components": ["database", "storage", "runtime"],
            "files": [
                {"path": archive_name, "sha256": digest, "sizeBytes": source.stat().st_size}
                for source, archive_name, digest in members
            ],
        }
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source, archive_name, _ in members:
                archive.write(source, archive_name)
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2))
        return BackupArchiveResult(
            artifact_path=output_path,
            artifact_sha256=self._sha256_file(output_path),
            size_bytes=output_path.stat().st_size,
            file_count=len(members),
        )

    def verify_archive(self, artifact_path: Path) -> BackupVerificationResult:
        failed: list[str] = []
        with zipfile.ZipFile(artifact_path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            declared = manifest.get("files", [])
            for item in declared:
                name = str(item.get("path", ""))
                self._validate_archive_name(name)
                try:
                    content = archive.read(name)
                except KeyError:
                    failed.append(name)
                    continue
                digest = hashlib.sha256(content).hexdigest()
                if digest != item.get("sha256") or len(content) != item.get("sizeBytes"):
                    failed.append(name)
        return BackupVerificationResult(
            valid=not failed,
            failed_files=tuple(failed),
            file_count=len(declared),
        )

    def _append_tree(self, members: list[tuple[Path, str, str]], root: Path, prefix: str) -> None:
        if not root.exists():
            return
        resolved_root = root.resolve()
        for source in sorted(path for path in root.rglob("*") if path.is_file() and not path.is_symlink()):
            resolved_source = source.resolve()
            if resolved_root not in resolved_source.parents:
                raise ValueError("백업 대상 파일이 허용된 경계를 벗어났습니다.")
            relative = source.relative_to(root).as_posix()
            self._append_member(members, source, f"{prefix}/{relative}")

    def _append_member(self, members: list[tuple[Path, str, str]], source: Path, archive_name: str) -> None:
        self._validate_archive_name(archive_name)
        members.append((source, archive_name, self._sha256_file(source)))

    @staticmethod
    def _validate_archive_name(name: str) -> None:
        path = PurePosixPath(name)
        if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
            raise ValueError("백업 archive 경로가 올바르지 않습니다.")

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()


class EncryptedBackupArtifact:
    """큰 snapshot도 메모리에 전부 올리지 않는 AES-256-GCM envelope."""

    MAGIC = b"MOAWORKS-BACKUP-V1\n"
    NONCE_BYTES = 12
    TAG_BYTES = 16

    def __init__(self, secret: str) -> None:
        if len(secret) < 16:
            raise ValueError("백업 암호화 비밀값은 16자 이상이어야 합니다.")
        self.key = hashlib.sha256(secret.encode("utf-8")).digest()

    def encrypt(self, source: Path, destination: Path) -> None:
        nonce = os.urandom(self.NONCE_BYTES)
        encryptor = Cipher(algorithms.AES(self.key), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(self.MAGIC)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as reader, destination.open("wb") as writer:
            writer.write(self.MAGIC)
            writer.write(nonce)
            for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                writer.write(encryptor.update(chunk))
            writer.write(encryptor.finalize())
            writer.write(encryptor.tag)

    def decrypt(self, source: Path, destination: Path) -> None:
        total_size = source.stat().st_size
        header_size = len(self.MAGIC) + self.NONCE_BYTES
        if total_size <= header_size + self.TAG_BYTES:
            raise ValueError("암호화 백업 파일이 손상되었습니다.")
        with source.open("rb") as reader:
            if reader.read(len(self.MAGIC)) != self.MAGIC:
                raise ValueError("지원하지 않는 백업 암호화 형식입니다.")
            nonce = reader.read(self.NONCE_BYTES)
            reader.seek(-self.TAG_BYTES, 2)
            tag = reader.read(self.TAG_BYTES)
            encrypted_size = total_size - header_size - self.TAG_BYTES
            reader.seek(header_size)
            decryptor = Cipher(algorithms.AES(self.key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(self.MAGIC)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("wb") as writer:
                remaining = encrypted_size
                while remaining:
                    chunk = reader.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("암호화 백업 파일이 잘렸습니다.")
                    remaining -= len(chunk)
                    writer.write(decryptor.update(chunk))
                writer.write(decryptor.finalize())


class PostgresBackupRuntime:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        database: str,
        user: str,
        password: str,
        runner=None,
    ) -> None:
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.runner = runner or self._run

    def dump(self, output: Path) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        self.runner(
            [
                "pg_dump",
                "--host", self.host,
                "--port", str(self.port),
                "--username", self.user,
                "--dbname", self.database,
                "--format=custom",
                "--no-owner",
                "--no-acl",
                "--file", str(output),
            ],
            self._environment(),
        )
        if not output.is_file() or output.stat().st_size == 0:
            raise OSError("PostgreSQL 백업 파일이 생성되지 않았습니다.")

    def restore_isolated(self, database_dump: Path, restore_database: str) -> None:
        if not re.fullmatch(r"moaworks_restore_[a-f0-9]{12}", restore_database):
            raise ValueError("격리 복구 데이터베이스 이름이 올바르지 않습니다.")
        quoted = f'"{restore_database}"'
        environment = self._environment()
        self.runner(self._psql_command("CREATE DATABASE " + quoted), environment)
        try:
            self.runner(
                [
                    "pg_restore",
                    "--host", self.host,
                    "--port", str(self.port),
                    "--username", self.user,
                    "--dbname", restore_database,
                    "--no-owner",
                    "--no-acl",
                    "--exit-on-error",
                    str(database_dump),
                ],
                environment,
            )
            self.runner(
                [
                    "psql", "--host", self.host, "--port", str(self.port),
                    "--username", self.user, "--dbname", restore_database,
                    "--set", "ON_ERROR_STOP=1", "--command",
                    "SELECT COUNT(*) FROM schema_migrations; SELECT COUNT(*) FROM companies;",
                ],
                environment,
            )
        finally:
            try:
                self.runner(
                    self._psql_command(
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                        f"WHERE datname = '{restore_database}';"
                    ),
                    environment,
                )
            finally:
                self.runner(
                    self._psql_command(f"DROP DATABASE IF EXISTS {quoted}"),
                    environment,
                )

    def _psql_command(self, sql: str) -> list[str]:
        return [
            "psql", "--host", self.host, "--port", str(self.port),
            "--username", self.user, "--dbname", "postgres",
            "--set", "ON_ERROR_STOP=1", "--command", sql,
        ]

    def _environment(self) -> dict[str, str]:
        return {**os.environ, "PGPASSWORD": self.password}

    @staticmethod
    def _run(command: list[str], env: dict[str, str]) -> None:
        subprocess.run(command, env=env, check=True, capture_output=True, text=True, timeout=3600)
