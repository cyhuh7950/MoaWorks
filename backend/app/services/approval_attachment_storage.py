from __future__ import annotations

from pathlib import Path
import re

from app.core.config import settings


_APPROVAL_STORAGE_KEY = re.compile(r"^approval/attachments/([0-9a-f]{32})\.bin$")


class ApprovalAttachmentStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.attachment_root = self.root / "approval" / "attachments"

    def stored_path(self, storage_key: str) -> Path:
        matched = _APPROVAL_STORAGE_KEY.fullmatch(storage_key or "")
        if not matched:
            raise ValueError("결재 첨부 저장 식별자가 올바르지 않습니다.")
        path = (self.attachment_root / f"{matched.group(1)}.bin").resolve()
        if self.attachment_root.resolve() not in path.parents or not path.is_file():
            raise ValueError("결재 첨부 파일을 찾을 수 없습니다.")
        return path
