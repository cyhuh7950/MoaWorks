from __future__ import annotations


def subscription_status_for_visibility(visibility: str) -> str:
    if visibility == "public":
        return "active"
    if visibility == "approval_required":
        return "pending"
    raise ValueError("비공개 캘린더는 구독할 수 없습니다.")


def validate_order_snapshot(current: list[dict], requested: list[dict]) -> list[str]:
    current_versions = {item["id"]: int(item["version"]) for item in current}
    requested_ids = [item["calendarId"] for item in requested]
    if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != set(current_versions):
        raise ValueError("전체 활성 캘린더 순서를 제출해야 합니다.")
    if any(current_versions[item["calendarId"]] != item["expectedVersion"] for item in requested):
        raise ValueError("캘린더 버전이 변경되었습니다.")
    return requested_ids
