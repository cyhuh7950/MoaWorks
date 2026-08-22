# 어울2 작업 프롬프트

기존 격리 worktree와 브랜치의 `06bd288` 이후에서 작업지시서대로 RED→최소 CSS 수정→GREEN→필수 검증→별도 커밋을 수행한다. 메인 체크아웃과 저장소 밖 경로는 건드리지 않는다. 작업자 보고서와 새 task의 `result.latest.json`을 제출한다.

재작업에서는 `58f4d31`을 유지한 상태로 tooltip pseudo-element가 scrollWidth를 확장하는 직접 원인을 수정한다. `overflow-x:hidden`만으로 통과시키지 말고, tooltip 설명을 실제 가용 너비 안에서 줄바꿈해 접근성을 유지한다.
