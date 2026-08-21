from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app.services.postgres_service import PostgresService

BASE_URL = "http://127.0.0.1:8510/api/v1"
ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "m@68150183"
EVIDENCE_DIR = Path(__file__).resolve().parents[1] / "tmp" / "self-hosted-smtp-20260708"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
EVIDENCE_PATH = EVIDENCE_DIR / "backend-smoke.json"


def request_json(path: str, *, method: str = "GET", token: str | None = None, payload: dict | None = None) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        return exc.code, data


def run() -> int:
    db = PostgresService()
    db.ensure_migrations_applied()

    results: dict[str, object] = {"checkedAt": datetime.now().isoformat()}

    with db.connect() as connection:
        with connection.cursor() as cursor:
            tables = [
                "mail_delivery_providers",
                "mail_delivery_queue",
                "mail_delivery_attempts",
                "mail_delivery_events",
            ]
            cursor.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(%s)",
                (tables,),
            )
            existing = sorted(row["table_name"] for row in cursor.fetchall())
            results["tables"] = existing

    login_status, login_data = request_json(
        "/auth/login",
        method="POST",
        payload={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    results["login"] = {"status": login_status, "user": login_data.get("user", {}).get("userEmail")}
    if login_status != 200:
        EVIDENCE_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("FAIL: login")
        return 1

    token = login_data["accessToken"]

    internal_status, internal_send = request_json(
        "/mail/send",
        method="POST",
        token=token,
        payload={"to": [ADMIN_EMAIL], "subject": "SMTP 내부 발송 유지", "bodyText": "internal send smoke"},
    )
    results["internalSend"] = {
        "status": internal_status,
        "mailId": internal_send.get("mailId"),
        "deliverySummary": internal_send.get("deliverySummary"),
    }

    external_status, external_send = request_json(
        "/mail/send",
        method="POST",
        token=token,
        payload={"to": ["external-smoke@example.com"], "subject": "SMTP 외부 큐 테스트", "bodyText": "external send smoke"},
    )
    results["externalSend"] = {
        "status": external_status,
        "mailId": external_send.get("mailId"),
        "deliverySummary": external_send.get("deliverySummary"),
    }

    status_code, delivery_status = request_json("/mail/delivery/status", token=token)
    queue_code, delivery_queue = request_json("/mail/delivery/queue", token=token)
    retry_result = None
    if isinstance(delivery_queue, dict):
        external_queue = next((item for item in delivery_queue.get("queue", []) if item.get("mailId") == external_send.get("mailId")), None)
        if external_queue:
            retry_status, retry_body = request_json(f"/mail/delivery/{external_queue['queueId']}/retry", method="POST", token=token)
            retry_result = {"status": retry_status, "body": retry_body}
            queue_code, delivery_queue = request_json("/mail/delivery/queue", token=token)
            status_code, delivery_status = request_json("/mail/delivery/status", token=token)
    results["deliveryStatusApi"] = {"status": status_code, "body": delivery_status}
    results["deliveryQueueApi"] = {
        "status": queue_code,
        "queueCount": len(delivery_queue.get("queue", [])) if isinstance(delivery_queue, dict) else None,
        "eventCount": len(delivery_queue.get("events", [])) if isinstance(delivery_queue, dict) else None,
        "retry": retry_result,
    }

    external_mail_id = external_send.get("mailId")
    if external_mail_id:
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id, status, attempt_count, last_error, recipient_email FROM mail_delivery_queue WHERE mail_id = %s ORDER BY created_at DESC",
                    (external_mail_id,),
                )
                queue_rows = cursor.fetchall()
                queue_ids = [row["id"] for row in queue_rows]
                cursor.execute(
                    "SELECT queue_id, status, error_message FROM mail_delivery_attempts WHERE queue_id = ANY(%s) ORDER BY attempted_at DESC",
                    (queue_ids or [""],),
                )
                attempts = cursor.fetchall() if queue_ids else []
                cursor.execute(
                    "SELECT queue_id, event_type, message FROM mail_delivery_events WHERE queue_id = ANY(%s) ORDER BY created_at DESC",
                    (queue_ids or [""],),
                )
                events = cursor.fetchall() if queue_ids else []
        results["dbQueueRows"] = queue_rows
        results["dbAttempts"] = attempts
        results["dbEvents"] = events

    EVIDENCE_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    tables_ok = set(results.get("tables", [])) == {
        "mail_delivery_providers",
        "mail_delivery_queue",
        "mail_delivery_attempts",
        "mail_delivery_events",
    }
    internal_ok = internal_status == 200
    external_ok = external_status == 200
    queue_ok = bool(results.get("dbQueueRows"))
    event_ok = bool(results.get("dbEvents"))

    if tables_ok and internal_ok and external_ok and queue_ok and event_ok:
        print("PASS: self_hosted_smtp_smoke_test")
        return 0

    print("FAIL: self_hosted_smtp_smoke_test")
    return 1


if __name__ == "__main__":
    raise SystemExit(run())
