# UI-045 전자결재 보조 메뉴 가로 overflow 보완 작업자 보고서

## 판정

판정 -> PASS

판단 이유 -> `06bd288` 이후 격리 worktree에서 보조 메뉴의 가로 overflow 방지 계약 누락을 RED 0/6으로 고정했고, 직접 관련 CSS만 수정한 뒤 전용 회귀 6/6, UI-045 19/19, UI-013 18/18, 전체 UI 정적 검증기 20개, production build와 `git diff --check`를 모두 통과했다.

조치 -> `fix/ui-045-mail-compose-focus` 브랜치에 두 번째 별도 커밋으로 기록한다. push와 sinsan 배포는 수행하지 않는다.

## 변경 내용

- 전자결재 보조 메뉴의 가로 overflow를 차단하면서 기존 세로 스크롤은 유지했다.
- sidebar 직접 자식과 메뉴 버튼이 승인된 176px 열 안에서 축소되도록 `min-width: 0`과 `max-width: 100%`를 적용했다.
- 소개 설명, 주요 버튼, 메뉴 제목·설명을 줄바꿈해 업무 텍스트가 가로 잘림으로 손실되지 않도록 했다.
- 배지도 긴 값이 열 너비를 강제로 확장하지 않도록 줄바꿈 가능하게 했다.

## RED 증적

- 명령: `node scripts/ui045-approval-sidebar-overflow-static-verify.mjs`
- 수정 전 결과: 0/6, exit 1
- 실패 항목: 가로 overflow/세로 스크롤 계약, 직접 자식 축소, 주요 버튼 줄바꿈, 메뉴 승인 너비, 제목·설명 줄바꿈, 배지 축소

## GREEN 및 필수 검증

- 신규 전자결재 sidebar overflow 검증: 6/6 PASS
- UI-045 디자인 일관성 검증: 19/19 PASS
- UI-013 회귀 검증: 18/18 PASS
- 전체 `ui*-static-verify.mjs`: 20개 검증기 PASS
- `npm run build`: PASS, TypeScript 및 Vite production build, 56 modules transformed
- `git diff --check`: PASS

## 수정 파일과 영향 범위

- `frontend/user-web/src/global.css`: 전자결재 보조 메뉴의 직접 관련 overflow·wrapping 규칙만 변경
- `frontend/user-web/scripts/ui045-approval-sidebar-overflow-static-verify.mjs`: 직접 회귀 검증 추가
- `.agents/moaworks-subagent/runs/ui045-approval-sidebar-overflow-20260728/worker-report.md`: 작업 보고
- `.agents/moaworks-subagent/runs/ui045-approval-sidebar-overflow-20260728/result.latest.json`: 구조화 결과

공통 Shell/Popup 구조, 보조 메뉴 폭, 메뉴 클릭, 문서함·환경설정 이동, 결재 목록·상세, 세로 스크롤, API, DB, 인증, 권한과 결재 상태 처리는 변경하지 않았다.
