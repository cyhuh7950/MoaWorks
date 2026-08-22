from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class OperationalBackupPolicyUpdate(BaseModel):
    enabled: bool
    intervalHours: int = Field(ge=1, le=720)
    retentionDays: int = Field(ge=1, le=3650)


class OperationalBackupPolicyView(BaseModel):
    enabled: bool
    intervalHours: int
    retentionDays: int
    encryptionRequired: bool = True
    storageMode: Literal["managed_local"] = "managed_local"
    lastScheduledAt: datetime | None = None
    nextScheduledAt: datetime | None = None
    updatedAt: datetime | None = None


class OperationalBackupJobView(BaseModel):
    backupId: str
    triggerType: Literal["manual", "schedule"]
    status: Literal["queued", "running", "completed", "failed", "expired"]
    artifactSha256: str | None = None
    sizeBytes: int | None = None
    snapshotAt: datetime | None = None
    completedAt: datetime | None = None
    expiresAt: datetime | None = None
    errorCode: str | None = None
    errorMessage: str | None = None
    createdAt: datetime


class OperationalRestoreDrillView(BaseModel):
    drillId: str
    backupId: str
    status: Literal["queued", "running", "completed", "failed"]
    checksumVerified: bool
    rpoSeconds: int | None = None
    rtoSeconds: int | None = None
    completedAt: datetime | None = None
    errorCode: str | None = None
    errorMessage: str | None = None
    createdAt: datetime


class OperationalBackupOverview(BaseModel):
    policy: OperationalBackupPolicyView
    backups: list[OperationalBackupJobView]
    restoreDrills: list[OperationalRestoreDrillView]
