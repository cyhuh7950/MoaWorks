from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import require_admin
from app.schemas.directory import AuthUserSummary
from app.schemas.observability import (
    MonitoringAlertListResponse,
    MonitoringEventListResponse,
    MonitoringAlert,
    MonitoringOverview,
    MonitoringRule,
    MonitoringRuleUpdate,
    RuleListResponse,
)
from app.services.observability_service import ObservabilityService

router = APIRouter()


@router.get("/overview", response_model=MonitoringOverview)
def get_overview(admin: AuthUserSummary = Depends(require_admin)) -> MonitoringOverview:
    return ObservabilityService().get_monitoring_overview(user_is_admin=True)


@router.get("/events", response_model=MonitoringEventListResponse)
def list_events(
    from_ts: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None, alias="to"),
    severity: list[str] | None = Query(default=None),
    category: str | None = Query(default=None),
    resolved: bool | None = Query(default=None),
    _: AuthUserSummary = Depends(require_admin),
) -> MonitoringEventListResponse:
    del _
    return ObservabilityService().list_monitoring_events(
        from_dt=from_ts,
        to_dt=to,
        severities=severity,
        category=category,
        resolved=resolved,
    )

@router.get("/rules", response_model=RuleListResponse)
def list_rules(_: AuthUserSummary = Depends(require_admin)) -> RuleListResponse:
    del _
    return RuleListResponse(rules=ObservabilityService().list_rules())


@router.put("/rules/{rule_id}", response_model=MonitoringRule)
def update_rule(
    rule_id: str,
    payload: MonitoringRuleUpdate,
    _: AuthUserSummary = Depends(require_admin),
) -> MonitoringRule:
    del _
    return ObservabilityService().update_rule(rule_id, payload)


@router.get("/alerts", response_model=MonitoringAlertListResponse)
def list_alerts(_: AuthUserSummary = Depends(require_admin)) -> MonitoringAlertListResponse:
    del _
    return ObservabilityService().list_alerts()

@router.post("/alerts/{alert_id}/ack", response_model=MonitoringAlert)
def ack_alert(alert_id: str, actor: AuthUserSummary = Depends(require_admin)) -> MonitoringAlert:
    return ObservabilityService().ack_alert(alert_id, actor)


@router.post("/alerts/{alert_id}/resolve", response_model=MonitoringAlert)
def resolve_alert(alert_id: str, actor: AuthUserSummary = Depends(require_admin)) -> MonitoringAlert:
    return ObservabilityService().resolve_alert(alert_id, actor)
