from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class SeverityLevel(str, Enum):
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class AlertStatus(str, Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class Visibility(str, Enum):
    ADMIN = "admin"
    USER = "user"
    BOTH = "both"


class MonitoringCategory(str, Enum):
    APPROVAL = "approval"
    MAIL = "mail"
    SYSTEM = "system"


class BaseEvent(BaseModel):
    schemaVersion: str = "1.0"
    eventId: str
    eventType: str
    category: MonitoringCategory
    severity: SeverityLevel
    resourceType: str
    resourceId: str
    requestId: str = Field(min_length=1)
    dedupKey: str
    title: str
    message: str
    source: str = "backend"
    companyId: str = Field(min_length=1)
    actorUserId: str | None = None
    occurrenceCount: int = 1
    occurredAt: datetime = Field(default_factory=lambda: datetime.now(UTC))
    createdAt: datetime = Field(default_factory=lambda: datetime.now(UTC))
    ttlMinutes: int = 4320
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("occurrenceCount")
    def validate_occurrence_count(cls, value: int) -> int:
        if value < 1:
            raise ValueError("occurrenceCount는 1 이상이어야 합니다.")
        return value


class EventEnvelope(BaseEvent):
    targets: list[str] = Field(default_factory=list)
    visibility: Visibility = Visibility.BOTH
    links: dict[str, str] = Field(default_factory=dict)
    delivery: dict[str, Any] = Field(default_factory=dict)
    auditing: dict[str, Any] = Field(default_factory=dict)
    targetAudience: str = "both"


class NotificationEnvelope(BaseEvent):
    notificationId: str
    recipientUserIds: list[str] = Field(default_factory=list)
    visibility: Visibility = Visibility.BOTH
    status: str = "unread"
    readAt: datetime | None = None
    acknowledgedAt: datetime | None = None
    archivedAt: datetime | None = None
    deliveryChannels: list[str] = Field(default_factory=lambda: ["inbox"])


class NotificationSummary(BaseModel):
    unreadCount: int
    severityCount: dict[str, int]
    latestCriticalAt: datetime | None
    latestWarnAt: datetime | None


class NotificationListResponse(BaseModel):
    notifications: list[NotificationEnvelope]
    nextCursor: str | None
    hasMore: bool


class NotificationDetailResponse(BaseEvent):
    status: str
    readAt: datetime | None = None
    acknowledgedAt: datetime | None = None
    severity: SeverityLevel


class MonitoringEvent(BaseEvent):
    resolved: bool = False


class MonitoringEventListResponse(BaseModel):
    events: list[MonitoringEvent]
    total: int


class MonitoringRule(BaseModel):
    ruleId: str
    metric: str
    operator: str
    threshold: int | float
    windowSec: int
    level: SeverityLevel
    targetAudience: str = "admin"
    notifyChannels: list[str] = Field(default_factory=list)
    enabled: bool = True
    createdAt: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(UTC))


class MonitoringRuleUpdate(BaseModel):
    metric: str | None = None
    operator: str | None = None
    threshold: int | float | None = None
    windowSec: int | None = None
    level: SeverityLevel | str | None = None
    targetAudience: str | None = None
    notifyChannels: list[str] | None = None
    enabled: bool | None = None

    @field_validator("operator")
    @classmethod
    def validate_operator(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value not in {"gt", "gte", "lt", "lte", "eq", "neq"}:
            raise ValueError("operator는 gt/gte/lt/lte/eq/neq 중 하나여야 합니다.")
        return value


class MonitoringOverview(BaseModel):
    mailFailureRate24h: float
    approvalBacklogCount: int
    relayFailureCount1h: int
    diskUsagePercent: float
    alertOpenCount: int


class MonitoringAlert(BaseModel):
    alertId: str
    schemaVersion: str = "1.0"
    ruleId: str
    metric: str
    category: MonitoringCategory
    severity: SeverityLevel
    status: AlertStatus
    currentValue: float
    threshold: float
    windowSec: int
    detectedAt: datetime = Field(default_factory=lambda: datetime.now(UTC))
    resolvedAt: datetime | None = None
    acknowledgedAt: datetime | None = None
    resourceType: str
    resourceId: str
    message: str
    requestId: str

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str | MonitoringCategory) -> str | MonitoringCategory:
        if isinstance(value, MonitoringCategory):
            return value
        try:
            return MonitoringCategory(value)
        except ValueError as exc:
            raise ValueError("category는 approval|mail|system 이어야 합니다.") from exc


class MonitoringAlertListResponse(BaseModel):
    alerts: list[MonitoringAlert]
    total: int


class RuleListResponse(BaseModel):
    rules: list[MonitoringRule]
