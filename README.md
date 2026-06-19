# MoaWorks

MoaWorks는 100인 이하 글로벌 소기업을 위한 다국어 오픈소스 그룹웨어입니다.

현재 저장소 상태는 `단계 0: 준비 및 동결` 기준으로 초기 골격과 운영 문서를 고정한 상태입니다.
기준 원격 저장소는 `cyhuh7950/MoaWorks`입니다.

## 제품 방향

- 핵심 기능: 메일, 전자결재, 업무 알림, 다국어 UI, 서버 측 AI 번역
- MVP 원칙: 운영형 시스템 우선, 화면 중심 설정, CLI 비의존, 장애 감지 우선
- 메일 발신 전략: 자체 SMTP 직접 발신이 아니라 외부 Relay 기본

## 저장소 구조

- `backend/`: Core Backend 구현 영역
- `frontend/`: 관리자 웹, 사용자 웹, 설치형 프로그램, 앱 구현 영역
- `deploy/`: Docker Compose, 인프라, 운영 배포 자산
- `docs/`: 설계 고정 문서와 운영 기준
- `.github/`: 이슈/PR 템플릿

## 단계 0 산출물

- [제품 범위표](docs/phase-0/product-scope.md)
- [핵심 테이블 정의서](docs/phase-0/core-tables.md)
- [핵심 API 정의서](docs/phase-0/core-apis.md)
- [시스템 컨텍스트 다이어그램](docs/phase-0/system-context.md)
- [기술 기준선](docs/phase-0/technical-baseline.md)
- [개발 규칙서](docs/phase-0/development-rules.md)
- [운영정책 초안](docs/phase-0/operations-policy-draft.md)
- [릴리즈 승인 기준서](docs/phase-0/release-acceptance-criteria.md)
- [단계 0 완료 보고서](docs/phase-0/completion-report.md)
- [단계별 운영 템플릿](docs/roadmap/stage-plan.md)
- [단계 0 완료 체크리스트](docs/phase-0/stage-0-checklist.md)

## 단계 0 결정 요약

- 저장소는 `backend / frontend / deploy / docs` 단일 모노레포로 시작한다.
- 서버는 공통 API와 비즈니스 로직을 담당하고, 관리자 웹은 운영자 전용 화면으로 분리한다.
- 사용자 웹, 설치형 프로그램, 앱은 모두 일반 사용자용 업무 클라이언트이며 서버 API만 호출한다.
- MVP 범위는 P0 기능 중심으로 고정하고, P1/P2는 구조만 고려하고 구현은 제외한다.
- 환경 분리 기준은 `local / dev / staging / production`으로 통일한다.
- API는 `/api/v1` 버전 정책을 기본으로 시작한다.

## 다음 단계

1. 관리자 웹과 서버를 실제 DB/Relay 검증으로 연결한다.
2. 사용자/조직/권한, 메일 계정 자동 생성 흐름으로 확장한다.
3. 일반 사용자용 3개 클라이언트가 공통으로 호출할 인증/API 계약을 고정한다.
