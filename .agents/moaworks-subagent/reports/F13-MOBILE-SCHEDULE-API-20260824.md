# F13 모바일 일정 실제 API 연결

## 판정

`PARTIAL_PASS` — 코드와 집중 계약은 GREEN이다. 실제 운영 호출·데이터 생성·배포는 수행하지 않았다.

## 조치 및 증적

- RED: `node --test test/mobile-f13-schedule-api-contract.test.js`는 `schedule-api.js` 부재로 실패했다.
- GREEN: 월 grid, 현재 월 필터, 기본 owned 달력, 생성 payload 검증이 3/3 통과했다.
- App은 `GET /workspace/calendars`, `GET /workspace/schedules`, `POST /workspace/schedules`를 현재 세션 context로 호출한다. 401/403·로그아웃 reset은 calendars/schedules/form/error까지 중앙 초기화한다.
- 집중 auth+schedule 계약은 12/12 통과했고 `git diff --check` 및 변경 범위 정적 검색도 통과했다.

## 미검증

- 전체 `npm test`는 로컬 `@babel/core`, `@babel/parser` 부재의 기존 환경 의존성으로 59/64였으며, 새 일정 계약은 통과했다.
- bundle은 build-evidence 로그 파일 EPERM으로 중단됐고, Android release는 `ANDROID_SDK_MISSING`으로 BLOCKED다. Android/운영 API/생성/실기기 검증은 실행하지 않았다.

## 재작업 3

- schedules 응답은 `items`만 읽고, alertMinutes 기본값은 `[10]`으로 수정했다.
- timezone `dateKey` 월 경계와 POST mutex를 보완했고 `npm test`는 64/64 PASS다.

## 최종 재작업

### 판정

`PASS` — 승인된 모바일 client wiring의 merge-blocker를 production helper와 App 경로로 보완했다. 운영 API 호출·데이터 생성·배포는 수행하지 않았다.

### 판단 이유

- 표시 월은 앱 timezone `dateKey`에서 만든 `YYYY-MM` key이며, UTC anchor 기반 이동·grid·필터가 같은 key를 쓴다. 서울 월 경계(`2026-08-31T15:30:00Z`) 계약을 포함한다.
- App의 schedules reader는 `{ items }`만 적용한다. production submission gate는 state 반영 전 재진입을 차단하고, 중앙 reset이 gate와 saving 상태를 해제한다. stale finally는 현재 session context일 때만 gate/state를 해제한다.
- `requestJson`은 FastAPI 배열 `detail`을 오류에 보존하며, 일정 오류 문구가 해당 validation 메시지를 표시한다.

### 조치 및 실제 증적

- RED: `node --test test/mobile-f13-schedule-api-contract.test.js`에서 month helper, submission gate, FastAPI 422 detail 계약 3건이 실패했다.
- GREEN: `node --test test/mobile-f13-schedule-api-contract.test.js test/mobile-f13-auth-session-contract.test.js` 15/15 PASS.
- 전체: `npm test` 67/67 PASS.
- bundle: `npm run bundle` exit 0 (Metro v0.80.12 출력).
- Android: `npm run build:android`은 `STATUS=blocked`, `BLOCKER=ANDROID_SDK_MISSING`으로 종료했다.

### 미검증

- Android release APK/실기기 및 실제 운영 API 호출·일정 생성은 범위 밖 또는 SDK 부재로 미실행이다.

### 최종 bundle 재실행

- 일반 sandbox 실행의 build-evidence EPERM은 권한 상승 재실행으로 해소했다. `npm run bundle` exit 0, `BUNDLE_SHA256=6d8ea77f14cd34239aaa453a9e8549dd279300ca84bbb0fd3a8bb20af8cf357d`.
