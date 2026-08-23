# Task 1 결과 — F13 모바일 운영 인증·세션

## Status

`PASS` (승인 범위의 코드·Node 계약 테스트).

## 변경

- 개발 인증 우회·샘플 업무 데이터 주입을 삭제했다.
- 운영 API 기본 주소는 유지하고, 사내 아이디를 운영 도메인 이메일로 정규화했다.
- `/auth/login` 후 `/auth/me` 검증 성공 뒤에만 인증 상태와 업무 화면을 연다.
- 401/403과 두 로그아웃 경로가 단일 정리 함수로 인증·업무 데이터를 지운다. 앱 재시작 시 영속 세션을 복원하지 않는다.

## 증적

- TDD RED: helper 부재, 세션 경합 방지 ref 부재, `Pressable` import 부재를 순서대로 확인했다.
- PASS: auth + files 계약 7/7, `auth-session.js` 구문 검사, 금지 개발/내부 주소/영속 저장소 검색, `git diff --check`.
- 기준선 제외: 전체 모바일 계약은 Android wrapper의 기존 `Users/cyhuh` 검사 1건으로 51/52이다.

## 미검증 및 다음 조치

- bundle은 `node_modules` 부재로 차단됐고 Android/실운영 HTTP는 실행하지 않았다.
- 의존성 준비 뒤 bundle과 Android 실기기에서 로그인·`/auth/me` 거부·401/403·로그아웃·재시작을 확인한다.

## 재작업 1 — 세션 generation 귀속 및 실행형 계약

### 구현

- generation/token context를 가진 `createAuthSessionController`로 로그인·보호 요청·로그아웃을 귀속했다. 늦은 이전 세션 401/403은 새 세션을 정리하지 않는다.
- 보호 요청의 모든 후속 `await` 뒤 context 일치 시에만 상태를 반영한다. 메일·대화방의 두 번째 조회, 열기 동작, 중복 로그인, 로그아웃 뒤 늦은 성공이 업무 상태를 재오염하지 못한다.
- 핵심 인증 증적을 `App.tsx` source regex가 아닌 실행형 controller/helper 테스트로 전환했다. Android wrapper는 변경하지 않았다.

### TDD 및 검증

- RED: `node --test test\mobile-f13-auth-session-contract.test.js` — controller helper 부재로 5개 동작 테스트가 `TypeError: createAuthSessionController is not a function`으로 실패(식별자 정규화 1개 통과).
- GREEN: `node --test test\mobile-f13-auth-session-contract.test.js test\mobile-f13-files-reconnect-contract.test.js` — 9/9 통과.
- PASS: `node --check auth-session.js`; 금지 개발 우회·내부 주소·영속 저장소 검색 무결과; `git diff --check`.
- 기준선: `npm test` — 53/54. 실패 1건은 변경 금지 범위인 Android wrapper의 기존 `Users/cyhuh` 경로 검사다.
- BLOCKED: `npm run bundle` — `MOBILE_BUILD_PREREQUISITE_MISSING: node_modules is missing`.

### 잔여 위험

- Android 실기기와 실제 운영 HTTP 흐름은 미실행이다. 의존성 복구 후 bundle과 운영 로그인·`/auth/me` 거부·401/403·로그아웃·재시작을 확인해야 한다.

## 재작업 2 — 실제 App session adapter 실행 계약

### 구현

- generation/token controller를 감싼 production `createMobileSessionAdapter`를 도입했다. 중앙 reset과 protected response application은 이 adapter가 담당한다.
- App 중앙 로그아웃·401/403 reset은 adapter의 full-session reset callback을 사용한다. reset 범위에는 인증, 업무/선택/오류/form 상태와 개인 LLM provider/key/connection 및 AI draft/messages가 포함된다.
- `loadMail`·`loadRooms`의 두 번째 await와 `openMail`·`openRoom`의 지연 응답은 App이 실제 사용하는 `applyProtectedResponse`를 거쳐 현재 generation/token일 때만 반영한다.

### TDD 및 검증

- RED: `node --test test\mobile-f13-auth-session-contract.test.js` — 1/7, `createMobileSessionAdapter is not a function` 및 App wiring 누락으로 실패.
- GREEN: 같은 명령 7/7. `/auth/me` 실패, 401/403 전체 reset, 로그아웃 뒤 mail/room 지연 응답, 이전 세션 401, 중복 로그인 역전을 production adapter 조합으로 실행했다.
- PASS: auth+files 계약 10/10, `node --check auth-session.js`, 금지 경로 검색, `git diff --check`.
- 기준선: `npm test` 54/55이며 실패 1건은 변경 금지 Android wrapper의 기존 `Users/cyhuh` 경로 검사다.

### 잔여 위험

- `npm run bundle` 재실행도 `MOBILE_BUILD_PREREQUISITE_MISSING: node_modules is missing`으로 차단됐고 Android 실기기·실운영 HTTP는 미실행이다.
