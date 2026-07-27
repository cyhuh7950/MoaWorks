from __future__ import annotations

import os
from pathlib import Path
import re
from uuid import uuid4


MAX_FILE_BYTES = int(os.getenv("WORKSPACE_FILE_MAX_BYTES", str(50 * 1024 * 1024)))
ALLOWED_CONTENT_TYPES = {
    "text/plain", "text/csv", "application/pdf", "application/zip",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg", "image/png", "image/gif", "image/webp",
}


class ContentTypeRejected(ValueError):
    pass


class WorkspaceFileStorage:
    def __init__(self, root: str | Path | None = None, max_bytes: int = MAX_FILE_BYTES) -> None:
        self.root = Path(root or os.getenv("WORKSPACE_FILE_STORAGE_ROOT", "/app/data/workspace-files")).resolve()
        self.max_bytes = max_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def safe_name(value: str) -> str:
        value = re.sub(r"[\x00-\x1f\x7f]", "", value.replace("\\", "/").split("/")[-1]).strip()
        if not value or len(value) > 255:
            raise ValueError("invalid file name")
        return value

    def validate(self, content_type: str, content: bytes) -> None:
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ContentTypeRejected(content_type)
        if not content or len(content) > self.max_bytes:
            raise ValueError("invalid file size")

    def write(self, content: bytes) -> str:
        storage_key = uuid4().hex
        target = (self.root / storage_key).resolve()
        if target.parent != self.root:
            raise ValueError("invalid storage key")
        target.write_bytes(content)
        return storage_key

    def read(self, storage_key: str) -> bytes:
        target = (self.root / storage_key).resolve()
        if target.parent != self.root:
            raise ValueError("invalid storage key")
        return target.read_bytes()

    def unlink(self, storage_key: str) -> None:
        target = (self.root / storage_key).resolve()
        if target.parent == self.root:
            target.unlink(missing_ok=True)

    async def read_upload(self, upload) -> bytes:
        return await upload.read(self.max_bytes + 1)
