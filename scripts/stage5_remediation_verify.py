from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8510/api/v1"
ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "ChangeMe123!"


@dataclass
class ApiResponse:
    status: int
    body: dict


def request(method: str, path: str, payload: dict | None = None, token: str | None = None) -> ApiResponse:
    data = None
    headers = {
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return ApiResponse(response.status, {})
            try:
                return ApiResponse(response.status, json.loads(raw))
            except json.JSONDecodeError:
                return ApiResponse(response.status, {"rawText": raw})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        body = json.loads(raw) if raw else {}
        return ApiResponse(exc.code, body)


def print_json(title: str, payload: dict) -> None:
    print(f"{title}={json.dumps(payload, ensure_ascii=True, separators=(',', ':'))}")


def login(email: str, password: str) -> ApiResponse:
    return request("POST", "/auth/login", {"email": email, "password": password})


def main() -> int:
    report: dict[str, object] = {
        "executedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": BASE_URL,
        "checks": {},
    }

    admin_login = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    report["checks"]["adminLogin"] = {
        "status": admin_login.status,
        "code": admin_login.body.get("code"),
        "user": admin_login.body.get("user", {}).get("userEmail"),
    }
    if admin_login.status != 200:
        print_json("REPORT", report)
        return 1

    admin_token = admin_login.body["accessToken"]
    overview = request("GET", "/admin/directory", token=admin_token)
    report["checks"]["overview"] = {
        "status": overview.status,
        "userCount": len(overview.body.get("users", [])),
        "roleCount": len(overview.body.get("roles", [])),
    }
    if overview.status != 200:
        print_json("REPORT", report)
        return 1

    department_id = overview.body["departments"][0]["id"]
    company_domain = overview.body["company"]["domain"]

    ts = str(int(time.time()))
    creator_role_name = f"Stage5 Creator {ts}"
    approver_role_name = f"Stage5 Approver {ts}"
    blocked_role_name = f"Stage5 Blocked Role {ts}"

    creator_role = request("POST", "/admin/roles", {
        "name": creator_role_name,
        "permissions": ["approval:read", "approval:create", "approval:submit", "approval:withdraw", "approval:rework"],
    }, token=admin_token)
    approver_role = request("POST", "/admin/roles", {
        "name": approver_role_name,
        "permissions": ["approval:read", "approval:act"],
    }, token=admin_token)
    blocked_role = request("POST", "/admin/roles", {
        "name": blocked_role_name,
        "permissions": ["approval:read"],
    }, token=admin_token)

    creator_email = f"stage5.creator.{ts}@{company_domain}"
    approver_email = f"stage5.approver.{ts}@{company_domain}"
    blocked_user_email = f"stage5.blocked-user.{ts}@{company_domain}"
    blocked_role_user_email = f"stage5.blocked-role.{ts}@{company_domain}"

    creator_user = request("POST", "/admin/users", {
        "name": f"Stage5 Creator {ts}",
        "email": creator_email,
        "password": "Stage5User!23",
        "departmentId": department_id,
        "roleId": creator_role.body["id"],
        "status": "active",
        "userType": "user",
    }, token=admin_token)
    approver_user = request("POST", "/admin/users", {
        "name": f"Stage5 Approver {ts}",
        "email": approver_email,
        "password": "Stage5User!23",
        "departmentId": department_id,
        "roleId": approver_role.body["id"],
        "status": "active",
        "userType": "user",
    }, token=admin_token)
    blocked_user = request("POST", "/admin/users", {
        "name": f"Stage5 Blocked User {ts}",
        "email": blocked_user_email,
        "password": "Stage5User!23",
        "departmentId": department_id,
        "roleId": creator_role.body["id"],
        "status": "active",
        "userType": "user",
    }, token=admin_token)
    blocked_role_user = request("POST", "/admin/users", {
        "name": f"Stage5 Blocked Role User {ts}",
        "email": blocked_role_user_email,
        "password": "Stage5User!23",
        "departmentId": department_id,
        "roleId": blocked_role.body["id"],
        "status": "active",
        "userType": "user",
    }, token=admin_token)

    report["checks"]["seedCreate"] = {
        "creatorUserStatus": creator_user.status,
        "approverUserStatus": approver_user.status,
        "blockedUserStatus": blocked_user.status,
        "blockedRoleUserStatus": blocked_role_user.status,
    }

    blocked_user_login = login(blocked_user_email, "Stage5User!23")
    blocked_user_token = blocked_user_login.body["accessToken"]
    user_disable = request("PATCH", f"/admin/users/{blocked_user.body['userId']}", {"status": "inactive"}, token=admin_token)
    blocked_old_me = request("GET", "/auth/me", token=blocked_user_token)
    blocked_new_login = login(blocked_user_email, "Stage5User!23")
    report["checks"]["inactiveUserBlock"] = {
        "updateStatus": user_disable.status,
        "oldTokenStatus": blocked_old_me.status,
        "oldTokenCode": blocked_old_me.body.get("code"),
        "newLoginStatus": blocked_new_login.status,
        "newLoginCode": blocked_new_login.body.get("code"),
    }

    blocked_role_login = login(blocked_role_user_email, "Stage5User!23")
    blocked_role_token = blocked_role_login.body["accessToken"]
    role_disable = request("PATCH", f"/admin/roles/{blocked_role.body['id']}", {"status": "inactive"}, token=admin_token)
    blocked_role_me = request("GET", "/auth/me", token=blocked_role_token)
    report["checks"]["inactiveRoleBlock"] = {
        "updateStatus": role_disable.status,
        "oldTokenStatus": blocked_role_me.status,
        "oldTokenCode": blocked_role_me.body.get("code"),
    }

    creator_login = login(creator_email, "Stage5User!23")
    approver_login = login(approver_email, "Stage5User!23")
    creator_token = creator_login.body["accessToken"]
    approver_token = approver_login.body["accessToken"]

    created_document = request("POST", "/approvals", {
        "title": f"Stage5 Approval {ts}",
        "content": "Stage5 approval immutability verification",
        "approverUserIds": [approver_user.body["userId"]],
    }, token=creator_token)
    document_id = created_document.body["documentId"]
    submitted_document = request("POST", f"/approvals/{document_id}/submit", token=creator_token)
    approved_document = request("POST", f"/approvals/{document_id}/approve", {
        "reason": "stage5 approval"
    }, token=approver_token)
    invalid_withdraw = request("POST", f"/approvals/{document_id}/withdraw", token=creator_token)
    invalid_redraft = request("POST", f"/approvals/{document_id}/redraft", token=creator_token)
    report["checks"]["approvedImmutability"] = {
        "createStatus": created_document.status,
        "submitStatus": submitted_document.status,
        "approveStatus": approved_document.status,
        "approvedStatus": approved_document.body.get("status"),
        "withdrawAfterApproveStatus": invalid_withdraw.status,
        "withdrawAfterApproveCode": invalid_withdraw.body.get("code"),
        "redraftAfterApproveStatus": invalid_redraft.status,
        "redraftAfterApproveCode": invalid_redraft.body.get("code"),
    }

    notif_me = request("GET", "/auth/me", token=creator_token)
    notif_summary = request("GET", "/notifications/summary", token=creator_token)
    notif_list = request("GET", "/notifications?limit=5", token=creator_token)
    token_qs = urllib.parse.quote(creator_token, safe="")
    stream = request("GET", f"/notifications/stream?token={token_qs}&limit=5")
    report["checks"]["notificationSession"] = {
        "meStatus": notif_me.status,
        "summaryStatus": notif_summary.status,
        "listStatus": notif_list.status,
        "streamStatus": stream.status,
        "notificationCount": len(notif_list.body.get("notifications", [])),
    }

    print_json("REPORT", report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
