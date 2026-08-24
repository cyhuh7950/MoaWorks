# F13 모바일 운영 인증·세션 작업자 보고서

## 판정

`PASS` — 승인된 인증·세션 코드 및 Node 계약 테스트 범위는 구현·집중 검증을 완료했다.

## 판단 이유

- `__DEV__` 자동 인증과 개발 샘플 업무 데이터 주입 경로를 제거했다.
- 사내 아이디는 `@moaworks.sinsan.kr` 이메일로 정규화하고, `/auth/login` 뒤 `/auth/me` 성공 후에만 토큰·사용자를 반영한다.
- 401/403은 중앙 `clearSession`으로 토큰·사용자·비밀번호·업무/화면 데이터·오류 상태를 정리하며, 동시 요청의 늦은 성공 응답은 세션 토큰 ref로 무시한다.
- 히어로와 설정의 두 로그아웃 경로가 같은 중앙 정리를 사용한다.

## 조치 및 변경 파일

- `frontend/mobile-app/App.tsx`
- `frontend/mobile-app/auth-session.js`
- `frontend/mobile-app/test/mobile-f13-auth-session-contract.test.js`

## TDD 및 검증

- RED: 신규 helper 부재, 세션 경합 방지 ref 부재, 로그인 화면 `Pressable` import 부재를 각각 실패로 확인했다.
- PASS: `node --test test\\mobile-f13-auth-session-contract.test.js test\\mobile-f13-files-reconnect-contract.test.js` — 7/7.
- PASS: `node --check auth-session.js`, 금지 개발 우회·내부 주소·세션 영속 저장소 정적 검색, `git diff --check`.
- 기준선: `npm test`는 52개 중 51개 통과, `mobile-build-contract.test.js`의 기존 Android wrapper `Users/cyhuh` 1건 실패가 남았다. 이번 범위에서 수정하지 않았다.
- 미검증: `npm run bundle`은 작업공간 `node_modules` 부재로 `MOBILE_BUILD_PREREQUISITE_MISSING`; Android 실기기·실운영 로그인 호출은 실행하지 않았다.

## 오류 횟수 및 다음 조치

- F13 구현 동일 근본 원인 재시도 오류: 0회. 기준선 Android wrapper 실패와 bundle 의존성 부재는 별도 상태다.
- 다음 조치: 의존성 준비 후 bundle/Android 실기기에서 실제 운영 계정 로그인, `/auth/me` 거부, 401/403, 로그아웃·재시작을 검증한다. Android wrapper 결함은 별도 브랜치에서 처리한다.

## 재작업 1 — 세션 generation 귀속 및 실행형 계약

### 조치

- `auth-session.js`에 generation/token 기반 `createAuthSessionController`를 추가했다. 로그인 시도, 보호 요청, 로그아웃이 같은 generation을 공유하며, 현재 generation/token에 일치하는 401/403만 중앙 정리를 실행한다.
- `App.tsx`의 모든 보호 요청과 후속 `await` 뒤 상태 반영을 해당 context로 제한했다. `loadMail`·`loadRooms`의 두 번째 await, `openMail`·`openRoom`, 연속 로그인 응답, 로그아웃 뒤 늦은 성공 응답은 현재 context가 아니면 업무 상태를 갱신하지 않는다.
- 핵심 인증 계약을 `App.tsx` 정규식 검사가 아닌 controller 실행 테스트로 교체했다. `/auth/me` 실패 차단, 401/403 전체 정리, 로그아웃 뒤 늦은 성공 무시, 이전 세션 401 무시, 중복 로그인 응답 역전 방지를 실행한다.
- Android command wrapper는 변경하지 않았다.

### TDD 및 검증 증적

- RED: `node --test test\mobile-f13-auth-session-contract.test.js` — 식별자 정규화 1건 통과, controller 동작 5건은 `TypeError: createAuthSessionController is not a function`으로 실패했다. helper가 아직 없어서 발생한 기대한 실패다.
- GREEN: `node --test test\mobile-f13-auth-session-contract.test.js test\mobile-f13-files-reconnect-contract.test.js` — 9/9 통과.
- PASS: `node --check auth-session.js`; 개발 우회·내부 주소·영속 세션 저장소 정적 검색 무결과; `git diff --check`.
- 기준선: `npm test` — 54개 중 53개 통과, `test/mobile-build-contract.test.js`의 기존 Android wrapper `Users/cyhuh` 사용자 경로 검사 1건 실패. 이번 범위에서 수정하지 않았다.
- BLOCKED: `npm run bundle` — `MOBILE_BUILD_PREREQUISITE_MISSING`, `node_modules is missing`.
- 미검증: Android 실기기 및 실제 운영 HTTP 로그인·`/auth/me` 거부·401/403·로그아웃·재시작 흐름은 실행하지 않았다.

### 재작업 상태

- F13 구현 동일 근본 원인 재시도 오류: 0회. 이 RED는 TDD 기대 실패이며, Android wrapper 기준선 실패와 bundle 의존성 부재는 별도 상태다.
- 다음 조치: 의존성을 복구한 뒤 bundle과 Android 실기기에서 운영 인증·세션 만료·로그아웃·재시작을 검증한다.

## 재작업 2 — 실제 App session adapter 실행 계약

### 조치

- `auth-session.js`에 production `createMobileSessionAdapter`를 추가했다. 기존 generation/token controller를 감싸 로그인 commit, 현재 세션 401/403 reset, 명시 로그아웃, 지연 응답 반영을 한 경로로 조정한다.
- adapter의 순수 reset 상태는 토큰·사용자·비밀번호, 결재·알림, 메일/선택/검색, 대화방/메시지/선택, 파일, 오류·form, 개인 LLM provider/key/connection 및 AI draft/messages를 초기화한다. 이메일·서버 설정처럼 비밀이 아닌 로그인 재입력 보조 설정은 유지한다.
- `App.tsx`는 adapter의 reset callback을 중앙 `clearSession`에 사용하며, `loadMail`·`loadRooms`의 두 번째 await와 `openMail`·`openRoom`의 지연 응답 반영도 같은 `applyProtectedResponse`로 수행한다. Android wrapper와 업무 API는 변경하지 않았다.

### TDD 및 검증 증적

- RED: `node --test test\mobile-f13-auth-session-contract.test.js` — 1/7 통과, adapter 동작 5개는 `TypeError: createMobileSessionAdapter is not a function`, App wiring 보조 검사는 `createMobileSessionAdapter` 부재로 실패했다. 새 production adapter가 없어서 발생한 기대한 실패다.
- GREEN: 같은 명령 — 7/7 통과. 실제 adapter 조합으로 `/auth/me` 실패, 401/403 전체 reset, 로그아웃 뒤 mail/room 두 번째 조회·열기 응답 무시, 이전 세션 401, 중복 로그인 역전을 검증했다.
- PASS: `node --test test\mobile-f13-auth-session-contract.test.js test\mobile-f13-files-reconnect-contract.test.js` — 10/10; `node --check auth-session.js`; 금지 개발 우회·내부 주소·영속 저장소 검색 무결과; `git diff --check`.
- 기준선: `npm test` — 54/55. 실패 1건은 변경 금지 Android wrapper의 기존 `Users/cyhuh` 사용자 경로 검사다.
- BLOCKED: `npm run bundle` 재실행 — `MOBILE_BUILD_PREREQUISITE_MISSING`, `node_modules is missing`. Android 실기기·실운영 HTTP 인증 흐름은 실행하지 않았다.

### 재작업 상태

- F13 구현 동일 근본 원인 재시도 오류: 0회. 이 RED는 TDD 기대 실패이며, Android wrapper 기준선 실패와 bundle 의존성 부재는 별도 상태다.
- 다음 조치: 의존성을 복구한 뒤 bundle과 Android 실기기에서 운영 로그인·`/auth/me` 거부·401/403·로그아웃·재시작을 검증한다.

## 최종 재작업 — 이전 로그인 실패·초기 요청 generation 귀속

### 조치

- `createAuthSessionController.login`은 `/auth/login` 및 `/auth/me` 실패를 throw하기 전에 해당 login attempt가 현재인지 확인한다. 이전 attempt의 401·403·네트워크 실패는 `{ committed: false }`로 종료해 최신 로그인 메시지나 세션을 바꾸지 않는다.
- production `createMobileSessionAdapter.runInitialRequests`가 로그인 context의 결재·알림·메일·메신저·파일 초기 요청을 순차 실행한다. context가 바뀌면 이전 요청의 성공·실패 모두 `{ applied: false }`로 끝내고 새 세션 상태·메시지를 변경하지 않는다.
- `App.tsx`의 `doLogin`은 이 orchestration을 실제 사용하고, catch에서 login attempt/context가 더 이상 현재가 아니면 오류 메시지를 반영하지 않는다. 기준선 JSX 닫힘·미정의 화면 상태와 Android wrapper는 수정하지 않았다.

### TDD 및 검증 증적

- RED: `node --test test\mobile-f13-auth-session-contract.test.js` — 7/9 통과, 2개 기대 실패. 이전 login 401이 `Error: old failure`로 전파됐고 `adapter.runInitialRequests is not a function`이었다.
- GREEN: 같은 auth 계약 9/9 통과(이전 login 401·403·네트워크 실패, 이전 초기 요청 성공·실패 모두 포함).
- PASS: `node --test test\mobile-f13-auth-session-contract.test.js test\mobile-f13-files-reconnect-contract.test.js` — 12/12; `node --check auth-session.js`; 금지 개발 우회·내부 주소·영속 저장소 검색 무결과; `git diff --check`.
- 기준선: `npm test` — 56/57. 실패 1건은 변경 금지 Android wrapper의 기존 `Users/cyhuh` 사용자 경로 검사다.
- 미검증: bundle은 `node_modules` 부재로 차단된 상태이며 Android 실기기·실운영 HTTP 인증은 실행하지 않았다. 기준선 App JSX 닫힘과 `screenDensity`·`moreScreen`·`setMoreScreen`·`ScreenKey` 미정의도 이번 범위에서 수정하지 않았다.

### 최종 상태

- F13 구현 동일 근본 원인 재시도 오류: 0회. RED는 TDD 기대 실패이고 Android wrapper 및 기준선 App JSX 결함은 별도 상태다.
- 다음 조치: 의존성 복구 후 bundle과 Android/운영 HTTP에서 로그인·`/auth/me` 거부·401/403·로그아웃·재시작을 검증한다.
