# 데스크톱 패키징 병합 회귀 교정 보고서

- 일시: 2026-08-24T23:01:14.1183224+09:00
- 담당: `/root`
- 브랜치: `fix/desktop-package-script-merge-corruption`
- 판정: 로컬 검증 및 독립 리뷰 통과, 실제 설치·업데이트·제거 검증 전

## 근본 원인과 교정

- `frontend/desktop-client/scripts/package-desktop-client.js`에 과거 tar 패키저와 F12 Windows ZIP 패키저가 병합되어 `bundleDir`가 중복 선언됐다.
- 기존 정적 계약 테스트는 문자열 존재만 확인해 JavaScript 구문 오류를 놓쳤다.
- `package-lock.json`의 Electron 43.2.0 항목이 실제 패키지의 dependencies와 `electron`/`install-electron` bin을 누락해 clean install이 재현되지 않았다.
- F12 정본 구현을 기준으로 Windows 버전 ZIP 패키저를 복구하고 `node --check` 회귀 테스트를 추가했다.
- Electron을 `43.2.0` exact로 유지한 채 lockfile 메타데이터만 npm으로 재생성했다.

## 변경 파일

- `frontend/desktop-client/scripts/package-desktop-client.js`
- `frontend/desktop-client/test/package-contract.test.js`
- `frontend/desktop-client/package-lock.json`
- `frontend/desktop-client/build-evidence/MoaWorks-Desktop-0.1.1-win-x64-portable.manifest.json`
- `frontend/desktop-client/build-evidence/MoaWorks-Desktop-0.1.1-win-x64-installer.manifest.json`

## 검증 증거

- 회귀 테스트 RED: `SyntaxError: Identifier 'bundleDir' has already been declared`
- 임시 원본 기반 exact lockfile `npm ci`: PASS, 510 packages
- 정본 브랜치 `npm ci`: PASS, 510 packages
- `npm test`: 31/31 PASS
- `npm run test:coverage`: lines 98.58%, branches 87.23%, functions 100%
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm run package:portable`: PASS
- `npm run package:installer`: PASS
- Portable ZIP SHA-256: `a0df1666c697d592dacf00640794b41821532685ab160abf86cf500fce5c8a6a`
- Installer EXE SHA-256: `f366b79cdfa879a5da6d3e4565e3b769cbe48e30f986374e5ee0541f2f3028f3`
- Update NUPKG SHA-256: `13cad866422802c6a9c2a190c99afbd16aa3228791da6ceefd9236a3f20b7667`
- RELEASES SHA-256: `47e4941888095ff146a7047df7cf13c87af55c324ef42391424d18eccb004a82`
- Runtime ASAR SHA-256: `fb35cadafeb2434fdf3314ba79799830c302b279c9dc75046b5b346c920dfe06`
- 모든 실제 해시와 manifest 일치: 5/5
- Portable ZIP 필수 항목: EXE, `resources/app/electron/main.js`, `electron-squirrel-startup/index.js` 존재
- `git diff --check`: PASS
- 독립 읽기 전용 재리뷰: Critical 0 / Important 0 / Minor 0, merge ready

## 오류 및 미검증

- 진단·환경 오류 누계: 9회. 동일 근본 원인 최대 반복: lockfile 손상 2회이며 3회 중단 기준 미도달.
- 현재 사용자 환경의 과거 0.1.1 설치본은 2026-08-05 이력으로 현재 산출물 검증 증거가 아니다.
- 실제 clean install, 실행·로그인, portable 실행·로그인·archive, update, remove, reinstall은 미검증이다.
- Android 현재 release 실기기와 iOS는 별도 미검증이다.

## 다음 조치

1. 이 브랜치를 commit하고 main 병합·push·브랜치 삭제한다.
2. 신산님 승인 후 과거 설치본 제거와 현재 Setup 설치를 수행한다.
3. 정본 계획의 clean install → portable/archive → update → remove → reinstall 순서로 실제 검증한다.
