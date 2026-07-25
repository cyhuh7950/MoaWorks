from __future__ import annotations

from pathlib import Path
import re
from uuid import uuid4

from app.core.config import settings


_APPROVAL_STORAGE_KEY = re.compile(r"^approval/attachments/([0-9a-f]{32})\.bin$")
APPROVAL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024
APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024
APPROVAL_ATTACHMENT_MAX_COUNT = 10


class ApprovalAttachmentStorage:
    def __init__(self, root: Path | None = None, *, max_file_bytes: int = APPROVAL_ATTACHMENT_MAX_FILE_BYTES) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.attachment_root = self.root / "approval" / "attachments"
        self.max_file_bytes = max_file_bytes

    def stage(self, file_name: str, content_type: str, content: bytes) -> dict[str, object]:
        if not content:
            raise ValueError("빈 파일은 첨부할 수 없습니다.")
        if len(content) > self.max_file_bytes:
            raise ValueError("결재 첨부 파일 한 개의 최대 크기를 초과했습니다.")
        upload_id = uuid4().hex
        safe_name = self._safe_file_name(file_name)
        storage_key = f"approval/attachments/{upload_id}.bin"
        self.attachment_root.mkdir(parents=True, exist_ok=True)
        path = self.attachment_root / f"{upload_id}.bin"
        path.write_bytes(content)
        return {
            "upload_id": upload_id,
            "file_name": safe_name,
            "content_type": (content_type or "application/octet-stream")[:255],
            "size_bytes": len(content),
            "storage_key": storage_key,
        }

    def stored_path(self, storage_key: str) -> Path:
        matched = _APPROVAL_STORAGE_KEY.fullmatch(storage_key or "")
        if not matched:
            raise ValueError("결재 첨부 저장 식별자가 올바르지 않습니다.")
        path = (self.attachment_root / f"{matched.group(1)}.bin").resolve()
        if self.attachment_root.resolve() not in path.parents or not path.is_file():
            raise ValueError("결재 첨부 파일을 찾을 수 없습니다.")
        return path

    def delete(self, storage_key: str) -> None:
        matched = _APPROVAL_STORAGE_KEY.fullmatch(storage_key or "")
        if not matched:
            raise ValueError("결재 첨부 저장 식별자가 올바르지 않습니다.")
        path = (self.attachment_root / f"{matched.group(1)}.bin").resolve()
        if self.attachment_root.resolve() not in path.parents:
            raise ValueError("결재 첨부 저장 경로가 올바르지 않습니다.")
        path.unlink(missing_ok=True)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = Path((file_name or "attachment.bin").replace("\\", "/")).name
        normalized = "".join(character for character in normalized if ord(character) >= 32).strip()
        return (normalized or "attachment.bin")[:255]
