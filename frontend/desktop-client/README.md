# MoaWorks Desktop Client

일반 사용자가 명령어 없이 실행하는 Windows x64 포터블 업무 클라이언트입니다.

## 사용자 실행

1. 배포받은 `MoaWorks-Desktop-<version>-win-x64-portable.zip`을 새 폴더에 압축 해제합니다.
2. `MoaWorks Desktop Client.exe`를 실행합니다.
3. 화면에서 로그인한 뒤 메일, 메신저, 결재와 알림 기능을 사용합니다.
4. 메일 및 메신저 아카이브는 화면의 저장 기능으로 사용자가 선택한 외부 폴더에 저장합니다.

재설치는 실행 중인 앱을 종료한 뒤 새 버전 ZIP을 새 폴더에 압축 해제해 실행합니다. 제거는 앱 종료 후 압축 해제 폴더를 삭제합니다. 사용자가 별도 저장한 아카이브 파일은 제거 대상이 아닙니다.

## 보안·운영 경계

- renderer는 화면 표시와 입력만 담당하고 네트워크를 직접 호출하지 않습니다.
- 운영 API 주소와 인증 정보는 main process에서만 관리하며 인증 정보는 메모리에만 유지합니다.
- 로그아웃, 인증 실패, 잠금 응답, 앱 종료 시 인증 정보를 지웁니다.
- main process는 HTTPS 운영 API와 승인된 경로·method·요청/응답 크기만 허용합니다.
- 메일은 JSON, 메신저는 JSON/HTML로만 저장하며 파일명·확장자·schema·크기를 검사합니다.
- HTML 아카이브의 사용자 입력은 escape 처리합니다.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`를 유지합니다.

## 개발자 검증

```text
npm ci
npm test
npm run test:coverage
npm run build
npm audit --omit=dev
```

빌드 결과는 `build-evidence/`에 versioned portable ZIP, SHA-256 manifest, 최소 로그로 생성됩니다. manifest에는 ZIP, EXE, 앱 main 코드의 버전·크기·해시가 포함됩니다.
