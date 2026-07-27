from __future__ import annotations

from datetime import date, datetime
import re
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


class SchedulePayload(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    startsAt: datetime
    endsAt: datetime
    description: str = Field(default="", max_length=4000)
    location: str = Field(default="", max_length=500)
    attendeeUserIds: list[str] = Field(default_factory=list, max_length=50)
    repeatType: Literal["none", "daily", "weekly", "monthly"] = "none"
    repeatUntil: date | None = None
    alertMinutes: list[int] = Field(default_factory=list, max_length=3)
    timezone: str = Field(default="Asia/Seoul", min_length=1, max_length=80)
    calendarId: str | None = None

    @field_validator("endsAt")
    @classmethod
    def validate_range(cls, value: datetime, info):
        if info.data.get("startsAt") and value <= info.data["startsAt"]:
            raise ValueError("종료 시각은 시작 시각보다 뒤여야 합니다.")
        return value

    @field_validator("attendeeUserIds")
    @classmethod
    def validate_attendees(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value) or len(set(value)) != len(value):
            raise ValueError("참석자는 중복 없이 선택해야 합니다.")
        return value

    @field_validator("alertMinutes")
    @classmethod
    def validate_alerts(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value) or any(item not in {0, 10, 30, 60, 1440} for item in value):
            raise ValueError("알림 시점이 올바르지 않습니다.")
        return sorted(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("유효한 IANA 시간대를 입력하세요.") from exc
        return value

    @model_validator(mode="after")
    def validate_repeat(self):
        if self.repeatType == "none":
            self.repeatUntil = None
            return self
        if self.repeatUntil is None:
            raise ValueError("반복 일정은 종료일이 필요합니다.")
        if self.repeatUntil < self.startsAt.astimezone(ZoneInfo(self.timezone)).date():
            raise ValueError("반복 종료일은 시작일보다 빠를 수 없습니다.")
        return self


CalendarVisibility = Literal["public", "approval_required", "private"]
CALENDAR_COLORS = {"#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#d97706", "#65a30d", "#0891b2"}


class CalendarCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    color: str

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("캘린더 이름을 입력하세요.")
        return normalized

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if value not in CALENDAR_COLORS:
            raise ValueError("허용된 캘린더 색상을 선택하세요.")
        return value


class CalendarUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=32)
    color: str | None = None
    visibility: CalendarVisibility | None = None
    isDefault: bool | None = None
    expectedVersion: int = Field(ge=0)

    @field_validator("name")
    @classmethod
    def normalize_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("캘린더 이름을 입력하세요.")
        return normalized

    @field_validator("color")
    @classmethod
    def validate_optional_color(cls, value: str | None) -> str | None:
        if value is not None and value not in CALENDAR_COLORS:
            raise ValueError("허용된 캘린더 색상을 선택하세요.")
        return value

    @model_validator(mode="after")
    def require_change(self):
        if self.name is None and self.color is None and self.visibility is None and self.isDefault is None:
            raise ValueError("변경할 값을 입력하세요.")
        return self


class CalendarOrderItem(BaseModel):
    calendarId: str = Field(min_length=1)
    expectedVersion: int = Field(ge=0)


class CalendarOrderPayload(BaseModel):
    items: list[CalendarOrderItem] = Field(min_length=1, max_length=100)

    @field_validator("items")
    @classmethod
    def unique_items(cls, value: list[CalendarOrderItem]) -> list[CalendarOrderItem]:
        if len({item.calendarId for item in value}) != len(value):
            raise ValueError("캘린더는 중복 없이 제출하세요.")
        return value


class CalendarSubscriptionPayload(BaseModel):
    calendarId: str = Field(min_length=1)


class ContactPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(default="", max_length=64)
    companyName: str = Field(default="", max_length=160)
    memo: str = Field(default="", max_length=2000)
    groupId: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_contact_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("연락처 이름을 입력하세요.")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_contact_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("올바른 이메일 주소를 입력하세요.")
        return normalized

    @field_validator("groupId")
    @classmethod
    def normalize_group_id(cls, value: str | None) -> str | None:
        normalized = value.strip() if value else ""
        return normalized or None


class ContactGroupCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("그룹 이름을 입력하세요.")
        return normalized


class ContactGroupUpdatePayload(ContactGroupCreatePayload):
    expectedUpdatedAt: datetime


class PreferencePayload(BaseModel):
    locale: str = Field(min_length=2, max_length=16)
    timezone: str = Field(min_length=2, max_length=80)


class FileRenamePayload(BaseModel):
    fileName: str = Field(min_length=1, max_length=255)


FileScope = Literal["mine", "shared", "department", "recent", "favorites", "trash"]
FileSort = Literal["updated_desc", "updated_asc", "name_asc", "name_desc", "size_desc"]


class FilePatchPayload(BaseModel):
    fileName: str | None = Field(default=None, min_length=1, max_length=255)
    folderId: str | None = None
    expectedVersion: int | None = Field(default=None, ge=0)

    @field_validator("fileName")
    @classmethod
    def normalize_file_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        if not normalized or "/" in normalized or "\\" in normalized:
            raise ValueError("올바른 파일 이름을 입력하세요.")
        return normalized


class FileShareItem(BaseModel):
    targetType: Literal["user", "department"]
    targetId: str = Field(min_length=1)
    permission: Literal["viewer", "editor"]


class FileShareSnapshotPayload(BaseModel):
    expectedVersion: int = Field(ge=0)
    shares: list[FileShareItem] = Field(default_factory=list, max_length=200)

    @field_validator("shares")
    @classmethod
    def unique_targets(cls, value: list[FileShareItem]) -> list[FileShareItem]:
        keys = [(item.targetType, item.targetId) for item in value]
        if len(keys) != len(set(keys)):
            raise ValueError("공유 대상은 중복될 수 없습니다.")
        return value


class FolderCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parentId: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_folder_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized or "/" in normalized or "\\" in normalized:
            raise ValueError("올바른 폴더 이름을 입력하세요.")
        return normalized


class FolderPatchPayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    expectedVersion: int = Field(ge=0)

    @field_validator("name")
    @classmethod
    def normalize_folder_name(cls, value: str) -> str:
        return FolderCreatePayload.normalize_folder_name(value)


class WorkspaceItemList(BaseModel):
    items: list[dict]


class WorkspaceDirectoryResponse(BaseModel):
    departments: list[dict]
    users: list[dict]


class WorkspacePreferencesResponse(BaseModel):
    locale: str
    timezone: str


class NoticeRecord(BaseModel):
    id: str
    title: str
    content: str
    author_name: str
    published_at: datetime
    is_read: bool


class NoticeListResponse(BaseModel):
    items: list[NoticeRecord]
    unread_count: int
