from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import re
from uuid import uuid4

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import MailAttachmentMeta, MailAttachmentUploadResponse


_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")


class MailAttachmentStorage:
    def __init__(self, root: Path | None = None, *, max_file_bytes: int | None = None) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.upload_root = self.root / "mail" / "uploads"
        self.max_file_bytes = max_file_bytes or settings.mail_attachment_max_file_bytes

    def stage(self, actor: AuthUserSummary, file_name: str, content_type: str, content: bytes) -> MailAttachmentUploadResponse:
        if not content:
            raise ValueError("빈 파일은 첨부할 수 없습니다.")
        if len(content) > self.max_file_bytes:
            raise ValueError("첨부 파일 한 개의 최대 크기를 초과했습니다.")
        safe_name = self._safe_file_name(file_name)
        upload_id = uuid4().hex
        self.upload_root.mkdir(parents=True, exist_ok=True)
        data_path = self._data_path(upload_id)
        metadata_path = self._metadata_path(upload_id)
        data_path.write_bytes(content)
        metadata = {
            "uploadId": upload_id,
            "ownerCompanyId": actor.companyId,
            "ownerUserId": actor.userId,
            "fileName": safe_name,
            "contentType": content_type or "application/octet-stream",
            "sizeBytes": len(content),
            "storageKey": self._storage_key(upload_id),
            "attached": False,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        try:
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        except Exception:
            data_path.unlink(missing_ok=True)
            raise
        return MailAttachmentUploadResponse(
            uploadId=upload_id,
            fileName=safe_name,
            contentType=metadata["contentType"],
            sizeBytes=len(content),
        )

    def resolve(self, actor: AuthUserSummary, attachment: MailAttachmentMeta) -> dict:
        upload_id = attachment.uploadId or self._upload_id_from_storage_key(attachment.storageKey)
        metadata = self._load_metadata(upload_id)
        if metadata["ownerCompanyId"] != actor.companyId or metadata["ownerUserId"] != actor.userId:
            raise PermissionError("첨부 업로드에 접근할 권한이 없습니다.")
        if metadata.get("attached"):
            raise ValueError("이미 사용된 첨부 업로드입니다.")
        data_path = self._data_path(upload_id)
        if not data_path.is_file() or data_path.stat().st_size != int(metadata["sizeBytes"]):
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        requested = (attachment.fileName, attachment.contentType, attachment.sizeBytes)
        canonical = (metadata["fileName"], metadata["contentType"], int(metadata["sizeBytes"]))
        if requested != canonical:
            raise ValueError("첨부 파일 정보가 업로드 결과와 일치하지 않습니다.")
        return {
            "upload_id": upload_id,
            "file_name": metadata["fileName"],
            "content_type": metadata["contentType"],
            "size_bytes": int(metadata["sizeBytes"]),
            "storage_key": metadata["storageKey"],
        }

    def clone(
        self,
        actor: AuthUserSummary,
        *,
        storage_key: str,
        file_name: str,
        content_type: str,
        size_bytes: int,
    ) -> dict:
        source_path = self.stored_path(storage_key)
        if source_path.stat().st_size != size_bytes:
            raise ValueError("원문 첨부 파일 저장 상태가 올바르지 않습니다.")
        uploaded = self.stage(actor, file_name, content_type, source_path.read_bytes())
        return self.resolve(
            actor,
            MailAttachmentMeta(
                uploadId=uploaded.uploadId,
                fileName=uploaded.fileName,
                contentType=uploaded.contentType,
                sizeBytes=uploaded.sizeBytes,
            ),
        )

    def mark_attached(self, upload_id: str) -> None:
        metadata = self._load_metadata(upload_id)
        metadata["attached"] = True
        metadata["attachedAt"] = datetime.now(UTC).isoformat()
        self._metadata_path(upload_id).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")

    def stored_path(self, storage_key: str) -> Path:
        upload_id = self._upload_id_from_storage_key(storage_key)
        path = self._data_path(upload_id).resolve()
        if self.upload_root.resolve() not in path.parents or not path.is_file():
            raise ValueError("첨부 파일을 찾을 수 없습니다.")
        return path

    def cleanup_expired(self, *, older_than: timedelta = timedelta(hours=24)) -> int:
        if not self.upload_root.exists():
            return 0
        threshold = datetime.now(UTC) - older_than
        removed = 0
        for metadata_path in self.upload_root.glob("*.json"):
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                created_at = datetime.fromisoformat(metadata["createdAt"])
                if metadata.get("attached") or created_at >= threshold:
                    continue
                upload_id = metadata["uploadId"]
                self._data_path(upload_id).unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                removed += 1
            except (KeyError, ValueError, OSError, json.JSONDecodeError):
                continue
        return removed

    def _load_metadata(self, upload_id: str) -> dict:
        self._validate_upload_id(upload_id)
        try:
            return json.loads(self._metadata_path(upload_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("첨부 업로드를 찾을 수 없습니다.") from exc

    def _data_path(self, upload_id: str) -> Path:
        self._validate_upload_id(upload_id)
        return self.upload_root / f"{upload_id}.bin"

    def _metadata_path(self, upload_id: str) -> Path:
        self._validate_upload_id(upload_id)
        return self.upload_root / f"{upload_id}.json"

    @staticmethod
    def _validate_upload_id(upload_id: str) -> None:
        if not _UPLOAD_ID.fullmatch(upload_id):
            raise ValueError("첨부 업로드 식별자가 올바르지 않습니다.")

    @staticmethod
    def _storage_key(upload_id: str) -> str:
        return f"mail/uploads/{upload_id}.bin"

    @staticmethod
    def _upload_id_from_storage_key(storage_key: str | None) -> str:
        if not storage_key:
            raise ValueError("실제 업로드된 첨부만 사용할 수 있습니다.")
        matched = re.fullmatch(r"mail/uploads/([0-9a-f]{32})\.bin", storage_key)
        if not matched:
            raise ValueError("첨부 저장 식별자가 올바르지 않습니다.")
        return matched.group(1)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = Path((file_name or "attachment.bin").replace("\\", "/")).name
        normalized = "".join(character for character in normalized if ord(character) >= 32).strip()
        return (normalized or "attachment.bin")[:255]
