# Backend 병합 회귀 복구 작업자 보고서

## 판정

`SUCCESS` — 사용자 승인으로 확정된 11개 제품·테스트·Compose 파일 범위에서 `64df3e2` 병합 손상을 복구했다. 전체 backend discovery는 582건 모두 통과했고 기존 명시 skip 2건만 남았다. 병합·push·배포·운영 DB 변경은 수행하지 않았다.

## 판단 이유

- 정상 부모 `a34c0fd`, 손상된 현재 파일, 후속 계약을 3자 대조해 유실된 import·정의·정책·SQL cast·보안 제한만 복원했다.
- 메일 상세 외부 발송 조회는 현재 migration 025 계약인 `provider_config_id`를 통해 `mail_provider_configs.provider_type`을 조회하며, 수신자·첨부·저장 읽기 정책 계약을 보존한다.
- directory 응답의 부서 코드와 `mustChangePassword`, 단일 결재 요청 schema, active approver 조회를 복원했다.
- 조직 import 자원 제한, content status literal 및 PostgreSQL text cast, 두 Compose의 잘못된 프런트 런타임 주입을 복구했다.
- 중복 `MailAttachmentView`를 하나로 통합하고 `attachmentId` 응답 계약을 복원했다. 기존 테스트 삭제·skip 추가·완화는 없고 승인된 UI017 exact 응답만 현재 계약으로 갱신했다.

## TDD 및 예외 처리

- 최초 RED: 전체 329건 중 failure 5, error 49, skipped 2. 대표 원인은 메일 서비스 구문 손상, `dataclass`·`date` 유실, schema/method 중복 덮어쓰기, PostgreSQL cast 유실이었다.
- 구문·import 복원 후 전체 discovery가 실제 582건으로 확장됐다. 동일 `64df3e2` 병합 손상 근본 원인이 3회 반복되어 일시중단·예외 보고했고, 2026-08-24 사용자 승인을 받아 범위를 순차적으로 11개 파일까지 확정한 뒤 재개했다.
- 첨부 ID 계약은 UI017에서 RED 1건을 확인한 뒤 schema 중복을 제거하고 GREEN 9/9를 확인했다.
- 독립 1차 리뷰 Critical 1 / Important 3 / Minor 0의 네 지적을 재현·분류했다. 승인 범위 안에서 응답 매핑, 저장 읽기 정책, directory 필드, 첨부 ID를 보완했다.
- 중간 재리뷰의 Critical 1은 레거시/현재 큐 컬럼 혼합 SQL이었다. migration 025 기준 조인으로 교정한 뒤 직접 current-schema 계약과 전체 검증을 fresh 재실행했다.

## 검증

- `python -X pycache_prefix=... -m compileall -q app` → PASS.
- current queue schema 직접 계약 → PASS; `provider_config_id` 조인, `provider_type` 매핑, `q.provider_key` 부재.
- 근본 원인·리뷰·Compose 집중 회귀 → 36/36 PASS.
- UI017 mail detail → 9/9 PASS.
- `python -m unittest discover -s backend -p "test_*.py" -v` → 582/582 PASS, skipped 2, failure 0, error 0.
- F13 personal AI → 28/28 PASS.
- Stage03 translation operations → 30/30 PASS.
- `git diff --check` → PASS.
- 독립 최종 재리뷰 → Critical 0 / Important 0 / Minor 0, reviewer focused 18/18 및 diff-check PASS, 코드·문서·커밋 변경 없음.

## 작업 오류와 반복 기준

- 승인 전 동일 병합 손상 근본 원인 반복 횟수는 3회이며 규칙에 따라 중단·예외 보고했다. 사용자 승인 후 같은 제품 근본 원인의 연속 반복은 0회다.
- 검증 명령의 테스트 모듈명 오기 2건과 Windows `rg.exe` 실행 권한 오류는 제품 오류가 아니며 정확한 모듈명과 PowerShell 검색으로 즉시 교정했다.
- `errorCount`는 제품 근본 원인 반복 3회와 도구·명령 오류 3건을 합산해 6으로 기록한다.

## 미검증 및 다음 조치

- 운영 API/DB/Provider, 실제 인증 세션, 배포, iOS·실기기 검증은 실행하지 않았다.
- main agent가 최종 diff와 증적 parity를 수용한 뒤 AGENTS.md 순서대로 main 병합, 원격 main push, 작업 브랜치 정리를 수행해야 한다.

## 변경 범위

- 승인된 제품·테스트·Compose 11개 파일.
- 승인·예외·검증을 반영한 계획/작업지시/worker prompt 3개, master/stage progress 2개.
- 본 보고서와 구조화 결과 2개.
