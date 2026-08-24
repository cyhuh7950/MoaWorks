# F13 모바일 UI 설계 일치 보완 보고서

## 판정

`에뮬레이터 화면·접근성·세션 PASS / AI alert clipping remediation PASS / 로그인 기능 판정 제외 / TalkBack·물리 Android·iOS 미검증`

## 판단 이유

- 정본: `docs/superpowers/specs/2026-08-21-mobile-app-design-spec.md`, `docs/design/mobile/01-home.png`부터 `07-ai-chat.png`, `docs/superpowers/plans/2026-08-25-mobile-ui-design-parity-remediation.md`.
- Tasks 1~7의 TDD 구현 커밋을 보존하고 Task 8 fresh 검증을 완료했다.
- 전체 테스트 `114/114 PASS`, fail 0.
- coverage: lines `96.33%`, branches `81.96%`, functions `95.65%`로 각 80% 이상이다.
- production bundle SHA-256: `cc88b46d69261ec10602e0fd38824d12e326c44e3a628272b6686e83f8c32f69`.
- internal release APK SHA-256: `ee4e87ee7d04835bebfbc80ab563960f2cbd49f80cabbef11d9ce259f9a47bf1`.
- `npm run build`와 `npm run build:android` 모두 Gradle `BUILD SUCCESSFUL`; APK는 non-debuggable, embedded bundle, minified, public-release 불가 내부 패키지다.
- emulator-5554에 최종 clean APK 설치 `Success`, 강제 종료 후 cold launch에서 로그인 화면과 인증 내비게이션 부재를 확인했다.
- 신산님 지시에 따라 로그인 기능 자체는 이번 화면 기능 판정에서 제외했다. 운영 계정·DB는 변경하지 않았다.
- 인증 이후 화면 증적은 운영과 분리된 WSL 통합 테스트 환경(`dev.moaworks.sinsan.kr`)과 전용 테스트 계정으로 생성했다. 임시 API base 변경은 캡처 직후 원복했고 clean production-default APK를 재빌드·재설치했다.
- 홈·메일·결재·메신저·일정·주소록·AI 채팅의 공통 헤더, 6개 하단 탐색, 정보 순서, 밀도, 빈 상태, 주요 동작을 원본과 수동 대조했다. 샘플 업무 데이터는 승인 없이 만들지 않아 빈 상태로 검증했다.
- 7개 XML에서 예상 화면 라벨을 모두 확인했고 password node는 0개였다. 버튼 수는 화면별 7~47개이며 AI의 Provider 미설정 오류는 고정 alert 이름으로 노출됐다.
- background→foreground에서 AI 화면과 내비게이션이 유지됐고, force-stop cold launch와 명시적 logout 모두 로그인 화면으로 복귀하며 인증 내비게이션을 제거했다.
- 독립 리뷰가 발견한 AI 오류 alert 하단 잘림은 전용 compact alert 스타일과 회귀 테스트로 보완했다. 수정 APK에서 AI 화면을 재캡처했고 alert bounds `[81,1327][999,1367]`가 카드 하단 안쪽이며 PNG에서 문구 전체가 표시되는 것을 확인했다. 이후 dev API를 원복하고 clean production-default APK를 재빌드·재설치했다.
- TalkBack 설정 변경과 물리 Android, iOS/macOS/Xcode/VoiceOver는 이 보고서의 PASS에 포함하지 않는다.

## 화면별 시각 판정

| 화면 | 판정 | 근거 |
|---|---|---|
| 홈 | PASS_EMPTY_STATE | 인사, 메일·결재 요약, 오늘 일정, 최근 메신저, 6탭 순서 일치 |
| 메일 | PASS_EMPTY_STATE | 새 메일, 4개 사서함, 검색·필터, 빈 상태 일치 |
| 결재 | PASS_EMPTY_STATE | 초안·진행 중·완료 탭, 기안 진입, 빈 상태 일치 |
| 메신저 | PASS_EMPTY_STATE | 대화방 헤더, 주소록 진입, 대화 영역과 하단 구조 일치 |
| 일정 | PASS_EMPTY_STATE | 7열 월간 달력, 오늘·월 이동, 선택일 목록, 일정 만들기 일치 |
| 주소록 | PASS_TEST_DATA | 검색, 전체·즐겨찾기·최근 연락처, compact 사용자 행과 동작 일치 |
| AI 채팅 | PASS_BLOCKED_STATE | Provider 상태, 대화 bubble, 설정, 하단 입력과 안전한 오류 상태 일치; alert clipping 보완 후 재캡처 PASS |

## 증적

- `01-home.png/xml`: `64b95298...d3e35` / `7b0ba4e7...9c3c3`
- `02-mail.png/xml`: `cecd8663...7b1f9` / `11feb8eb...fa72`
- `03-approval.png/xml`: `8b5ed4fd...80c28` / `5d0e6a7e...30d6c`
- `04-messenger.png/xml`: `6a1df256...3c9de` / `d244a5f5...d8539`
- `05-calendar.png/xml`: `13441cb7...b7177` / `41260979...e6f9`
- `06-directory.png/xml`: `0cb208e8...fe8e2` / `37b553a4...0ca2`
- `07-ai-chat.png/xml`: `41943151...8daf2` / `bc1a3017...83d86`

전체 파일은 `frontend/mobile-app/artifacts/android-design-parity-20260825/`에 있다.

## 오류와 복구

- 누적 오류 횟수: 36.
- 과거 운영 연결 계정 로그인 실패 3회는 규칙에 따라 중단했다.
- 원인 확인 후 운영 변경을 하지 않고 WSL 테스트 환경으로 전환했다.
- WSL 계정 생성 결과 출력의 배포 모델 필드 불일치 1회와 원격 명령 결과 대기 초과 1회는 데이터 변경을 반복하지 않고 읽기·실제 인증으로 확인했다.
- ADB 대문자 입력 변형은 WSL 테스트 계정의 ADB 안전 문자 비밀번호로 복구했다.
- UIAutomator password text는 실제 값이 아니라 동일 마스킹 문자임을 확인해 비밀값 비교 근거로 사용하지 않았다.
- `C:\tmp\final-clean-login.xml` 1차 정리는 sandbox 권한 거부 1회 후 정확한 단일 경로를 재확인하고 승인된 권한으로 삭제했다.
- AI 보완용 첫 Android build는 SDK 환경 변수가 sandbox에서 발견되지 않아 1회 차단됐고, 명시적 SDK/JDK 경로의 승인된 build로 복구했다.
- `rg.exe`가 Windows ACL로 1회 실행 거부되어 `Select-String` 읽기 전용 대체로 전환했다.
- AI 런타임 재캡처 로그인 자동화는 좌표 정수 변환 오류로 빈 요청이 1회 전송됐고, 좌표 수정 후 테스트 계정 인증 화면 전환도 확인되지 않아 반복 인증 안전 규칙에 따라 추가 시도를 중단했다.
- 현재 동일 근본 원인 연속 오류: 0.

## 미검증 범위

- 수정된 AI alert 런타임 viewport 재캡처: `PASS` (`07-ai-chat.png` SHA-256 `67492d0997ac4134484fb88879ed3e6167566a57d2a431c751683988ffc88888`, XML SHA-256 `19f60d85e631a97a13ae5e01c97b7ce76cb29f3e0873a2dbe3d1f4d2b2048f9e`).
- TalkBack 실제 음성·초점 순서: `UNVERIFIED_SYSTEM_SETTING_APPROVAL`.
- Android 물리 기기 설치·기능·접근성: `UNVERIFIED_PHYSICAL_DEVICE`.
- iOS macOS/Xcode 빌드·서명·실기기·VoiceOver: 기존 결정대로 `DEFERRED`.
- 샘플 메일·결재·메신저·일정 생성/발송: 승인 없이 실행하지 않아 빈 상태로 분리.
- 운영 로그인 기능 판정: 신산님 지시로 이번 화면 기능 검증에서 제외.

## 다음 조치

1. 독립 재리뷰 Critical 0 / Important 0 / Minor 0 확인 완료.
2. diff·JSONL·비밀값 부재 최종 확인 후 이 브랜치를 commit→main merge→push→delete한다.
3. 신산님이 별도 필수로 지정한 관리자 비밀번호 재설정 기능을 새 브랜치에서 TDD로 구현한다.
4. 이후 계획 순서대로 TalkBack 승인 검증과 물리 Android를 진행하고 iOS 보류 경계를 유지한다.
