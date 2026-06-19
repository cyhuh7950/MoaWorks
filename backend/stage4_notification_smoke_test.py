from __future__ import annotations

import json
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.observability_service import ObservabilityService


def _make_event(user_id: str, index: int, dedup_key: str, resource_id: str) -> EventEnvelope:
    return EventEnvelope(
        eventId=f"evt-{index}-{uuid4().hex}",
        eventType="approval.status.changed",
        category=MonitoringCategory.APPROVAL,
        severity=SeverityLevel.INFO,
        resourceType="approvalDocument",
        resourceId=resource_id,
        requestId=f"req-{index}",
        dedupKey=dedup_key,
        title=f"approval {index}",
        message=f"approval event {index}",
        companyId="company_1",
        actorUserId=user_id,
        visibility=Visibility.BOTH,
    )


def _dump_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_checks() -> bool:
    with tempfile.TemporaryDirectory(prefix="moaworks-phase4-") as temp_dir:
        state_file = Path(temp_dir) / "observability-state.json"
        _dump_json(state_file, {"notifications": [], "events": [], "rules": [], "alerts": []})
        service = ObservabilityService(state_file=state_file)

        user_id = "user_1"

        # 1) dedup 정책: 2분 이내 동일 dedupKey/대상은 합쳐져 occurrenceCount가 증가해야 한다.
        service.emit_event(_make_event(user_id, 1, dedup_key="dup-001", resource_id="doc-100"))
        service.emit_event(_make_event(user_id, 2, dedup_key="dup-001", resource_id="doc-100"))
        list_now = service.list_notifications(user_id=user_id, include_admin=False, limit=20)
        merged_count = list_now.notifications[0].occurrenceCount if list_now.notifications else 0
        if not list_now.notifications or merged_count < 2:
            print("FAIL: 중복 merge 확인 실패 (occurrenceCount 증가 미발생)")
            return False

        # 2) dedup 윈도우 초과 시도는 새 알림으로 생성되어야 한다.
        #    _now 함수 훅으로 3분 경과를 흉내내어 경계 동작 검증.
        with patch("app.services.observability_service._now", lambda: datetime.now(UTC) + timedelta(minutes=3)):
            service.emit_event(_make_event(user_id, 3, dedup_key="dup-001", resource_id="doc-100"))
        list_after_window = service.list_notifications(user_id=user_id, include_admin=False, limit=20)
        if len(list_after_window.notifications) < 2:
            print("FAIL: dedup 윈도우 초과 시 새 알림 분리 미동작")
            return False

        # 3) resolved 필터: resolved=true/false 이벤트만 각각 선별되어야 한다.
        state = service._load_state()
        resolved_event = dict(_make_event(user_id, 4, dedup_key="resolved-001", resource_id="doc-200").model_dump(mode="json"))
        resolved_event["resolved"] = True
        unresolved_event = dict(
            _make_event(user_id, 5, dedup_key="resolved-002", resource_id="doc-201").model_dump(mode="json")
        )
        unresolved_event["resolved"] = False
        state["events"].extend([resolved_event, unresolved_event])
        service._store_state(state)

        resolved_true = service.list_monitoring_events(resolved=True).events
        resolved_false = service.list_monitoring_events(resolved=False).events
        if not any(item.resolved is True for item in resolved_true):
            print("FAIL: resolved=true 필터 미동작")
            return False
        if not any(item.resolved is False for item in resolved_false):
            print("FAIL: resolved=false 필터 미동작")
            return False

        # 4) stream 라우트의 기본형식 확인(최소 1건 + heartbeat 이벤트 1개).
        stream = service.stream_notifications(user_id=user_id, include_admin=False, limit=1)
        first = next(stream, "")
        second = next(stream, "")
        if "event: notification" not in first or "event: heartbeat" not in second:
            print("FAIL: SSE stream 기본 이벤트 형식 미일치")
            return False

        print("PASS: stage4_notification_smoke_test")
        return True


if __name__ == "__main__":
    if not run_checks():
        raise SystemExit(1)
