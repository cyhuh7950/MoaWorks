# UI-045 전자결재 보조 메뉴 가로 overflow 보완 설계

- 기준: UI-045 운영 브라우저 1920x1080 1차·2차 검수.
- 재현: `전자결재 보조 메뉴`의 `clientWidth=174px`, `scrollWidth=311px`, `overflow-x=auto`가 반복 확인됐고 화면 하단에 실제 가로 스크롤바가 노출됐다.
- 확정 요구: 보조 메뉴의 가로 스크롤을 제거하고 제목·설명·배지·버튼이 승인된 너비 안에서 줄바꿈 또는 축약되어야 한다.
- 범위: 전자결재 보조 메뉴의 직접 관련 CSS와 정적 회귀 테스트만 최소 수정한다.
- 보존: 세로 스크롤, 메뉴 클릭, 문서함/환경설정 이동, 결재 목록·상세, popup, API·DB·인증 계약은 유지한다.

## 운영 재검수에서 확인된 직접 원인

- 1차 수정 후 `overflow-x:hidden`으로 스크롤바는 사라졌으나 `scrollWidth=311px`가 유지되어 완료 기준을 충족하지 못했다.
- 직접 원인은 `.ui031-help[data-tooltip]::after`의 숨겨진 tooltip이 `width:max-content; max-width:230px; left:0`으로 배치되어 도움말 아이콘의 `scrollWidth=230px`를 만드는 것이다.
- 단순 clipping으로 숨기지 말고, tooltip을 보조 메뉴의 가용 너비 안에서 줄바꿈되도록 배치해 평상시와 hover/focus 모두 설명 접근성을 유지해야 한다.
