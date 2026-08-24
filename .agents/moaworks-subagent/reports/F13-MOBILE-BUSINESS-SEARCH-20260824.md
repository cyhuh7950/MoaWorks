# F13 모바일 업무 검색

## 판정

`완료`

## 판단 이유

- 작업지시서: `docs/workorders/f13-mobile-business-search-2026-08-24.md`
- 작업 목적: 모바일 업무 검색 placeholder를 현재 인증 session에서 이미 불러온 메일·결재·메신저 대화방·일정·주소록·파일 요약의 로컬 통합 검색으로 교체한다.
- 수정 파일: 승인 계획·작업지시·worker prompt, `frontend/mobile-app/App.tsx`, `auth-session.js`, 신규 `business-search.js`, 인증 reset 및 업무 검색 테스트, 이 보고서·result·두 progress JSONL을 포함한 cumulative 13개 파일이다.
- 변경 결과: Unicode NFKC·대소문자·공백 정규화, 모든 query token 일치, 6개 source의 명시적 허용 필드만 사용하는 고정 결과 shape, category/title 결정 정렬, 50건 제한, malformed record 무시를 구현했다. 상세 본문·인증 정보·개인 AI 설정·숨은 연결 정보는 색인하지 않는다.
- 상태 안전: query, 선택 결과, source warning을 새 로그인·로그아웃·401/403 session invalidation에서 초기화한다. source load 실패 경고에는 허용된 source 이름만 표시하며 내부 오류 내용은 포함하지 않는다.
- 화면과 이동: “현재 불러온 업무”와 서버 전체 이력 검색이 아니라는 범위를 명시하고, 접근성 검색 입력, category/전체 건수, no-query/no-result/partial 상태, 접근 가능한 결과 행을 제공한다. 메일과 대화방은 기존 보호 handler를 사용하고 나머지는 기존 화면으로만 이동한다.
- TDD: helper export RED `0/1` 후 GREEN `1/1`; 검색 행동 RED `1/4` 후 GREEN `4/4`; warning helper RED `3/5` 후 GREEN `5/5`; session reset RED `6/9` 후 GREEN `9/9`; App 계약 RED `0/4` 후 GREEN `4/4`를 확인했다.
- 빌드 및 실행 결과: focused `18/18`, 전체 `npm test` `93/93`, production bundle, Android release 64 tasks, emulator install/cold launch가 통과했다.
- bundle SHA-256: `740746fa605b991e5c70c82992b91702cc4b0749286a529a0c1ede2a28e48ee4`.
- APK: 59,185,345 bytes, SHA-256 `96E0B1A17A7D6F10BE0AECA009C4A72A50F288095C904A6F236D301B4596524B`.
- 실제 화면 및 기능 확인: release APK를 `emulator-5554`에 streamed install하고 `LaunchState: COLD`, `MainActivity` resumed, 로그인 UI 노출을 확인했다. 실제 인증 후 업무 검색 내용·결과 이동은 운영 계정 데이터를 사용하지 않아 미검증이다.
- API 및 DB 확인: 새로운 API·DB·외부 호출을 추가하지 않았다. 기존 앱에 이미 로드된 요약 state만 사용하며 backend와 iOS 제품 코드는 수정하지 않았다.
- 확인함: 허용 field whitelist, 민감·상세 field 제외, malformed 안전 처리, 결정 정렬·50건 제한, session reset, safe partial warning, 접근성·범위 문구, 보호 handler 이동, syntax, diff, bundle, Android release/install/cold launch.
- 미확인: 실제 authenticated content, complete server history 검색, 실제 계정에서의 결과 이동, iOS build/device, 물리 Android 기기, 배포.
- 독립 리뷰: `Critical 0 / Important 0 / Minor 0`, Ready Yes. reviewer가 focused `18/18`, full `93/93`, `git diff --check`, bundle artifact hash를 독립 재확인했다.
- 오류 횟수: TDD 의도 RED 제외 4회. WinGet `rg` launcher 1회, sandbox의 bundle output/Android SDK 경계 2회, result 부모 디렉터리 미존재로 인한 patch 중단 1회다. 동일 구체 근본 원인의 최대 반복은 2회이며 3회 중단 기준에 도달하지 않았다. sandbox 경계 오류는 동일 승인 명령의 외부 실행으로 복구했고 patch 오류는 디렉터리 생성 후 재적용했으며 제품 코드 수정은 필요하지 않았다.
- 남은 문제: 승인 범위의 코드 문제는 없다. 운영·전체 이력·iOS·물리 기기·배포 검증은 별도 환경과 승인으로 분리한다.

## 조치

- 완료: 어울1의 독립 acceptance 대상으로 전달한다.
- merge, push, deploy, backend 및 iOS 수정은 수행하지 않았다.
