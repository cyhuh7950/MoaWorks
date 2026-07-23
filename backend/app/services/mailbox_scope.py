from __future__ import annotations

from dataclasses import dataclass
import re


SYSTEM_KEYS = {
    "system:inbox": "inbox",
    "system:sent": "sent",
    "system:draft": "draft",
    "system:scheduled": "scheduled",
    "system:spam": "spam",
    "system:trash": "trash",
}


@dataclass(frozen=True)
class MailboxScope:
    key: str
    mailbox_type: str
    folder_id: str | None = None

    @classmethod
    def parse(cls, value: str) -> "MailboxScope":
        if value in SYSTEM_KEYS:
            return cls(value, SYSTEM_KEYS[value])
        matched = re.fullmatch(r"folder:(folder_[0-9a-f]+)", value)
        if matched:
            return cls(value, "folder", matched.group(1))
        raise ValueError("메일함 식별자가 올바르지 않습니다.")
