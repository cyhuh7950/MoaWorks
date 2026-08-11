# MoaWorks 공식 메뉴얼 v2.0

이 디렉터리는 MoaWorks 설치와 사용을 위한 공식 역할별 메뉴얼의 원본입니다. Markdown을 단일 원본으로 관리하고 동일한 내용의 DOCX와 PDF를 `output/`에 생성합니다.

## 메뉴얼 선택

| 독자 | 먼저 읽을 문서 | 목적 |
|---|---|---|
| 일반 사용자 | [일반 사용자 메뉴얼](moaworks-end-user-manual-v2.0.md) | 웹·Android에서 메일, 결재, 메신저, 일정, 주소록, 파일 사용 |
| 관리자·운영자 | [관리자·운영자 메뉴얼](moaworks-admin-operator-manual-v2.0.md) | 사용자, 조직, 권한, 메일, LLM, 감사, 변경 관리 |
| 설치 담당자 | [설치·배포 메뉴얼](moaworks-install-deploy-manual-v2.0.md) | 도메인, DNS, 네트워크, Docker, DB, HTTPS, OCI·자체 메일 설치 |
| 장애·백업 담당자 | [장애·백업·복구 메뉴얼](moaworks-incident-backup-recovery-manual-v2.0.md) | 장애 초동, 백업, 복원, 업데이트, 롤백, 재해 복구 |

## 지원 범위

- 웹 사용자 포털과 관리자 포털
- 메일, 전자결재, 메신저, 일정, 주소록, 조직도, 파일, 알림
- Android 실기기 주요 업무
- OCI Email Delivery와 자체 메일 엔진
- Cloudflare DNS, Reverse Proxy, PostgreSQL, Docker Compose
- LLM Provider 기반 번역 기능
- 백업·복구·업데이트·장애 대응

## 현재 보류 범위

iOS의 macOS/Xcode, Apple 서명, iPhone 네이티브 기능 검증은 보류 상태입니다. iOS 지원 완료로 안내하지 않으며, 검증이 끝난 뒤 별도 절차와 화면을 추가합니다.

## 화면과 보안

- 화면 예시는 검증된 프로젝트 증적 또는 설치 과정에서 사용자가 확인한 화면입니다.
- 계정 비밀번호, API 키, SMTP 자격 증명, 개인키, 세션 토큰, 전체 OCID는 포함하지 않습니다.
- 회사별 설치 시 `company.com` 예시를 실제 등록 도메인으로 바꿉니다.
- 관리자 주소는 회사 정책에 따라 외부 공개, VPN, 사내망, 허용 IP 중 하나를 선택합니다.

## 생성과 검증

```powershell
C:\Users\cyhuh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\manuals\build_moaworks_manuals.py
C:\Users\cyhuh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\manuals\render_moaworks_manuals.py <DOCX경로> --output_dir <QA출력경로> --emit_pdf
C:\Users\cyhuh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\manuals\verify_rendered_pages.py
C:\Users\cyhuh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\manuals\verify_moaworks_manuals.py
```

위 명령은 개발·문서 작성자가 사용합니다. 최종 사용자는 `output/`의 PDF 또는 DOCX만 열면 됩니다.

최종 배포 전에는 접근성 감사, 개인정보 메타데이터 제거, 전체 페이지 렌더링과 육안 검토를 추가로 수행합니다. 검사 요약은 `qa/verification.json`과 `qa/render-verification.json`에 기록합니다.
