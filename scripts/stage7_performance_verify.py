from __future__ import annotations

import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8510/api/v1"
ADMIN_EMAIL = "admin@moaworks.local"
ADMIN_PASSWORD = "ChangeMe123!"
USER_EMAIL = "stage4.writer.1782093397@moaworks.local"
USER_PASSWORD = "Stage4Writer!23"


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


def login(email: str, password: str) -> str:
    status, body = request("POST", "/auth/login", {"email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"login failed: {status} {body}")
    return body["accessToken"]


def benchmark_case(name: str, requests_count: int, concurrency: int, task):
    latencies: list[float] = []
    failures: list[dict] = []
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(task, index) for index in range(requests_count)]
        for future in as_completed(futures):
            duration_ms, ok, status = future.result()
            latencies.append(duration_ms)
            if not ok:
                failures.append({"status": status, "durationMs": duration_ms})
    elapsed_ms = (time.perf_counter() - started) * 1000
    return {
        "name": name,
        "requests": requests_count,
        "concurrency": concurrency,
        "averageMs": round(statistics.mean(latencies), 2) if latencies else 0.0,
        "maxMs": round(max(latencies), 2) if latencies else 0.0,
        "minMs": round(min(latencies), 2) if latencies else 0.0,
        "elapsedMs": round(elapsed_ms, 2),
        "failureCount": len(failures),
        "failures": failures[:5],
    }


def timed_request(method: str, path: str, payload: dict | None = None, token: str | None = None):
    started = time.perf_counter()
    status, body = request(method, path, payload=payload, token=token)
    duration_ms = (time.perf_counter() - started) * 1000
    return duration_ms, 200 <= status < 300, status, body


def main() -> int:
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    user_token = login(USER_EMAIL, USER_PASSWORD)

    report: dict[str, object] = {
        "executedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": BASE_URL,
        "benchmarks": [],
    }

    report["benchmarks"].append(
        benchmark_case("health", 20, 5, lambda _: timed_request("GET", "/health")[:3])
    )
    report["benchmarks"].append(
        benchmark_case("admin_login", 10, 2, lambda _: timed_request("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})[:3])
    )
    report["benchmarks"].append(
        benchmark_case("user_login", 10, 2, lambda _: timed_request("POST", "/auth/login", {"email": USER_EMAIL, "password": USER_PASSWORD})[:3])
    )
    report["benchmarks"].append(
        benchmark_case("directory", 20, 5, lambda _: timed_request("GET", "/admin/directory", token=admin_token)[:3])
    )
    report["benchmarks"].append(
        benchmark_case("approvals_list", 20, 5, lambda _: timed_request("GET", "/approvals", token=user_token)[:3])
    )
    report["benchmarks"].append(
        benchmark_case("notifications_list", 20, 5, lambda _: timed_request("GET", "/notifications?limit=20", token=user_token)[:3])
    )

    approval_processing_results: list[dict[str, object]] = []
    for index in range(5):
        title = f"stage7 perf approval {int(time.time())}-{index}"
        started = time.perf_counter()
        create_duration, create_ok, create_status, create_body = timed_request(
            "POST",
            "/approvals",
            {
                "title": title,
                "content": "stage7 performance approval",
                "approverUserIds": [request("GET", "/auth/me", token=user_token)[1]["user"]["userId"]],
            },
            token=user_token,
        )
        document_id = create_body.get("documentId")
        submit_duration, submit_ok, submit_status, _submit_body = timed_request("POST", f"/approvals/{document_id}/submit", token=user_token)
        approve_duration, approve_ok, approve_status, _approve_body = timed_request(
            "POST",
            f"/approvals/{document_id}/approve",
            {"reason": "stage7 perf approve"},
            token=user_token,
        )
        total_duration = (time.perf_counter() - started) * 1000
        approval_processing_results.append(
            {
                "documentId": document_id,
                "createMs": round(create_duration, 2),
                "submitMs": round(submit_duration, 2),
                "approveMs": round(approve_duration, 2),
                "totalMs": round(total_duration, 2),
                "ok": create_ok and submit_ok and approve_ok,
                "statuses": [create_status, submit_status, approve_status],
            }
        )

    report["approvalProcessing"] = {
        "requests": len(approval_processing_results),
        "concurrency": 1,
        "averageMs": round(statistics.mean(item["approveMs"] for item in approval_processing_results), 2),
        "maxMs": round(max(item["approveMs"] for item in approval_processing_results), 2),
        "failureCount": sum(1 for item in approval_processing_results if not item["ok"]),
        "details": approval_processing_results,
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
