from typing import Literal

from pydantic import BaseModel, Field


HealthStatus = Literal["ok", "warning", "error", "not_configured"]


class ComponentHealth(BaseModel):
    status: HealthStatus
    message: str
    details: dict[str, str] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: HealthStatus
    initialized: bool
    components: dict[str, ComponentHealth]
