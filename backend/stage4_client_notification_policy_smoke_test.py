from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent



def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def _load(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _find_int(text: str, pattern: str, name: str, *, required: bool = True) -> int:
    match = re.search(pattern, text, re.MULTILINE)
    if not match:
        if required:
            raise AssertionError(f"{name} 을(를) 찾지 못했습니다.")
        return 0
    return int(match.group(1))


def _check_user_web() -> tuple[dict[str, int], dict[str, str]]:
    path = PROJECT_ROOT / "frontend" / "user-web" / "src" / "App.tsx"
    text = _load(path)
    api_text = _load(PROJECT_ROOT / "frontend" / "user-web" / "src" / "api.ts")

    retry_max = _find_int(text, r"retryMaxAttempts\s*:\s*(\d+)", "user-web.retryMaxAttempts")
    retry_delay = _find_int(text, r"retryDelayMs\s*:\s*(\d+)", "user-web.retryDelayMs")
    stream_retry_max = _find_int(text, r"streamRetryMax\s*:\s*(\d+)", "user-web.streamRetryMax")
    stream_retry_delay = _find_int(text, r"streamReconnectDelayMs\s*:\s*(\d+)", "user-web.streamReconnectDelayMs")

    _assert(retry_max == 3, "user-web: 재시도 상한이 3이 아닙니다.")
    _assert(retry_delay == 400, "user-web: 재시도 지연이 400ms가 아닙니다.")
    _assert(stream_retry_max == 2, "user-web: SSE 재접속 횟수 정책이 2가 아닙니다.")
    _assert(stream_retry_delay == 600, "user-web: SSE 재접속 딜레이가 600ms가 아닙니다.")
    _assert("setNotificationMode(\"fallback\")" in text, "user-web: fallback 모드 표시가 없습니다.")
    _assert("polling" in text, "user-web: polling 모드 문자열이 없습니다.")
    _assert("streammeta" in text, "user-web: stream 메타 이벤트 처리(재요청 기준)가 없습니다.")
    _assert("fetchNotificationStream" in text and "fetchNotificationStream" in api_text, "user-web: fetch streaming 소비자가 없습니다.")
    _assert("Authorization" in api_text and "authHeaders(token)" in api_text, "user-web: Bearer 헤더 스트림 계약이 없습니다.")
    _assert("AbortController" in text and "signal: controller.signal" in text, "user-web: 스트림 중단 계약이 없습니다.")
    _assert("streammeta" in text and "heartbeat" in text, "user-web: SSE event 파싱 계약이 없습니다.")
    _assert("stream fallback" in text, "user-web: stream fallback 시그널 처리 문구가 없습니다.")
    _assert(".catch(() =>" in text and "scheduleReconnect" in text, "user-web: 스트림 에러 재접속 분기가 없습니다.")
    _assert("EventSource" not in text and "/notifications/stream?token=" not in api_text, "user-web: query-token EventSource 소비자가 남아 있습니다.")

    policy = {
        "retryMaxAttempts": retry_max,
        "retryDelayMs": retry_delay,
        "streamRetryMax": stream_retry_max,
        "streamReconnectDelayMs": stream_retry_delay,
    }
    policy_note = {
        "fallback_mode": "setFallback",
        "realtime_policy": "sse+polling_fallback",
    }
    return policy, policy_note


def _check_desktop_client() -> tuple[dict[str, int], dict[str, str]]:
    path = PROJECT_ROOT / "frontend" / "desktop-client" / "index.html"
    text = _load(path)

    retry_max = _find_int(text, r"retryMax\s*:\s*(\d+)", "desktop-client.retryMax")
    retry_delay = _find_int(text, r"retryDelayMs\s*:\s*(\d+)", "desktop-client.retryDelayMs")
    stream_retry_max = _find_int(text, r"streamRetryMax\s*:\s*(\d+)", "desktop-client.streamRetryMax")
    stream_retry_delay = _find_int(text, r"streamRetryDelayMs\s*:\s*(\d+)", "desktop-client.streamRetryDelayMs")

    _assert("const notificationPolicy = {" in text, "desktop-client: 정책 상수 블록이 없습니다.")
    _assert(retry_max == 3, "desktop-client: 재시도 상한이 3이 아닙니다.")
    _assert(retry_delay == 400, "desktop-client: 재시도 지연이 400ms가 아닙니다.")
    _assert(stream_retry_max == 2, "desktop-client: SSE 재접속 횟수 정책이 2가 아닙니다.")
    _assert(stream_retry_delay == 600, "desktop-client: SSE 재접속 딜레이가 600ms가 아닙니다.")
    _assert("setNotificationMode(\"fallback\")" in text, "desktop-client: fallback 모드 표시가 없습니다.")
    _assert("SSE 오류 감지로 폴링 폴백 동작 중" in text, "desktop-client: 폴백 안내 문구가 없습니다.")
    _assert("EventSource" not in text, "desktop-client: EventSource 소비자가 남아 있습니다.")
    _assert("/notifications/stream?token=" not in text, "desktop-client: query-token 스트림 URL이 남아 있습니다.")
    _assert("fetch(streamUrl" in text and "headers: authHeaders()" in text and "Authorization" in text, "desktop-client: Bearer fetch streaming 계약이 없습니다.")
    _assert("AbortController" in text and "streamAbortController" in text, "desktop-client: 스트림 중단 계약이 없습니다.")
    _assert("response.body.getReader()" in text and "TextDecoder" in text, "desktop-client: 스트림 chunk 소비 계약이 없습니다.")
    _assert("streammeta" in text and "streamCursor" in text, "desktop-client: cursor 연속성 계약이 없습니다.")
    _assert("beforeunload" in text and "stopNotificationStream" in text, "desktop-client: 창 종료 abort 계약이 없습니다.")
    _assert("scheduleNotificationStreamReconnect" in text, "desktop-client: 스트림 에러 재접속 분기가 없습니다.")
    _assert("streamRetryMax" in text, "desktop-client: streamRetryMax 재사용 지점이 없습니다.")

    policy = {
        "retryMax": retry_max,
        "retryDelayMs": retry_delay,
        "streamRetryMax": stream_retry_max,
        "streamRetryDelayMs": stream_retry_delay,
    }
    policy_note = {
        "fallback_mode": "setFallback",
        "realtime_policy": "sse+polling_fallback",
    }
    return policy, policy_note


def _check_mobile() -> tuple[dict[str, int], dict[str, str]]:
    path = PROJECT_ROOT / "frontend" / "mobile-app" / "App.tsx"
    text = _load(path)

    retry_max = _find_int(text, r"retryMax\s*:\s*(\d+)", "mobile-app.retryMax")
    retry_delay = _find_int(text, r"retryDelayMs\s*:\s*(\d+)", "mobile-app.retryDelayMs")

    _assert("notificationPolicy = {" in text, "mobile-app: 정책 상수 객체가 없습니다.")
    _assert(retry_max == 3, "mobile-app: 재시도 상한이 3이 아닙니다.")
    _assert(retry_delay == 400, "mobile-app: 재시도 지연이 400ms가 아닙니다.")
    _assert("알림 조회 실패" in text, "mobile-app: 네트워크 재시도 실패 안내가 없습니다.")
    _assert("알림 새로고침" in text and "refreshNotifications" in text, "mobile-app: 수동 알림 재조회 액션이 없습니다.")
    _assert("EventSource" not in text, "mobile-app: SSE 구현은 없어야 합니다.")
    _assert(r"retryWithBackOff\(" not in text, "mobile-app: 재시도 핸들러명이 변경되어 분석 규칙과 충돌합니다.")

    _assert("polling" in text, "mobile-app: 폴링 정책 안내 문자열이 없습니다.")
    _assert("notificationPolicy = {" in text, "mobile-app: 정책 상수 블록이 없습니다.")

    policy = {
        "retryMax": retry_max,
        "retryDelayMs": retry_delay,
    }
    policy_note = {
        "fallback_mode": "polling",
        "realtime_policy": "polling_only",
    }
    return policy, policy_note


def _check_backend_stream_route() -> None:
    path = PROJECT_ROOT / "backend" / "app" / "api" / "routes" / "notifications.py"
    text = _load(path)
    _assert("def stream_notifications" in text, "backend: stream_notifications 함수가 없습니다.")
    _assert("/stream" in text, "backend: /stream 라우트 정의가 없습니다.")
    _assert("@router.get(\"/{notification_id}\"" in text, "backend: 상세 알림 라우트가 없습니다.")
    _assert("media_type=\"text/event-stream\"" in text, "backend: SSE content-type이 text/event-stream가 아닙니다.")
    _assert("event: streammeta" in text, "backend: stream 메타 이벤트 전송이 없습니다.")
    _assert("event: heartbeat" in text, "backend: heartbeat 이벤트 생성이 없습니다.")
    _assert("fallback" in text, "backend: stream fallback 하네들링 문자열이 없습니다.")


def _validate_cross_client_parity(user_policy: dict[str, int], desktop_policy: dict[str, int], mobile_policy: dict[str, int]) -> None:
    # 공통 재시도 정책
    _assert(user_policy["retryMaxAttempts"] == 3, "user-web: retryMaxAttempts가 3이 아닙니다.")
    _assert(desktop_policy["retryMax"] == 3, "desktop-client: retryMax가 3이 아닙니다.")
    _assert(mobile_policy["retryMax"] == 3, "mobile-app: retryMax가 3이 아닙니다.")

    _assert(user_policy["retryDelayMs"] == 400, "user-web retryDelayMs가 400이 아닙니다.")
    _assert(desktop_policy["retryDelayMs"] == 400, "desktop-client retryDelayMs가 400이 아닙니다.")
    _assert(mobile_policy["retryDelayMs"] == 400, "mobile-app retryDelayMs가 400이 아닙니다.")

    _assert(user_policy["streamRetryMax"] == 2, "user-web streamRetryMax가 2가 아닙니다.")
    _assert(desktop_policy["streamRetryMax"] == 2, "desktop-client streamRetryMax가 2가 아닙니다.")

    _assert(user_policy["streamReconnectDelayMs"] == 600, "user-web streamReconnectDelayMs가 600이 아닙니다.")
    _assert(desktop_policy["streamRetryDelayMs"] == 600, "desktop-client streamRetryDelayMs가 600이 아닙니다.")



def main() -> None:
    _check_backend_stream_route()

    user_policy, user_note = _check_user_web()
    desktop_policy, desktop_note = _check_desktop_client()
    mobile_policy, mobile_note = _check_mobile()
    _validate_cross_client_parity(user_policy, desktop_policy, mobile_policy)

    print("PASS: phase-4 2차 클라이언트 알림 정책 정합성 정적 스크립트 + 장애 동작 정합성 규칙 통과")
    print("- 공통 장애 대응 정책:", {
        "user": {**user_policy, **user_note},
        "desktop": {**desktop_policy, **desktop_note},
        "mobile": {**mobile_policy, **mobile_note},
    })


if __name__ == "__main__":
    main()
