# UI-045 메일 작성창 초기 포커스 보완 작업지시서

## 판정

판정 -> 경미 화면 회귀 보완 필요

판단 이유 -> UI-045 운영 브라우저 2회 검수에서 작성창 제목과 내용은 정상이나 초기 포커스가 외부 트리거에 남아 popup focus 완료 조건을 충족하지 못했다.

조치 -> RED 회귀 테스트를 먼저 추가하고 `mail-compose-to`에 초기 포커스가 가도록 최소 수정한 뒤 관련 정적 검증과 production build를 완료한다.

## 구현 범위

- 기준 커밋 `3bcacec`에서 새 `fix/ui-045-mail-compose-focus` 브랜치를 사용한다.
- 작업 위치는 저장소 내부 `.worktrees/ui045-mail-compose-focus`로 제한한다.
- 메일 작성 컴포넌트와 직접 관련된 테스트만 수정한다.
- 실제 컴포넌트 구조를 확인해 가장 작은 React 포커스 처리만 적용한다.

## 금지

- 현재 메인 체크아웃 `feature/ui-017-mail-detail`과 그 미커밋 파일 수정 금지.
- `D:\Project\MoaWorks`, `C:\tmp` 및 저장소 외부 작업 금지.
- API, DB, 인증, 권한, 메일 발송 계약, 공통 popup 구조 변경 금지.
- 관련 없는 리팩터링과 전체 파일 재작성 금지.

## 필수 검증

- 추가한 RED 테스트가 수정 전 실패함을 증적에 기록.
- 수정 후 해당 테스트 GREEN.
- UI-045 정적 검증, UI-013 회귀, 전체 UI 정적 검증, user-web production build, `git diff --check`.
- 수정 파일과 영향 범위를 작업자 보고서에 기록.
- 커밋까지 수행하되 push와 sinsan 배포는 하지 않는다.

