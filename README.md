# MoaWorks

MoaWorks는 100인 이하 소기업을 위한 다국어 오픈소스 그룹웨어입니다.

현재 저장소의 설계 기준 문서는 [MoaWorks_Groupware_Design_v1.3.docx](D:/Project/MoaWorks/docs/MoaWorks_Groupware_Design_v1.3.docx)입니다.
문서, 코드, WSL 실행 검증을 함께 충족해야 단계 완료로 판정합니다.

## 제품 방향

- 핵심 기능: 메일, 전자결재, 알림, 관리자 운영, 다국어 UI, 서버 측 번역 연동
- 구조 원칙: `server`, `admin-web`, `user-web`, `desktop-client`, `mobile-app`의 5개 프로그램 구조
- 운영 원칙: 모든 운영 데이터의 최종 저장소는 PostgreSQL
- 검증 원칙: 완료 판정은 WSL 실행 환경 기준

## 저장소 구조

- `backend/`: `server` 구현 영역
- `frontend/`: `admin-web`, `user-web`, `desktop-client`, `mobile-app` 구현 영역
- `deploy/`: Docker Compose, 배포 자산
- `docs/`: 설계 문서, 단계 산출물, 운영 기준

## 단계 0 기준 문서

- [제품 범위표](docs/phase-0/product-scope.md)
- [시스템 컨텍스트 문서](docs/phase-0/system-context.md)
- [기술 기준선](docs/phase-0/technical-baseline.md)
- [핵심 테이블 정의서](docs/phase-0/core-tables.md)
- [핵심 API 정의서](docs/phase-0/core-apis.md)
- [권한 정책서](docs/phase-0/permission-policy.md)
- [운영 이벤트 정의서](docs/phase-0/operational-events.md)
- [운영정책 초안](docs/phase-0/operations-policy-draft.md)
- [승인 기준서](docs/phase-0/release-acceptance-criteria.md)
- [WSL 검증 절차서](docs/phase-0/wsl-validation-procedure.md)

## 개발 원칙 요약

- 일반 사용자용 클라이언트는 모두 동일한 서버 API만 호출합니다.
- 파일 기반 임시구현은 운영 산출물로 인정하지 않습니다.
- 직접 실행하지 않은 내용은 확인 결과로 보고하지 않습니다.
