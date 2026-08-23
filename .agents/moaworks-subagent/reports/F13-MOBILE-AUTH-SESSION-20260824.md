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
