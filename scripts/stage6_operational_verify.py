from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8510/api/v1"
ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "ChangeMe123!"
USER_EMAIL = "stage4.writer.1782093397@moaworks.local"
USER_PASSWORD = "Stage4Writer!23"
ROOT = Path(__file__).resolve().parents[1]


def request(method: str, path: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return response.status, {}
            try:
                return response.status, json.loads(raw)
            except json.JSONDecodeError:
                return response.status, {"rawText": raw}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        return exc.code, json.loads(raw) if raw else {}


def run(*args: str) -> str:
    completed = subprocess.run(args, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def psql_value(sql: str) -> str:
    return run(
        "docker",
        "exec",
        "deploy-postgres-1",
        "psql",
        "-U",
        "moaworks",
        "-d",
        "moaworks",
        "-t",
        "-A",
        "-c",
        sql,
    )


def main() -> int:
    report: dict[str, object] = {
        "executedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": BASE_URL,
        "checks": {},
    }

    health_status, health_body = request("GET", "/health")
    report["checks"]["health"] = {
        "status": health_status,
        "initialized": health_body.get("initialized"),
        "overall": health_body.get("status"),
    }

    admin_status, admin_login = request("POST", "/auth/login", {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    })
    if admin_status != 200:
        report["checks"]["adminLogin"] = {"status": admin_status, "body": admin_login}
        print(json.dumps(report, ensure_ascii=True))
        return 1
    admin_token = admin_login["accessToken"]
    report["checks"]["adminLogin"] = {"status": admin_status, "userEmail": admin_login["user"]["userEmail"]}

    user_status, user_login = request("POST", "/auth/login", {
        "email": USER_EMAIL,
        "password": USER_PASSWORD,
    })
    if user_status != 200:
        report["checks"]["userLogin"] = {"status": user_status, "body": user_login}
        print(json.dumps(report, ensure_ascii=True))
        return 1
    user_token = user_login["accessToken"]
    report["checks"]["userLogin"] = {"status": user_status, "userEmail": user_login["user"]["userEmail"]}

    directory_status, directory_body = request("GET", "/admin/directory", token=admin_token)
    mail_provider = directory_body.get("mailProvider", {}) if isinstance(directory_body, dict) else {}
    report["checks"]["directoryExposure"] = {
        "status": directory_status,
        "hasEncryptedPasswordField": "encryptedPassword" in mail_provider,
        "mailProviderKeys": sorted(mail_provider.keys()),
    }

    disabled_policy_status, disabled_policy = request("PATCH", "/translation/admin", {
        "enabled": False,
        "provider": "disabled",
        "cacheEnabled": True,
    }, token=admin_token)
    disabled_status_status, disabled_status = request("GET", "/translation/status")
    disabled_translate_status, disabled_translate = request("POST", "/translation/translate", {
        "texts": [{
            "text": "مرحبا من MoaWorks",
            "sourceLocale": "ko",
            "targetLocale": "en",
        }],
        "includeSource": True,
        "useCache": True,
    }, token=user_token)
    approvals_status, approvals_body = request("GET", "/approvals", token=user_token)
    notifications_status, notifications_body = request("GET", "/notifications?limit=5", token=user_token)
    summary_status, _summary_body = request("GET", "/notifications/summary", token=user_token)
    stream_status, stream_body = request("GET", f"/notifications/stream?token={user_token}&limit=5")

    report["checks"]["translationDisabled"] = {
        "policyStatus": disabled_policy_status,
        "statusStatus": disabled_status_status,
        "provider": disabled_status.get("provider"),
        "available": disabled_status.get("available"),
        "enabled": disabled_status.get("enabled"),
        "translateStatus": disabled_translate_status,
        "fallbackUsed": disabled_translate.get("fallbackUsed"),
        "translated": disabled_translate.get("items", [{}])[0].get("translated") if isinstance(disabled_translate.get("items"), list) and disabled_translate.get("items") else None,
        "translatedText": disabled_translate.get("items", [{}])[0].get("translatedText") if isinstance(disabled_translate.get("items"), list) and disabled_translate.get("items") else None,
        "approvalsStatus": approvals_status,
        "notificationsStatus": notifications_status,
        "summaryStatus": summary_status,
        "streamStatus": stream_status,
        "streamHasHeartbeat": "heartbeat" in str(stream_body.get("rawText", "")),
        "notificationCount": len(notifications_body.get("notifications", [])) if isinstance(notifications_body, dict) else None,
    }

    noop_policy_status, _noop_policy = request("PATCH", "/translation/admin", {
        "enabled": True,
        "provider": "noop",
        "cacheEnabled": True,
    }, token=admin_token)
    noop_status_status, noop_status = request("GET", "/translation/status")
    noop_translate_status, noop_translate = request("POST", "/translation/translate", {
        "texts": [{
            "text": "مرحبا من MoaWorks",
            "sourceLocale": "ko",
            "targetLocale": "en",
        }],
        "includeSource": True,
        "useCache": False,
    }, token=user_token)
    report["checks"]["translationNoop"] = {
        "policyStatus": noop_policy_status,
        "statusStatus": noop_status_status,
        "provider": noop_status.get("provider"),
        "available": noop_status.get("available"),
        "enabled": noop_status.get("enabled"),
        "translateStatus": noop_translate_status,
        "fallbackUsed": noop_translate.get("fallbackUsed"),
        "translatedText": noop_translate.get("items", [{}])[0].get("translatedText") if isinstance(noop_translate.get("items"), list) and noop_translate.get("items") else None,
    }

    # Restore disabled policy so runtime remains stable.
    request("PATCH", "/translation/admin", {
        "enabled": False,
        "provider": "disabled",
        "cacheEnabled": True,
    }, token=admin_token)

    password_hash = psql_value("SELECT password_hash FROM users WHERE email = 'admin@moaworks.local' LIMIT 1;")
    encrypted_relay = psql_value("SELECT encrypted_password FROM mail_provider_configs ORDER BY updated_at DESC LIMIT 1;")
    setup_state_path = ROOT / "data" / "runtime" / "setup-state.json"
    setup_state = json.loads(setup_state_path.read_text(encoding="utf-8")) if setup_state_path.exists() else {}
    setup_admin_user = setup_state.get("admin_user", {})
    setup_mail_provider = setup_state.get("mail_provider", {})
    setup_db_config = setup_state.get("db_config", {})

    report["checks"]["security"] = {
        "passwordHashPrefix": password_hash.split("$", 1)[0] if password_hash else "",
        "passwordHashLooksHashed": password_hash.startswith("scrypt$"),
        "relayCipherPrefix": encrypted_relay[:12],
        "relayCipherLooksEncrypted": encrypted_relay.startswith("gAAAA"),
        "setupAdminHasPlainPasswordKey": "password" in setup_admin_user,
        "setupAdminHasPasswordHash": "password_hash" in setup_admin_user,
        "setupMailHasPlainPasswordKey": "password" in setup_mail_provider,
        "setupMailHasEncryptedPassword": "encrypted_password" in setup_mail_provider,
        "setupDbHasPlainPasswordKey": "password" in setup_db_config,
        "setupDbHasEncryptedPassword": "encrypted_password" in setup_db_config,
    }

    print(json.dumps(report, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
