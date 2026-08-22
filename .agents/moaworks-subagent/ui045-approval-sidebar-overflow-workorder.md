# UI-045 전자결재 보조 메뉴 가로 overflow 보완 작업지시서

## 판정

판정 -> 경미 화면 회귀 보완 필요

판단 이유 -> sinsan 1920x1080 운영 화면에서 보조 메뉴의 가로 스크롤바와 설명 잘림이 두 차례 확인돼 UI-045 compact menu·overflow 기준을 충족하지 못했다.

조치 -> 실제 DOM/CSS 원인을 고정하는 RED 테스트를 먼저 추가하고, 관련 CSS만 최소 수정하여 가로 overflow를 제거한다.

## 구현 범위

- 기존 저장소 내부 `.worktrees/ui045-mail-compose-focus`와 `fix/ui-045-mail-compose-focus` 브랜치의 `06bd288` 이후에서 계속한다.
- 전자결재 보조 메뉴와 직접 관련된 CSS·정적 검증기만 수정한다.
- 긴 설명, 제목, 배지, 버튼이 너비를 강제로 확장하지 않도록 `min-width`, wrapping, overflow 정책을 실제 구조에 맞게 최소 적용한다.

## 금지

- 메인 체크아웃과 저장소 밖 경로 접근·수정 금지.
- API, DB, 인증, 권한, 결재 상태 처리, 공통 Shell/Popup 구조 변경 금지.
- 보조 메뉴 폭 재설계, 관련 없는 CSS 정리·리팩터링 금지.
- 가로 잘림을 숨기기만 하고 업무 텍스트 접근성을 손상하는 방식 금지.

## 필수 검증

- 수정 전 RED 증적.
- 수정 후 전용 검증 GREEN.
- 운영 측정에서 보조 메뉴와 모든 자식의 `scrollWidth <= clientWidth`가 되어야 한다.
- 숨겨진 tooltip pseudo-element가 보조 메뉴의 scrollWidth를 확장하지 않아야 하며 hover/focus 설명은 가용 너비 안에서 보여야 한다.
- UI-045 19/19, UI-013 18/18, 전체 UI 정적 검증, production build, `git diff --check`.
- 수정 파일·영향 범위 보고 및 별도 커밋.
- push·배포 금지.

## 1차 수정 독립 검토 결과와 재작업

- 커밋 `58f4d31`은 스크롤바 표시만 제거했지만 운영 DOM에서 `clientWidth=174px`, `scrollWidth=311px`가 남아 독립 검토에서 미승인됐다.
- 넘침 요소는 `.ui031-shell__intro` 301px, 내부 div 297px, `.ui031-help` 230px이며 실제 원인은 도움말 tooltip pseudo-element다.
- 기존 텍스트 wrapping 보완은 유지하되 tooltip의 폭과 containing block을 승인 너비 안으로 제한하는 RED 테스트와 최소 CSS를 추가한다.
