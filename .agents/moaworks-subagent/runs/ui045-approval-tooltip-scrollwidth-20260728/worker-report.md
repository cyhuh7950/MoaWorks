# UI-045 전자결재 도움말 tooltip scrollWidth 보완 작업자 보고서

## 판정

판정 -> PASS (개발·정적 검증 범위)

판단 이유 -> `58f4d31` 이후 격리 worktree에서 도움말 tooltip의 양의 방향 폭 확장을 RED 3/6으로 고정했고, tooltip 오른쪽 경계를 아이콘에 고정하고 8em 안에서 줄바꿈하도록 직접 관련 CSS만 추가했다. 전용 회귀 6/6, UI-045 19/19, UI-013 18/18, 전체 UI 정적 검증기 21개, production build와 `git diff --check`를 모두 통과했다.

조치 -> `fix/ui-045-mail-compose-focus` 브랜치에 세 번째 별도 커밋으로 기록한다. push와 sinsan 배포는 수행하지 않으며, 운영 DOM의 `scrollWidth <= clientWidth` 최종 측정은 배포 독립 검수에서 확인한다.

## 변경 내용

- 숨겨진 `.ui031-help[data-tooltip]::after`의 `left: 0`, `max-content` 확장을 후속 규칙으로 재정의했다.
- tooltip을 아이콘의 오른쪽 경계에 맞춰 `right: 0`, `left: auto`로 배치했다.
- 폭을 10px tooltip 글꼴 기준 `8em`으로 제한하고 `border-box`와 `overflow-wrap: anywhere`를 적용했다.
- hover와 keyboard focus-visible에서 기존 설명의 opacity 전환을 그대로 보존했다.
- 1차 보완의 업무 제목·설명·버튼·배지 wrapping과 세로 스크롤 정책은 유지했다.

## RED 증적

- 명령: `node scripts/ui045-approval-tooltip-scrollwidth-static-verify.mjs`
- 수정 전 결과: 3/6, exit 1
- 실패 항목: tooltip 오른쪽 경계 고정, 가용 너비 제한, 설명 줄바꿈
- 기존 hover 및 focus 설명 계약은 RED 시점에도 통과했다.

## GREEN 및 필수 검증

- 신규 tooltip scrollWidth 계약 검증: 6/6 PASS
- UI-045 디자인 일관성 검증: 19/19 PASS
- UI-013 회귀 검증: 18/18 PASS
- 전체 `ui*-static-verify.mjs`: 21개 검증기 PASS
- `npm run build`: PASS, TypeScript 및 Vite production build, 56 modules transformed
- `git diff --check`: PASS

## 수정 파일과 영향 범위

- `frontend/user-web/src/global.css`: 전자결재 도움말 tooltip 배치·폭·줄바꿈만 추가
- `frontend/user-web/scripts/ui045-approval-tooltip-scrollwidth-static-verify.mjs`: 직접 회귀 검증 추가
- `.agents/moaworks-subagent/runs/ui045-approval-tooltip-scrollwidth-20260728/worker-report.md`: 작업 보고
- `.agents/moaworks-subagent/runs/ui045-approval-tooltip-scrollwidth-20260728/result.latest.json`: 구조화 결과

DOM, 보조 메뉴 폭, 업무 텍스트, 세로 스크롤, 메뉴 클릭, 결재 화면·상태, 공통 Shell/Popup, API, DB, 인증과 권한은 변경하지 않았다.

## 운영 검수 경계

- 저장소 환경의 Playwright Chromium 실행 파일이 설치되어 있지 않아 이 worktree에서 실제 DOM 수치 재측정은 수행하지 못했다.
- 따라서 개발 결과는 정적·빌드 PASS이며, sinsan 배포 후 보조 메뉴와 자식의 `scrollWidth <= clientWidth`, hover/focus tooltip 가시성은 어울1의 독립 완료 판정 항목으로 남는다.
