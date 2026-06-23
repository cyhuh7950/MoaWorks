from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8510/api/v1"
ROOT = Path(__file__).resolve().parents[1]
DEPLOY_COMPOSE = ROOT / "deploy" / "docker-compose.yml"

ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "ChangeMe123!"


def request(method: str, path: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        return exc.code, json.loads(raw) if raw else {}


def run(*args: str) -> str:
    completed = subprocess.run(args, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def http_status(url: str) -> int:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.status


def psql_value(sql: str, db_name: str = "moaworks") -> str:
    return run(
        "docker",
        "exec",
        "deploy-postgres-1",
        "psql",
        "-U",
        "moaworks",
        "-d",
        db_name,
        "-t",
        "-A",
        "-c",
        sql,
    )


def poll(predicate, timeout_sec: float = 8.0, interval_sec: float = 0.5):
    started = time.monotonic()
    last_value = None
    while time.monotonic() - started <= timeout_sec:
        last_value = predicate()
        if last_value:
            return last_value
        time.sleep(interval_sec)
    return last_value


def main() -> int:
    suffix = str(int(time.time()))
    requester_email = f"stage7.requester.{suffix}@moaworks.local"
    approver_email = f"stage7.approver.{suffix}@moaworks.local"
    requester_password = "Stage7Requester!23"
    approver_password = "Stage7Approver!23"

    report: dict[str, object] = {
        "executedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": BASE_URL,
        "created": {},
        "adminScenario": {},
        "userScenario": {},
        "linkageScenario": {},
        "postgres": {},
        "restart": {},
        "translationFallback": {},
    }

    health_status, health_body = request("GET", "/health")
    report["adminScenario"]["health"] = {
        "status": health_status,
        "body": health_body,
    }

    admin_login_status, admin_login = request("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if admin_login_status != 200:
        report["adminScenario"]["login"] = {"status": admin_login_status, "body": admin_login}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1
    admin_token = admin_login["accessToken"]
    report["adminScenario"]["login"] = {"status": admin_login_status, "user": admin_login["user"]["userEmail"]}

    admin_relogin_status, _admin_relogin = request("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    directory_status, directory = request("GET", "/admin/directory", token=admin_token)
    overview_status, overview = request("GET", "/admin/monitoring/overview", token=admin_token)
    events_status, events = request("GET", "/admin/monitoring/events", token=admin_token)
    translation_status_code, translation_status = request("GET", "/translation/status")
    report["adminScenario"].update(
        {
            "reloginStatus": admin_relogin_status,
            "directoryStatus": directory_status,
            "overviewStatus": overview_status,
            "eventsStatus": events_status,
            "translationStatusCode": translation_status_code,
            "translationStatus": translation_status,
        }
    )

    department_id = directory["departments"][0]["id"]

    requester_role_status, requester_role = request(
        "POST",
        "/admin/roles",
        {
            "name": f"Stage7 Requester {suffix}",
            "permissions": [
                "mail:read",
                "profile:read",
                "approval:read",
                "approval:create",
                "approval:submit",
                "approval:withdraw",
                "approval:rework",
            ],
        },
        token=admin_token,
    )
    approver_role_status, approver_role = request(
        "POST",
        "/admin/roles",
        {
            "name": f"Stage7 Approver {suffix}",
            "permissions": [
                "mail:read",
                "profile:read",
                "approval:read",
                "approval:act",
            ],
        },
        token=admin_token,
    )
    if requester_role_status != 200 or approver_role_status != 200:
        report["created"]["roles"] = {
            "requesterRoleStatus": requester_role_status,
            "requesterRole": requester_role,
            "approverRoleStatus": approver_role_status,
            "approverRole": approver_role,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    requester_user_status, requester_user = request(
        "POST",
        "/admin/users",
        {
            "name": f"Stage7 Requester {suffix}",
            "email": requester_email,
            "password": requester_password,
            "departmentId": department_id,
            "roleId": requester_role["id"],
            "status": "active",
            "userType": "user",
        },
        token=admin_token,
    )
    approver_user_status, approver_user = request(
        "POST",
        "/admin/users",
        {
            "name": f"Stage7 Approver {suffix}",
            "email": approver_email,
            "password": approver_password,
            "departmentId": department_id,
            "roleId": approver_role["id"],
            "status": "active",
            "userType": "user",
        },
        token=admin_token,
    )
    if requester_user_status != 200 or approver_user_status != 200:
        report["created"]["users"] = {
            "requesterUserStatus": requester_user_status,
            "requesterUser": requester_user,
            "approverUserStatus": approver_user_status,
            "approverUser": approver_user,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    report["created"] = {
        "requesterRoleId": requester_role["id"],
        "approverRoleId": approver_role["id"],
        "requesterUserId": requester_user["userId"],
        "approverUserId": approver_user["userId"],
        "requesterEmail": requester_email,
        "approverEmail": approver_email,
    }

    requester_login_status, requester_login = request("POST", "/auth/login", {"email": requester_email, "password": requester_password})
    approver_login_status, approver_login = request("POST", "/auth/login", {"email": approver_email, "password": approver_password})
    if requester_login_status != 200 or approver_login_status != 200:
        report["userScenario"]["login"] = {
            "requesterStatus": requester_login_status,
            "requesterBody": requester_login,
            "approverStatus": approver_login_status,
            "approverBody": approver_login,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    requester_token = requester_login["accessToken"]
    approver_token = approver_login["accessToken"]
    requester_me_status, requester_me = request("GET", "/auth/me", token=requester_token)

    create_status, create_body = request(
        "POST",
        "/approvals",
        {
            "title": f"stage7 integrated approval {suffix}",
            "content": "stage7 통합 검증 문서",
            "approverUserIds": [approver_user["userId"]],
        },
        token=requester_token,
    )
    document_id = create_body.get("documentId")
    submit_status, submit_body = request("POST", f"/approvals/{document_id}/submit", token=requester_token)

    approver_list = poll(lambda: request("GET", "/approvals", token=approver_token)[1], timeout_sec=6.0)
    approve_status, approve_body = request(
        "POST",
        f"/approvals/{document_id}/approve",
        {"reason": "stage7 approve"},
        token=approver_token,
    )

    requester_notifications = poll(
        lambda: request("GET", "/notifications?limit=20", token=requester_token)[1],
        timeout_sec=6.0,
    )
    requester_summary_status, requester_summary = request("GET", "/notifications/summary", token=requester_token)
    target_notification = None
    for item in requester_notifications.get("notifications", []):
        if item.get("resourceId") == document_id:
            target_notification = item
            break
    ack_status = None
    if target_notification:
        ack_status, _ack_body = request("POST", f"/notifications/{target_notification['notificationId']}/ack", token=requester_token)

    translate_status, translate_body = request(
        "POST",
        "/translation/translate",
        {
            "texts": [{"text": "stage7 translation fallback", "sourceLocale": "ko", "targetLocale": "en"}],
            "includeSource": True,
            "useCache": True,
        },
        token=requester_token,
    )

    audit_status, audit_logs = request("GET", f"/approvals/audit-logs?documentId={document_id}", token=admin_token)
    admin_events = request("GET", "/admin/monitoring/events?category=approval", token=admin_token)[1]
    matched_events = [item for item in admin_events.get("events", []) if item.get("resourceId") == document_id]

    report["userScenario"] = {
        "requesterLoginStatus": requester_login_status,
        "approverLoginStatus": approver_login_status,
        "requesterMeStatus": requester_me_status,
        "createStatus": create_status,
        "documentId": document_id,
        "submitStatus": submit_status,
        "submitDocumentStatus": submit_body.get("status"),
        "approverListHasDocument": any(item.get("id") == document_id for item in approver_list.get("documents", [])),
        "approveStatus": approve_status,
        "approveDocumentStatus": approve_body.get("status"),
        "notificationCount": len(requester_notifications.get("notifications", [])),
        "notificationMatchedDocument": target_notification is not None,
        "notificationAckStatus": ack_status,
        "summaryStatus": requester_summary_status,
        "summaryUnreadCount": requester_summary.get("unreadCount"),
        "auditStatus": audit_status,
        "auditLogCount": len(audit_logs.get("logs", [])),
        "monitoringApprovalEvents": len(matched_events),
    }
    report["translationFallback"] = {
        "status": translate_status,
        "fallbackUsed": translate_body.get("fallbackUsed"),
        "provider": translate_body.get("provider"),
        "translated": (translate_body.get("items") or [{}])[0].get("translated"),
        "translatedText": (translate_body.get("items") or [{}])[0].get("translatedText"),
    }

    deactivate_user_status, deactivate_user_body = request(
        "PATCH",
        f"/admin/users/{requester_user['userId']}",
        {"status": "inactive"},
        token=admin_token,
    )
    requester_me_after_block_status, requester_me_after_block = request("GET", "/auth/me", token=requester_token)
    requester_login_after_block_status, requester_login_after_block = request(
        "POST",
        "/auth/login",
        {"email": requester_email, "password": requester_password},
    )

    deactivate_role_status, deactivate_role_body = request(
        "PATCH",
        f"/admin/roles/{approver_role['id']}",
        {"status": "inactive"},
        token=admin_token,
    )
    approver_me_after_role_block_status, approver_me_after_role_block = request("GET", "/auth/me", token=approver_token)
    report["linkageScenario"] = {
        "deactivateUserStatus": deactivate_user_status,
        "deactivateUserResult": deactivate_user_body.get("status"),
        "blockedTokenStatus": requester_me_after_block_status,
        "blockedTokenCode": requester_me_after_block.get("code") or requester_me_after_block.get("detail", {}).get("code"),
        "blockedLoginStatus": requester_login_after_block_status,
        "blockedLoginCode": requester_login_after_block.get("code") or requester_login_after_block.get("detail", {}).get("code"),
        "deactivateRoleStatus": deactivate_role_status,
        "deactivateRoleResult": deactivate_role_body.get("status"),
        "roleBlockedTokenStatus": approver_me_after_role_block_status,
        "roleBlockedTokenCode": approver_me_after_role_block.get("code") or approver_me_after_role_block.get("detail", {}).get("code"),
        "auditLogCountForDocument": len(audit_logs.get("logs", [])),
        "monitoringEventCountForDocument": len(matched_events),
    }

    postgres_checks = {
        "companyCount": psql_value("SELECT COUNT(*) FROM companies;"),
        "userCount": psql_value("SELECT COUNT(*) FROM users;"),
        "approvalDocumentCount": psql_value("SELECT COUNT(*) FROM approval_documents;"),
        "requesterStatus": psql_value(f"SELECT status FROM users WHERE email = '{requester_email}';"),
        "approverRoleStatus": psql_value(f"SELECT status FROM roles WHERE id = '{approver_role['id']}';"),
        "documentStatus": psql_value(f"SELECT status FROM approval_documents WHERE id = '{document_id}';"),
        "auditCountForDocument": psql_value(f"SELECT COUNT(*) FROM audit_logs WHERE target_id = '{document_id}';"),
        "notificationsTable": psql_value("SELECT COALESCE(to_regclass('public.notifications')::text, '');"),
        "monitoringEventsTable": psql_value("SELECT COALESCE(to_regclass('public.monitoring_events')::text, '');"),
    }
    report["postgres"] = postgres_checks

    subprocess.run(
        ["docker-compose", "-f", str(DEPLOY_COMPOSE), "restart", "server", "admin-web", "user-web"],
        check=True,
        capture_output=True,
        text=True,
    )
    time.sleep(3)

    restart_health = poll(
        lambda: request("GET", "/health"),
        timeout_sec=20.0,
        interval_sec=1.0,
    )
    restart_admin_login = poll(
        lambda: request("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}),
        timeout_sec=20.0,
        interval_sec=1.0,
    )
    restart_user_web_status = poll(
        lambda: http_status("http://127.0.0.1:3520"),
        timeout_sec=20.0,
        interval_sec=1.0,
    )
    restart_admin_web_status = poll(
        lambda: http_status("http://127.0.0.1:3510"),
        timeout_sec=20.0,
        interval_sec=1.0,
    )
    restart_health_status, restart_health_body = restart_health if restart_health else (0, {})
    restart_admin_login_status = restart_admin_login[0] if restart_admin_login else 0
    report["restart"] = {
        "healthStatus": restart_health_status,
        "healthOverall": restart_health_body.get("status"),
        "healthInitialized": restart_health_body.get("initialized"),
        "adminReloginStatus": restart_admin_login_status,
        "adminWebStatus": restart_admin_web_status,
        "userWebStatus": restart_user_web_status,
        "requesterStillBlockedStatus": request("GET", "/auth/me", token=requester_token)[0],
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
