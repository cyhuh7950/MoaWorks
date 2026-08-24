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
