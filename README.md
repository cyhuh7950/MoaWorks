# MoaWorks

MoaWorks는 100인 이하 글로벌 소기업을 위한 다국어 오픈소스 그룹웨어입니다.

현재 저장소는 메일·결재·메신저·번역·desktop/mobile·운영 기능을 단계별로 구현·검증하는 운영 완성 단계입니다.
기준 원격 저장소는 `cyhuh7950/MoaWorks`입니다.

## 제품 방향

- 핵심 기능: 메일, 전자결재, 업무 알림, 다국어 UI, 서버 측 AI 번역
- MVP 원칙: 운영형 시스템 우선, 화면 중심 설정, CLI 비의존, 장애 감지 우선
- 메일 발신 전략: 자체 SMTP 직접 발신과 OCI Email Delivery 보조 Provider를 운영자가 선택

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

1. F14 백업·복구·감시 revision을 sinsan에 배포하고 운영 훈련을 완료한다.
2. 공인 DNS·TCP 25·OCI credential을 준비해 실제 외부 메일 송수신 WAIT를 해소한다.
3. Android 실제 기기 검증을 완료하고 iOS 지원 범위를 결정한다.

## 현재 설치·운영 문서

- [설치·운영·장애 대응 매뉴얼 v2.1](docs/moaworks-installation-operations-manual-v2.1-2026-08-05.md)
- [F14 QA·설계 추적 대장](docs/reports/moaworks-f14-qa-traceability-2026-08-05.md)
- [외부 메일 운영 완성 작업계획서](docs/MoaWorks_Mail_Operations_Completion_Work_Plan_v2.1_2026-08-04.md)

과거 phase 문서는 당시 단계 증적으로 보존한다. 신규 설치는 위 v2.1 매뉴얼을 우선한다.
