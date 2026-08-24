# F13 모바일 개인 AI

## 판정

`완료`

## 판단 이유

- 작업지시서: `docs/workorders/f13-mobile-personal-ai-2026-08-24.md`
- 작업 목적: 모바일 placeholder 개인 AI를 승인된 서버 proxy 계약의 Provider catalog/config/test/chat 흐름으로 교체한다.
- 수정 파일: `frontend/mobile-app/App.tsx`, `auth-session.js`, `personal-ai-api.js`, `metro.config.js`, `test/mobile-f13-auth-session-contract.test.js`, `test/mobile-f13-personal-ai-contract.test.js`, `test/mobile-build-contract.test.js` 및 이 보고서·result·두 progress JSONL.
- 변경 결과: server lowercase catalog만 사용하며 client endpoint 입력을 제거했다. config/test/chat 응답과 오류는 capture한 current session에서만 반영한다. `/test`의 `success=true`와 `connectionStatus=ready`가 동시에 확인된 현재 세션에서만 chat을 허용한다.
- 키 안전: API key draft는 저장 시도 직전에 성공·실패와 무관하게 폐기하며, Provider 변경·logout/session invalidation에서도 즉시 폐기한다. 키는 저장·로그·응답 상태로 복원하지 않는다.
- 상태 안전: 개인 AI action gate는 중복 동작을 막고 reset 이후 늦은 release가 새 작업을 해제하지 못한다. logout/session invalidation은 config/chat/error/pending/dirty/readiness 상태를 모두 초기화한다. local 설정 편집 중 `/test`와 server reload를 차단하고 save 성공 후에만 dirty를 해제한다.
- 빌드 및 실행 결과: focused 17/17 PASS, 전체 `npm test` 84/84 PASS, production bundle PASS, Android release `BUILD SUCCESSFUL`(64 tasks), `emulator-5554` install `Success`, `LaunchState: COLD`, `MainActivity` top resumed.
- bundle SHA-256: `212f2f8770d09ff8ec572f4aecbd4266f8b6349dca8af14de8c508e04df81852`.
- APK SHA-256: `13B13C04CE4DBAD28998530F4D7A6927508C8BA2A95A9C8B81F730F8980E399E`.
- 실제 화면 및 기능 확인: release APK의 로그인 화면 cold launch와 MainActivity resumed 상태를 확인했다. 실제 인증 후 개인 AI 화면 동작은 운영 계정·Provider 호출 금지 범위라 확인하지 않았다.
- API 및 DB 확인: 모바일 helper와 request wiring 계약만 확인했다. 실제 external Provider, live account/API, 운영 DB 호출은 하지 않았다.
- 확인함: current-generation guard, stale response/error 차단, key draft 폐기, server catalog only, malformed response 안전 오류, message 20개·개별 8,000자·합계 32,000자 제한, bundle, Android release/install/cold launch.
- 미확인: 실제 external Provider 호출, 실제 live/운영 인증 계정의 config/test/chat, iOS build/device, 배포.
- 남은 문제: 승인 범위의 코드 문제 없음. 운영·외부·iOS 검증은 별도 승인 환경에서 수행해야 한다.
- 독립 리뷰: 초기 `Critical 0 / Important 2 / Minor 0`; readiness·dirty 보완 뒤 화면 이동 회귀 1건과 Provider 변경 key draft 교차 전송 1건을 추가 수정했다. 최종 `Critical 0 / Important 0 / Minor 0`, Ready Yes.
- 오류 횟수: 환경·도구 오류 8회. Metro junction resolver 2회, WinGet `rg.exe` launcher 2회, 샌드박스/권한 계열 3회(서로 다른 경로·동작), patch context 불일치 1회. 동일한 구체 근본 원인의 연속 3회는 없었고 최대 반복은 2회였다. TDD 의도 RED는 오류 횟수에서 제외했다.

## 조치

- 완료: 후속 조치는 실제 운영 로그인 계정·외부 Provider·iOS 환경에서의 별도 검증뿐이다.
- backend/iOS는 수정하지 않았고 merge/push/deploy도 수행하지 않았다.
