from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class SchedulePayload(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    startsAt: datetime
    endsAt: datetime
    description: str = Field(default="", max_length=4000)

    @field_validator("endsAt")
    @classmethod
    def validate_range(cls, value: datetime, info):
        if info.data.get("startsAt") and value <= info.data["startsAt"]:
            raise ValueError("종료 시각은 시작 시각보다 뒤여야 합니다.")
        return value


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
