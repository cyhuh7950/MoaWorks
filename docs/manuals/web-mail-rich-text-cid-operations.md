# 웹 메일 서식·CID 인라인 이미지 운영 매뉴얼

이 문서는 배포 절차가 아니다. 실제 적용·외부 발송·Provider 전환은 별도 승인된 Task 11에서만 수행한다. 모든 명령은 대상 revision, 권한 있는 운영 세션, 백업 가능 상태를 먼저 확인하고 실행하며 비밀값을 인수·로그·스크린샷에 넣지 않는다.

## 사전 조건과 판정

- 운영: `moaworks.sinsan.kr`, 개발: `dev.moaworks.sinsan.kr`를 분리한다. 과거 WSL 25/2525 우회 시험은 운영 증적이 아니다.
- 정상 서비스의 Oracle 고정 IP 및 25번 포트 개방, SPF/DKIM/PTR/방화벽은 발송 전 운영 담당자가 별도 확인한다. 이 매뉴얼은 이를 변경하지 않는다.
- 실행 revision을 `git rev-parse HEAD`로 기록하고, rollback 대상 revision도 함께 기록한다. health, DB backup/restore 경로와 현재 queue 처리가 확인되지 않으면 중단한다.

## Migration 065와 호환 경계

적용 여부는 운영 DB의 읽기 전용 세션에서 확인한다.

```sql
SELECT version FROM schema_migrations WHERE version = '065_mail_rich_text_cid';
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'mail_attachments'
  AND column_name IN ('content_disposition', 'content_id');
```

한 행의 migration version과 두 column이 보이면 통과다. 어느 하나라도 없으면 backend/web bundle 적용을 중단하고 migration 복구 절차로 간다. column은 자동 삭제하지 않는다. 구버전 frontend는 `bodyHtml=null`, 일반 `attachment`만 보내는 기존 payload를 계속 사용하며, 새 frontend가 `inline`/`contentId`를 이해하지 못하는 상태에서 CID 작성 기능을 노출하지 않는다.

## Preview 소유권 확인

fixture로 만든 동일 company owner의 staged inline upload만 사용한다. owner bearer로 `GET /api/v1/mail/attachments/staged/{uploadId}/preview`는 200과 image MIME을, 다른 user 또는 다른 company는 403 또는 존재 비노출 404를 반환해야 한다. 실제 URL·token은 로그에 남기지 않는다. owner가 아닌 응답이 200이면 즉시 중단하고 첨부 접근 권한을 복구한다.

## MIME·queue 확인

승인된 격리 fixture에서 HTML CID와 일반 첨부를 동시에 만든 뒤 queue와 원본 MIME을 대조한다.

```sql
SELECT id, message_id, status, attachment_count FROM mail_messages WHERE id = :mail_id;
SELECT id, content_disposition, content_id, file_name FROM mail_attachments WHERE message_id = :mail_id;
SELECT id, status, attempt_count, provider_config_id FROM mail_delivery_queue WHERE mail_id = :mail_id;
```

성공 기준은 HTML CID마다 inline row 하나, MIME의 `multipart/mixed > multipart/alternative > multipart/related`, inline part의 `Content-ID: <cid>`와 `Content-Disposition: inline`, 일반 파일의 `Content-Disposition: attachment`다. unknown CID, 참조되지 않은 inline, 다른 owner/company, reuse, duplicate CID는 새 mail row·queue·attached flag를 남기지 않아야 한다. 실패 흔적이 있으면 transaction rollback과 staged sidecar 복구를 먼저 확인한다.

## Provider 경계와 rollback

OCI Email Delivery가 주 엔진이고 self-hosted는 보조 엔진이다. provider lock과 최근 연결 검증이 성공 상태가 아니면 외부 queue는 blocked여야 하며, 운영자가 임의로 설정을 바꾸지 않는다. 전환은 승인된 provider revision과 health/queue drain 증적 후에만 한다. 실패 시 provider 설정을 바꾸기보다 queue/attempt/event와 MIME 오류를 보존해 원인을 판정한다.

frontend rollback은 배포 bundle을 기록한 이전 revision으로 되돌린 뒤 구버전 plain/general-attachment smoke를 실행한다. server rollback은 이전 backend revision으로 되돌리고, migration 065 column은 유지한다. data rollback은 backup 검증 없이 수행하지 않는다.

## Orphan·비밀 점검

orphan cleanup은 메일/attachment row와 storage sidecar의 참조가 모두 끊겼고 retention 정책이 허용할 때만 별도 승인으로 수행한다. `content_disposition='inline'` row나 migration column을 bulk delete/drop 하지 않는다. 로그는 `password`, `token`, `authorization`, `secret`, provider credential, bearer 값과 raw MIME attachment를 redaction한다. 오류 보고에는 provider 종류, queue ID의 안전한 식별자, 상태·시각만 남긴다.

## 종료 판정

이 문서의 SQL/fixture 검증은 local/isolated evidence다. 실제 `moaworks.sinsan.kr` browser, DB, self-hosted/OCI acceptance, Gmail/Outlook 수신은 Task 11의 승인된 별도 증적 없이는 통과로 표시하지 않는다.
