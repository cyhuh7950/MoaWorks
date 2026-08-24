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

## 어울1 독립 검증

- focused auth+schedule 15/15 PASS, 전체 모바일 67/67 PASS를 HEAD `736ca33`에서 새로 실행했다.
- production bundle exit 0, SHA256 `6d8ea77f14cd34239aaa453a9e8549dd279300ca84bbb0fd3a8bb20af8cf357d`를 재확인했다.
- 권한 상승 환경에서 Android SDK/JDK 탐색이 정상화되어 `npm run build:android`가 `BUILD SUCCESSFUL in 1m 29s`, 64 actionable tasks로 완료됐다.
- release APK는 59,173,802 bytes, SHA256 `0FEE00957BBF5098DBE2CE4181B0856E1F81F7C22112C03BE031238FDB941866`이다.
- `emulator-5554`에 streamed install `Success`, `com.moaworks.mobile/.MainActivity` cold launch와 로그인 화면·접근성 XML을 확인했다.
- 실제 운영 계정이 없어 로그인 이후 일정 조회·생성과 일정 화면은 미검증으로 분리한다. 운영 데이터는 생성하지 않았다.

## 최종 잔여 수정

### 판정

`PASS` — 공용 422 오류를 중립으로 유지하고, 일정 화면 빈 상태를 현재 표시 월 기준으로 보정했다.

### RED/GREEN 및 실제 증적

- RED: `node --test test/mobile-f13-schedule-api-contract.test.js`에서 공용 배열 detail의 일정 전용 문구 2건과 다른 월 일정이 있을 때의 빈 상태 wiring 1건이 실패했다.
- GREEN: focused auth+schedule 17/17 PASS, 전체 `npm test` 69/69 PASS.
- bundle: 권한 상승 `npm run bundle` 성공, `BUNDLE_SHA256=e5c37ffe7f3f3583c25d21da9bbb3329c8d5d83f1a0ce08f4819aa443647fc71`.
- Android build/evidence는 지시대로 재실행하지 않았다. 실제 운영 API 호출·데이터 생성·배포도 수행하지 않았다.
