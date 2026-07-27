from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import re
from uuid import uuid4

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import MessengerAttachmentMeta, MessengerAttachmentUploadResponse


_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")


class MessengerAttachmentTooLargeError(ValueError):
    pass


class MessengerAttachmentStorage:
    def __init__(self, root: Path | None = None, *, max_file_bytes: int | None = None) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.upload_root = self.root / "messenger" / "uploads"
        self.max_file_bytes = max_file_bytes or settings.mail_attachment_max_file_bytes

    def stage(self, actor: AuthUserSummary, file_name: str, content_type: str, content: bytes) -> MessengerAttachmentUploadResponse:
        if not content:
            raise ValueError("빈 파일은 첨부할 수 없습니다.")
        if len(content) > self.max_file_bytes:
            raise MessengerAttachmentTooLargeError("첨부 파일 한 개의 최대 크기를 초과했습니다.")
        safe_name = self._safe_file_name(file_name)
        upload_id = uuid4().hex
        self.upload_root.mkdir(parents=True, exist_ok=True)
        data_path = self._data_path(upload_id)
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
            self._write_metadata_atomic(upload_id, metadata)
        except Exception:
            data_path.unlink(missing_ok=True)
            raise
        return MessengerAttachmentUploadResponse(
            uploadId=upload_id,
            fileName=safe_name,
            contentType=metadata["contentType"],
            sizeBytes=len(content),
        )

    def resolve(self, actor: AuthUserSummary, attachment: MessengerAttachmentMeta) -> dict:
        metadata = self._load_metadata(attachment.uploadId)
        if metadata["ownerCompanyId"] != actor.companyId or metadata["ownerUserId"] != actor.userId:
            raise PermissionError("첨부 업로드에 접근할 권한이 없습니다.")
        if metadata.get("attached"):
            raise ValueError("이미 사용된 첨부 업로드입니다.")
        data_path = self._data_path(attachment.uploadId)
        if not data_path.is_file() or data_path.stat().st_size != int(metadata["sizeBytes"]):
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        requested = (attachment.fileName, attachment.contentType, attachment.sizeBytes)
        canonical = (metadata["fileName"], metadata["contentType"], int(metadata["sizeBytes"]))
        if requested != canonical:
            raise ValueError("첨부 파일 정보가 업로드 결과와 일치하지 않습니다.")
        return {
            "upload_id": attachment.uploadId,
            "file_name": metadata["fileName"],
            "content_type": metadata["contentType"],
            "size_bytes": int(metadata["sizeBytes"]),
            "storage_key": metadata["storageKey"],
        }

    def mark_attached(self, upload_id: str, message_id: str) -> None:
        metadata = self._load_metadata(upload_id)
        if metadata.get("attached"):
            raise ValueError("이미 사용된 첨부 업로드입니다.")
        metadata["attached"] = True
        metadata["attachedMessageId"] = message_id
        metadata["attachedAt"] = datetime.now(UTC).isoformat()
        self._write_metadata_atomic(upload_id, metadata)

    def restore_unattached(self, upload_id: str, message_id: str) -> None:
        metadata = self._load_metadata(upload_id)
        if not metadata.get("attached"):
            return
        if metadata.get("attachedMessageId") != message_id:
            raise ValueError("다른 메시지에 연결된 첨부 업로드입니다.")
        metadata["attached"] = False
        metadata.pop("attachedMessageId", None)
        metadata.pop("attachedAt", None)
        self._write_metadata_atomic(upload_id, metadata)

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
                if metadata.get("attached") or datetime.fromisoformat(metadata["createdAt"]) >= threshold:
                    continue
                self._data_path(metadata["uploadId"]).unlink(missing_ok=True)
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

    def _write_metadata_atomic(self, upload_id: str, metadata: dict) -> None:
        metadata_path = self._metadata_path(upload_id)
        temporary_path = metadata_path.with_name(f"{metadata_path.name}.{uuid4().hex}.tmp")
        try:
            temporary_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
            temporary_path.replace(metadata_path)
        finally:
            temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _validate_upload_id(upload_id: str) -> None:
        if not _UPLOAD_ID.fullmatch(upload_id):
            raise ValueError("첨부 업로드 식별자가 올바르지 않습니다.")

    @staticmethod
    def _storage_key(upload_id: str) -> str:
        return f"messenger/uploads/{upload_id}.bin"

    @staticmethod
    def _upload_id_from_storage_key(storage_key: str) -> str:
        matched = re.fullmatch(r"messenger/uploads/([0-9a-f]{32})\.bin", storage_key or "")
        if not matched:
            raise ValueError("첨부 저장 식별자가 올바르지 않습니다.")
        return matched.group(1)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = Path((file_name or "attachment.bin").replace("\\", "/")).name
        normalized = "".join(character for character in normalized if ord(character) >= 32).strip()
        return (normalized or "attachment.bin")[:255]
