from __future__ import annotations

from pathlib import Path
import re
from uuid import uuid4

from app.core.config import settings


APPROVAL_SIGNATURE_MAX_FILE_BYTES = 512 * 1024
_SIGNATURE_KEY = re.compile(r"^approval/signatures/([0-9a-f]{32})\.(png|jpg|webp)$")
_IMAGE_TYPES = {
    "image/png": ("png", lambda content: content.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/jpeg": ("jpg", lambda content: content.startswith(b"\xff\xd8\xff")),
    "image/webp": ("webp", lambda content: len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"),
}
_EXTENSION_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def detect_safe_image_type(content: bytes) -> str | None:
    for content_type, (_, matches) in _IMAGE_TYPES.items():
        if matches(content):
            return content_type
    return None


class ApprovalSignatureStorage:
    def __init__(self, root: Path | None = None, *, max_file_bytes: int = APPROVAL_SIGNATURE_MAX_FILE_BYTES) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.signature_root = (self.root / "approval" / "signatures").resolve()
        self.max_file_bytes = max_file_bytes

    def stage(self, file_name: str, content_type: str, content: bytes) -> dict[str, object]:
        if not content:
            raise ValueError("빈 서명 파일은 등록할 수 없습니다.")
        if len(content) > self.max_file_bytes:
            raise ValueError("서명 파일은 512KB를 초과할 수 없습니다.")
        safe_name = self._safe_file_name(file_name)
        normalized_type = (content_type or "").lower().strip()
        expected_type = _EXTENSION_TYPES.get(Path(safe_name).suffix.lower())
        detected_type = detect_safe_image_type(content)
        if normalized_type not in _IMAGE_TYPES or expected_type != normalized_type or detected_type != normalized_type:
            raise ValueError("서명 파일의 형식, 확장자, 실제 내용이 일치하지 않습니다.")

        extension = _IMAGE_TYPES[normalized_type][0]
        file_id = uuid4().hex
        storage_key = f"approval/signatures/{file_id}.{extension}"
        self.signature_root.mkdir(parents=True, exist_ok=True)
        path = (self.signature_root / f"{file_id}.{extension}").resolve()
        if self.signature_root not in path.parents:
            raise ValueError("서명 저장 경로가 올바르지 않습니다.")
        path.write_bytes(content)
        return {
            "storage_key": storage_key,
            "file_name": safe_name,
            "content_type": normalized_type,
            "size_bytes": len(content),
        }

    def stored_path(self, storage_key: str) -> Path:
        matched = _SIGNATURE_KEY.fullmatch(storage_key or "")
        if not matched:
            raise ValueError("서명 저장 식별자가 올바르지 않습니다.")
        path = (self.signature_root / f"{matched.group(1)}.{matched.group(2)}").resolve()
        if self.signature_root not in path.parents or not path.is_file():
            raise ValueError("서명 파일을 찾을 수 없습니다.")
        return path

    def delete(self, storage_key: str) -> None:
        matched = _SIGNATURE_KEY.fullmatch(storage_key or "")
        if not matched:
            raise ValueError("서명 저장 식별자가 올바르지 않습니다.")
        path = (self.signature_root / f"{matched.group(1)}.{matched.group(2)}").resolve()
        if self.signature_root not in path.parents:
            raise ValueError("서명 저장 경로가 올바르지 않습니다.")
        path.unlink(missing_ok=True)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = Path((file_name or "signature.png").replace("\\", "/")).name
        normalized = "".join(character for character in normalized if ord(character) >= 32).strip()
        return (normalized or "signature.png")[:255]
