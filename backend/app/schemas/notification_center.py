from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.observability import NotificationEnvelope


class NotificationBulkActionRequest(BaseModel):
    notificationIds: list[str] = Field(min_length=1, max_length=100)


class NotificationBulkActionResponse(BaseModel):
    updatedCount: int
    notifications: list[NotificationEnvelope]


class NotificationReadAllRequest(BaseModel):
    severities: list[str] = Field(default_factory=list)
    category: str | None = None


class NotificationPreferenceCategory(BaseModel):
    enabled: bool = True
    importantOnly: bool = False


class NotificationPreferences(BaseModel):
    enabled: bool = True
    quietHoursEnabled: bool = False
    quietHoursStart: str = "22:00"
    quietHoursEnd: str = "07:00"
    categories: dict[str, NotificationPreferenceCategory] = Field(default_factory=dict)
    updatedAt: datetime | None = None

    @field_validator("quietHoursStart", "quietHoursEnd")
    @classmethod
    def validate_time(cls, value: str) -> str:
        parts = value.split(":")
        if len(parts) != 2:
            raise ValueError("시간은 HH:MM 형식이어야 합니다.")
        hour, minute = (int(part) for part in parts)
        if hour not in range(24) or minute not in range(60):
            raise ValueError("유효한 시간을 입력해 주세요.")
        return f"{hour:02d}:{minute:02d}"
