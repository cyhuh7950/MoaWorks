# F13 모바일 주소록 API

## 판정
`PASS` — 승인된 directory 조회·direct room client wiring과 독립 리뷰 보완을 구현했다.

## 증적
- RED: 더보기 재조회, 본인 대화 차단, mailto rejection, compact 행 계약 1건 실패.
- GREEN: focused 5/5, 전체 74/74 PASS.
- bundle PASS: `8edfc33e67e8ed7f6c5a0e6b0c1cb6a6ff1178ec98a3563220c3ac9aaf6a5988`.

## 미검증
실제 운영 API/대화방 생성/외부 메일 앱/배포는 실행하지 않았다.

## Android 증적
- release APK 59,176,318 bytes, `emulator-5554` streamed install `Success`, `com.moaworks.mobile/.MainActivity` cold launch 확인.
- XML: `frontend/mobile-app/artifacts/android-mobile-directory-cold.xml`.

## Final correction
- stale mailto rejection은 capture session이 current일 때만 오류 반영; focused 6/6, full 75/75, bundle `ec368ac145a71ba2f0f571915d966cccb06b12e7b62221a1f402463fea0a4eda`.
- Android `BUILD SUCCESSFUL in 19s` (64 tasks), emulator install Success/cold launch. 오류 횟수 1(기존 regex 기대 불일치), 다음 조치는 운영 로그인 후 GET/direct room/mail/deploy 별도 검증.
