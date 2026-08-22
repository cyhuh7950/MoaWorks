from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib import error, request


BASE_URL = "http://127.0.0.1:8510/api/v1"
ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "ChangeMe123!"


@dataclass
class ApiSession:
    token: str
    user: dict[str, Any]


def api_call(path: str, *, method: str = "GET", token: str | None = None, payload: Any | None = None) -> tuple[int, dict[str, Any]]:
    body = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = request.Request(f"{BASE_URL}{path}", method=method, data=body, headers=headers)
    try:
        with request.urlopen(req, timeout=10) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        return exc.code, json.loads(raw) if raw else {}


def expect_status(actual: int, expected: int, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")


def login(email: str, password: str) -> ApiSession:
    status, body = api_call("/auth/login", method="POST", payload={"email": email, "password": password})
    expect_status(status, 200, f"login({email})")
    return ApiSession(token=body["accessToken"], user=body["user"])


def find_or_create_role(admin: ApiSession, name: str, permissions: list[str]) -> str:
    status, directory = api_call("/admin/directory", token=admin.token)
    expect_status(status, 200, "admin directory")
    for role in directory["roles"]:
        if role["name"] == name:
            return role["id"]
    status, body = api_call("/admin/roles", method="POST", token=admin.token, payload={"name": name, "permissions": permissions})
    expect_status(status, 200, "create role")
    return body["id"]


def ensure_user(
    admin: ApiSession,
    *,
    email: str,
    name: str,
    password: str,
    role_id: str,
    user_type: str = "user",
) -> dict[str, Any]:
    status, directory = api_call("/admin/directory", token=admin.token)
    expect_status(status, 200, "admin directory refresh")
    for user in directory["users"]:
        if user["userEmail"] == email:
            if user["status"] != "active" or user["roleId"] != role_id:
                update_payload = {"status": "active", "roleId": role_id, "departmentId": user["departmentId"]}
                api_call(f"/admin/users/{user['userId']}", method="PATCH", token=admin.token, payload=update_payload)
            return user
    department_id = directory["departments"][0]["id"]
    status, body = api_call(
        "/admin/users",
        method="POST",
        token=admin.token,
        payload={
            "name": name,
            "email": email,
            "password": password,
            "departmentId": department_id,
            "roleId": role_id,
            "status": "active",
            "userType": user_type,
        },
    )
    expect_status(status, 200, f"create user {email}")
    return body


def latest_log_events(admin: ApiSession, document_id: str) -> list[str]:
    status, body = api_call(f"/approvals/audit-logs?documentId={document_id}", token=admin.token)
    expect_status(status, 200, "fetch audit logs")
    return [item["event"] for item in body["logs"]]


def main() -> int:
    suffix = str(int(time.time()))
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)

    role_name = f"stage4_role_{suffix}"
    permissions = [
        "approval:read",
        "approval:create",
        "approval:submit",
        "approval:act",
        "approval:withdraw",
        "approval:rework",
        "profile:read",
    ]
    role_id = find_or_create_role(admin, role_name, permissions)

    writer_email = f"stage4.writer.{suffix}@moaworks.local"
    approver_email = f"stage4.approver.{suffix}@moaworks.local"
    writer_password = "Stage4Writer!23"
    approver_password = "Stage4Approver!23"

    writer = ensure_user(admin, email=writer_email, name="Stage4 Writer", password=writer_password, role_id=role_id)
    approver = ensure_user(admin, email=approver_email, name="Stage4 Approver", password=approver_password, role_id=role_id)

    writer_session = login(writer_email, writer_password)
    approver_session = login(approver_email, approver_password)

    report: dict[str, Any] = {"steps": []}

    # Case 1: approve flow
    status, create_body = api_call(
        "/approvals",
        method="POST",
        token=writer_session.token,
        payload={
            "title": f"stage4 approve {suffix}",
            "content": "approval flow verification",
            "approverUserIds": [approver["userId"]],
        },
    )
    expect_status(status, 200, "create approval")
    approve_doc_id = create_body["documentId"]
    report["steps"].append({"createApproveDoc": approve_doc_id})

    status, submit_body = api_call(f"/approvals/{approve_doc_id}/submit", method="POST", token=writer_session.token)
    expect_status(status, 200, "submit approval")
    report["steps"].append({"submitApproveDoc": submit_body["status"]})

    status, approve_body = api_call(
        f"/approvals/{approve_doc_id}/approve",
        method="POST",
        token=approver_session.token,
        payload={"reason": "승인"},
    )
    expect_status(status, 200, "approve approval")
    assert approve_body["status"] == "approved"
    report["steps"].append({"approveDocStatus": approve_body["status"]})

    for path, label in [
        (f"/approvals/{approve_doc_id}/approve", "post-approved approve"),
        (f"/approvals/{approve_doc_id}/reject", "post-approved reject"),
        (f"/approvals/{approve_doc_id}/withdraw", "post-approved withdraw"),
        (f"/approvals/{approve_doc_id}/redraft", "post-approved redraft"),
        (f"/admin/approvals/{approve_doc_id}/force-approve", "post-approved force approve"),
        (f"/admin/approvals/{approve_doc_id}/force-reject", "post-approved force reject"),
    ]:
        payload = {"reason": "재시도"} if "approve" in path or "reject" in path else None
        method = "POST"
        token = admin.token if "/admin/" in path else (approver_session.token if "approve" in path or "reject" in path else writer_session.token)
        status, _ = api_call(path, method=method, token=token, payload=payload)
        if status not in {403, 422}:
            raise AssertionError(f"{label}: expected blocked status, got {status}")
    report["steps"].append({"approvedImmutable": "blocked"})

    # Case 2: reject -> redraft
    status, create_reject_body = api_call(
        "/approvals",
        method="POST",
        token=writer_session.token,
        payload={
            "title": f"stage4 reject {suffix}",
            "content": "reject flow verification",
            "approverUserIds": [approver["userId"]],
        },
    )
    expect_status(status, 200, "create reject doc")
    reject_doc_id = create_reject_body["documentId"]
    api_call(f"/approvals/{reject_doc_id}/submit", method="POST", token=writer_session.token)
    status, reject_body = api_call(
        f"/approvals/{reject_doc_id}/reject",
        method="POST",
        token=approver_session.token,
        payload={"reason": "반려"},
    )
    expect_status(status, 200, "reject approval")
    assert reject_body["status"] == "rejected"
    status, redraft_body = api_call(f"/approvals/{reject_doc_id}/redraft", method="POST", token=writer_session.token)
    expect_status(status, 200, "redraft rejected")
    assert redraft_body["status"] == "draft"
    report["steps"].append({"rejectRedraftStatus": redraft_body["status"]})

    # Case 3: withdraw -> redraft
    status, create_withdraw_body = api_call(
        "/approvals",
        method="POST",
        token=writer_session.token,
        payload={
            "title": f"stage4 withdraw {suffix}",
            "content": "withdraw flow verification",
            "approverUserIds": [approver["userId"]],
        },
    )
    expect_status(status, 200, "create withdraw doc")
    withdraw_doc_id = create_withdraw_body["documentId"]
    api_call(f"/approvals/{withdraw_doc_id}/submit", method="POST", token=writer_session.token)
    status, withdraw_body = api_call(f"/approvals/{withdraw_doc_id}/withdraw", method="POST", token=writer_session.token)
    expect_status(status, 200, "withdraw approval")
    assert withdraw_body["status"] == "withdrawn"
    status, redraft_withdraw_body = api_call(f"/approvals/{withdraw_doc_id}/redraft", method="POST", token=writer_session.token)
    expect_status(status, 200, "redraft withdrawn")
    assert redraft_withdraw_body["status"] == "draft"
    report["steps"].append({"withdrawRedraftStatus": redraft_withdraw_body["status"]})

    # Case 4: admin force approve / reject
    status, create_force_approve_body = api_call(
        "/approvals",
        method="POST",
        token=writer_session.token,
        payload={
            "title": f"stage4 force approve {suffix}",
            "content": "force approve verification",
            "approverUserIds": [approver["userId"]],
        },
    )
    force_approve_doc_id = create_force_approve_body["documentId"]
    api_call(f"/approvals/{force_approve_doc_id}/submit", method="POST", token=writer_session.token)
    status, force_approve_body = api_call(
        f"/admin/approvals/{force_approve_doc_id}/force-approve",
        method="POST",
        token=admin.token,
        payload={"reason": "운영자 직권 승인"},
    )
    expect_status(status, 200, "force approve")
    assert force_approve_body["status"] == "approved"

    status, create_force_reject_body = api_call(
        "/approvals",
        method="POST",
        token=writer_session.token,
        payload={
            "title": f"stage4 force reject {suffix}",
            "content": "force reject verification",
            "approverUserIds": [approver["userId"]],
        },
    )
    force_reject_doc_id = create_force_reject_body["documentId"]
    api_call(f"/approvals/{force_reject_doc_id}/submit", method="POST", token=writer_session.token)
    status, force_reject_body = api_call(
        f"/admin/approvals/{force_reject_doc_id}/force-reject",
        method="POST",
        token=admin.token,
        payload={"reason": "운영자 직권 반려"},
    )
    expect_status(status, 200, "force reject")
    assert force_reject_body["status"] == "rejected"
    report["steps"].append({"forceActions": ["approved", "rejected"]})

    audit_events = latest_log_events(admin, force_reject_doc_id)
    required_events = {"approval.created", "approval.submitted", "approval.force_rejected"}
    if not required_events.issubset(set(audit_events)):
        raise AssertionError(f"audit events missing: required={required_events}, got={audit_events}")
    report["steps"].append({"auditEventsVerified": sorted(required_events)})

    # Detail endpoint
    status, detail_body = api_call(f"/approvals/{approve_doc_id}", token=writer_session.token)
    expect_status(status, 200, "approval detail")
    assert detail_body["id"] == approve_doc_id
    report["steps"].append({"detailEndpoint": detail_body["status"]})

    print(json.dumps({"status": "PASS", "report": report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
