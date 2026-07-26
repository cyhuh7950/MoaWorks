from __future__ import annotations

from datetime import date, datetime
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


class ContactPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(default="", max_length=64)
    companyName: str = Field(default="", max_length=160)
    memo: str = Field(default="", max_length=2000)


class PreferencePayload(BaseModel):
    locale: str = Field(min_length=2, max_length=16)
    timezone: str = Field(min_length=2, max_length=80)


class FileRenamePayload(BaseModel):
    fileName: str = Field(min_length=1, max_length=255)


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
