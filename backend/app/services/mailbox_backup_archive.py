from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from email.header import Header
from email.utils import format_datetime
import json
import mimetypes
from pathlib import Path
import re
from typing import Callable, Iterable
from urllib.parse import quote
import uuid
import zipfile


@dataclass(frozen=True)
class BackupArtifactResult:
    artifact_key: str
    size_bytes: int
    processed_count: int
    temp_path: Path | None = None


class BackupLeaseLostError(RuntimeError):
    pass


class MailboxBackupArchive:
    FORMAT_VERSION = 1
    ATTACHMENT_CHUNK_BYTES = 57 * 1024

    def __init__(
        self,
        *,
        attachment_resolver: Callable[[str], Path],
    ) -> None:
        self.attachment_resolver = attachment_resolver

    def build(
        self,
        job: dict,
        items: Iterable[dict],
        output_path: Path,
        *,
        temp_path: Path | None = None,
        progress_callback: Callable[[int], bool] | None = None,
        manifest_count: int | None = None,
        manifest_total_bytes: int | None = None,
    ) -> BackupArtifactResult:
        final_path = output_path.resolve()
        final_path.parent.mkdir(parents=True, exist_ok=True)
        part_path = (
            temp_path.resolve()
            if temp_path is not None
            else final_path.with_suffix(final_path.suffix + ".part")
        )
        if manifest_count is None or manifest_total_bytes is None:
            materialized_items = list(items)
            item_iterable: Iterable[dict] = materialized_items
            manifest_count = len(materialized_items)
            manifest_total_bytes = sum(
                self._logical_bytes(item) for item in materialized_items
            )
        else:
            item_iterable = items
        manifest = {
            "mailboxKey": job["mailbox_key"],
            "createdAt": datetime.now(UTC).isoformat(),
            "snapshotAt": self._iso(job.get("snapshot_at")),
            "messageCount": manifest_count,
            "totalBytes": manifest_total_bytes,
            "formatVersion": self.FORMAT_VERSION,
        }
        part_path.unlink(missing_ok=True)
        processed_count = 0
        try:
            with zipfile.ZipFile(
                part_path,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                allowZip64=True,
            ) as archive:
                archive.writestr(
                    "manifest.json",
                    json.dumps(
                        manifest,
                        ensure_ascii=False,
                        sort_keys=True,
                        indent=2,
                    ).encode("utf-8"),
                )
                for processed, item in enumerate(item_iterable, start=1):
                    name = self._message_file_name(item)
                    with archive.open(f"messages/{name}", mode="w") as destination:
                        self._write_eml(
                            destination,
                            item,
                            progress_callback,
                            processed - 1,
                        )
                    if progress_callback and not progress_callback(processed):
                        raise BackupLeaseLostError("백업 lease 소유권을 잃었습니다.")
                    processed_count = processed
            if processed_count != manifest_count:
                raise OSError("백업 snapshot 건수와 생성 건수가 일치하지 않습니다.")
            if temp_path is None:
                part_path.replace(final_path)
        except Exception:
            part_path.unlink(missing_ok=True)
            raise

        artifact_key = (
            f"mail/backups/{job['company_id']}/{job['user_id']}/{job['id']}.zip"
        )
        return BackupArtifactResult(
            artifact_key=artifact_key,
            size_bytes=(
                final_path.stat().st_size
                if temp_path is None
                else part_path.stat().st_size
            ),
            processed_count=processed_count,
            temp_path=part_path if temp_path is not None else None,
        )

    def _write_eml(
        self,
        destination,
        item: dict,
        progress_callback: Callable[[int], bool] | None = None,
        processed_count: int = 0,
    ) -> None:
        mixed_boundary = f"moaworks-mixed-{uuid.uuid4().hex}"
        alternative_boundary = f"moaworks-alt-{uuid.uuid4().hex}"
        headers = [
            ("From", self._address_list([item.get("sender_email", "")])),
            ("To", self._address_list(item.get("to") or [])),
            ("Subject", Header(item.get("subject") or "", "utf-8").encode()),
            ("Date", self._format_date(item.get("sent_at"))),
            (
                "Message-ID",
                f"<{self._safe_message_id(item.get('message_id'))}@moaworks.local>",
            ),
            ("MIME-Version", "1.0"),
        ]
        cc = self._address_list(item.get("cc") or [])
        if cc:
            headers.insert(2, ("Cc", cc))
        if item.get("view_type") == "sender":
            bcc = self._address_list(item.get("bcc") or [])
            if bcc:
                headers.insert(3, ("Bcc", bcc))

        attachments = item.get("attachments") or []
        has_html = bool(item.get("body_html"))
        if attachments:
            headers.append(
                ("Content-Type", f'multipart/mixed; boundary="{mixed_boundary}"')
            )
        elif has_html:
            headers.append(
                (
                    "Content-Type",
                    f'multipart/alternative; boundary="{alternative_boundary}"',
                )
            )
        else:
            headers.extend(
                [
                    ("Content-Type", 'text/plain; charset="utf-8"'),
                    ("Content-Transfer-Encoding", "base64"),
                ]
            )
        self._write_headers(destination, headers)

        if attachments:
            destination.write(f"--{mixed_boundary}\r\n".encode("ascii"))
            if has_html:
                destination.write(
                    (
                        "Content-Type: multipart/alternative; "
                        f'boundary="{alternative_boundary}"\r\n\r\n'
                    ).encode("ascii")
                )
                self._write_alternative(destination, item, alternative_boundary)
            else:
                self._write_text_part(
                    destination,
                    "text/plain",
                    item.get("body_text") or "",
                )
            for attachment in attachments:
                destination.write(f"--{mixed_boundary}\r\n".encode("ascii"))
                self._write_attachment(
                    destination,
                    attachment,
                    progress_callback,
                    processed_count,
                )
            destination.write(f"--{mixed_boundary}--\r\n".encode("ascii"))
        elif has_html:
            self._write_alternative(destination, item, alternative_boundary)
        else:
            self._write_base64_text(destination, item.get("body_text") or "")

    def _write_alternative(
        self,
        destination,
        item: dict,
        boundary: str,
    ) -> None:
        destination.write(f"--{boundary}\r\n".encode("ascii"))
        self._write_text_part(
            destination,
            "text/plain",
            item.get("body_text") or "",
        )
        destination.write(f"--{boundary}\r\n".encode("ascii"))
        self._write_text_part(
            destination,
            "text/html",
            item.get("body_html") or "",
        )
        destination.write(f"--{boundary}--\r\n".encode("ascii"))

    def _write_text_part(self, destination, content_type: str, value: str) -> None:
        destination.write(
            (
                f'Content-Type: {content_type}; charset="utf-8"\r\n'
                "Content-Transfer-Encoding: base64\r\n\r\n"
            ).encode("ascii")
        )
        self._write_base64_text(destination, value)

    @staticmethod
    def _write_base64_text(destination, value: str) -> None:
        encoded = base64.encodebytes(value.encode("utf-8"))
        destination.write(encoded.replace(b"\n", b"\r\n"))
        destination.write(b"\r\n")

    def _write_attachment(
        self,
        destination,
        attachment: dict,
        progress_callback: Callable[[int], bool] | None = None,
        processed_count: int = 0,
    ) -> None:
        storage_key = attachment.get("storage_key")
        if not storage_key:
            raise FileNotFoundError("첨부 저장 식별자가 없습니다.")
        source_path = self.attachment_resolver(storage_key).resolve()
        if not source_path.is_file():
            raise FileNotFoundError("첨부 파일을 찾을 수 없습니다.")
        expected_size = int(attachment.get("size_bytes") or 0)
        if expected_size and source_path.stat().st_size != expected_size:
            raise OSError("첨부 파일 크기가 일치하지 않습니다.")

        file_name = self._safe_attachment_name(attachment.get("file_name"))
        content_type = attachment.get("content_type") or mimetypes.guess_type(
            file_name
        )[0] or "application/octet-stream"
        if not re.fullmatch(r"[\w.+-]+/[\w.+-]+", content_type):
            content_type = "application/octet-stream"
        encoded_name = quote(file_name, safe="")
        destination.write(
            (
                f"Content-Type: {content_type}\r\n"
                "Content-Transfer-Encoding: base64\r\n"
                f"Content-Disposition: attachment; filename*=UTF-8''{encoded_name}\r\n"
                "\r\n"
            ).encode("ascii")
        )
        with source_path.open("rb") as source:
            while chunk := source.read(self.ATTACHMENT_CHUNK_BYTES):
                encoded = base64.b64encode(chunk)
                for offset in range(0, len(encoded), 76):
                    destination.write(encoded[offset:offset + 76])
                    destination.write(b"\r\n")
                if progress_callback and not progress_callback(processed_count):
                    raise BackupLeaseLostError("백업 lease 소유권을 잃었습니다.")
        destination.write(b"\r\n")

    @staticmethod
    def _write_headers(destination, headers: list[tuple[str, str]]) -> None:
        for name, value in headers:
            if value:
                destination.write(f"{name}: {value}\r\n".encode("utf-8"))
        destination.write(b"\r\n")

    @classmethod
    def _message_file_name(cls, item: dict) -> str:
        ordinal = int(item.get("ordinal") or 0)
        subject = cls._safe_subject(item.get("subject"))
        return f"{ordinal:06d}-{subject}.eml"

    @staticmethod
    def _safe_subject(value: str | None) -> str:
        subject = value or "제목-없음"
        subject = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", subject)
        subject = " ".join(subject.split()).strip(" .-")
        return (subject or "제목-없음")[:120]

    @staticmethod
    def _safe_attachment_name(value: str | None) -> str:
        name = Path((value or "attachment.bin").replace("\\", "/")).name
        name = re.sub(r"[\x00-\x1f]", "", name).strip()
        return (name or "attachment.bin")[:255]

    @staticmethod
    def _safe_message_id(value: str | None) -> str:
        normalized = re.sub(r"[^A-Za-z0-9_.-]", "-", value or "message")
        return normalized[:180] or "message"

    @staticmethod
    def _address_list(values: list[str]) -> str:
        safe = []
        for value in values:
            normalized = str(value).replace("\r", "").replace("\n", "").strip()
            if normalized:
                safe.append(normalized)
        return ", ".join(safe)

    @staticmethod
    def _format_date(value: datetime | None) -> str:
        if value is None:
            value = datetime.now(UTC)
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return format_datetime(value)

    @staticmethod
    def _logical_bytes(item: dict) -> int:
        total = sum(
            len(str(item.get(field) or "").encode("utf-8"))
            for field in ("subject", "body_text", "body_html")
        )
        return total + sum(
            int(attachment.get("size_bytes") or 0)
            for attachment in item.get("attachments") or []
        )

    @staticmethod
    def _iso(value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()
