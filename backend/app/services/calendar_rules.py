from __future__ import annotations


def subscription_status_for_visibility(visibility: str) -> str:
    if visibility == "public":
        return "active"
    if visibility == "approval_required":
        return "pending"
    raise ValueError("비공개 캘린더는 구독할 수 없습니다.")


def subscription_action_for_visibility_change(previous: str, current: str) -> str:
    allowed = {"private", "public", "approval_required"}
    if previous not in allowed or current not in allowed:
        raise ValueError("지원하지 않는 캘린더 공개 범위입니다.")
    if current == "private" and previous != "private":
        return "cancel_open"
    if previous == "approval_required" and current == "public":
        return "activate_pending"
    return "none"


def validate_order_snapshot(current: list[dict], requested: list[dict]) -> list[str]:
    current_versions = {item["id"]: int(item["version"]) for item in current}
    requested_ids = [item["calendarId"] for item in requested]
    if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != set(current_versions):
        raise ValueError("전체 활성 캘린더 순서를 제출해야 합니다.")
    if any(current_versions[item["calendarId"]] != item["expectedVersion"] for item in requested):
        raise ValueError("캘린더 버전이 변경되었습니다.")
    return requested_ids
