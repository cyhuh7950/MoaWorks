# 웹 메일 서식·CID 인라인 이미지 운영 매뉴얼

Task 11 승인 전 배포, provider 전환, 외부 발송을 실행하지 않는다. `${...}`는 권한 있는 운영 세션에서만 주입하며 secret 원문을 echo·로그·보고서에 남기지 않는다.

## 자동 증적 matrix

| lifecycle | content | valid/invalid | provider | success/failure invariant | test file::class.method | evidence type |
| --- | --- | --- | --- | --- | --- | --- |
| new | plain | valid | self_hosted/oci_email_delivery | 메모리 job이 worker·router를 지나 MIME를 구성 | `test_ui021_mail_integration.py::Ui021Tests.test_queued_cid_job_reaches_worker_routing_and_mime_for_self_hosted_and_oci` | isolated worker→routing→MIME; DB queue 증거 아님 |
| draft/send/schedule | html+inline | valid | n/a | mail/attachment DB statement와 canonical sidecar attached | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_send_and_schedule_persist_canonical_inline_metadata` | service/DB statement/sidecar fixture |
| draft | html+inline | unknown/unreferenced/foreign/reused/duplicate CID | n/a | 첫 DB statement 전 거부 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_save_rejects_invalid_inline_lifecycle_before_database_mutation` | sanitizer/storage/service fixture |
| queued delivery | html+inline | valid persisted row/sidecar | n/a | DB claim 결과가 verified inline metadata·SHA256 envelope를 구성 | `test_mail_inline_attachments.py::MailInlineQueueAndDownloadTests.test_queue_claim_carries_verified_inline_metadata_and_sha256` | DB cursor/storage claim fixture |
| provider switch/rollback | plain/html | valid queued rows | self_hosted/oci_email_delivery | 기존 queue provider pin 유지, 새 provider만 전환 | `test_stage01_mail_operations_persistence.py::MailOperationsPersistenceTest.test_provider_switch_pins_existing_queue_without_updating_queue_rows`; `test_stage01_mail_operations_persistence.py::MailOperationsPersistenceTest.test_provider_rollback_restores_previous_provider_without_rewriting_queue` | DB cursor policy fixture |
| delivery failure | plain/html | transient/permanent | self_hosted/oci_email_delivery | retry_pending 또는 failed, cross-provider fallback 없음 | `test_stage01_mail_delivery_failures.py::MailDeliveryFailureTest.test_transient_transport_failure_is_scheduled_for_retry`; `test_stage01_mail_delivery_failures.py::MailDeliveryFailureTest.test_permanent_transport_failure_is_not_cross_provider_retried` | worker/provider failure fixture |
| draft | html+inline | retained valid | n/a | 같은 mail row, persisted/new attachment 원자 연결 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_retains_persisted_attachment_by_attachment_id_and_only_inserts_new_staged_upload` | service/DB fixture |
| draft | html+inline+ordinary | unknown retained ID | n/a | attachment/message mutation 없음 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_rejects_unknown_retained_id_without_mutation` | service/DB fixture |
| draft | html+inline+ordinary | other user/company | n/a | attachment insert/update/commit 전 거부 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_denies_other_user_and_company_before_mutation` | owner-filtered service/DB fixture |
| draft | retained only | duplicate retained ID | n/a | schema에서 요청 거부 | `test_ui018_mail_compose.py::Ui018MailComposeTests.test_draft_update_accepts_retained_only_content_but_rejects_duplicate_retained_id` | schema boundary |
| draft | retained+new | count/size 초과 | n/a | mutation 전 제한 거부 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_enforces_combined_retained_count_and_size_before_mutation` | service/DB fixture |
| draft | html+inline | CID/body 불일치 | n/a | update/sidecar mutation 없음 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_rejects_retained_inline_without_matching_body_cid` | sanitizer/service boundary |
| draft | html+inline+ordinary | commit failure | n/a | 기존/신규 sidecar 복원, 두 번째 message row 없음 | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_commit_failure_restores_removed_and_new_sidecars`; `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_draft_update_removes_unretained_and_inserts_new_without_second_message_row` | transaction/sidecar fixture |
| scheduled | html+inline+ordinary | valid remove/add | n/a | 제거 detach·retained/new attach·commit | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_scheduled_update_commits_removed_detached_and_retained_new_attached` | service/DB/sidecar fixture |
| scheduled | html+inline+ordinary | mark/commit failure | n/a | 신규 sidecar와 transaction rollback | `test_mail_inline_attachments.py::MailInlinePersistenceTests.test_scheduled_update_restores_new_sidecar_on_mark_or_commit_failure` | service/DB/sidecar fixture |
| reply/reply_all | html | valid source | n/a | source action requires source mail, copy disallowed | `test_ui019_reply_forward.py::Ui019ReplyForwardTests.test_compose_action_requires_valid_source_combination` | schema boundary |
| forward | html+inline+ordinary | CID source valid; foreign rejected | self_hosted/oci_email_delivery | inline CID/ordinary disposition survives MIME | `test_ui019_reply_forward.py::Ui019ReplyForwardTests.test_forward_save_boundary_explicitly_allows_inline_source_for_cid_copy`; `test_ui021_mail_integration.py::Ui021Tests.test_queued_cid_job_reaches_worker_routing_and_mime_for_self_hosted_and_oci` | source + queue/MIME boundary |

위 표는 각 자동화 경계의 조합 증거다. 단일 테스트가 live PostgreSQL save→queue→worker→SMTP를 끝까지 실행한다고 주장하지 않는다. 그 실제 연결은 Task 11의 별도 승인된 staging 검증 항목이다.

## 공통 사전 조건

대상은 운영 `moaworks.sinsan.kr` 또는 개발 `dev.moaworks.sinsan.kr` 중 하나를 명시한다. 과거 WSL 25/2525 우회 시험은 운영 증적이 아니다. 현재/rollback revision과 health, backup, queue drain 책임자를 먼저 기록한다.

```bash
git rev-parse HEAD
git rev-parse <approved-rollback-revision>
curl --silent --show-error --fail "${API_BASE}/health"
```

성공은 두 revision과 health 확인이다. 실패 시 DNS/IP/provider를 변경하지 않고 승인자에게 반환한다.

## Migration 065와 구버전 fallback

runner는 `backend/app/services/postgres_service.py`에서 filename 전체를 `schema_migrations.version`에 저장한다. 따라서 `065_mail_inline_attachments.sql`을 확인한다. 사전 조건은 읽기 전용 DB URI가 환경에 주입된 것이다.

```bash
psql "$MOAWORKS_READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 -v mail_id="$QA_MAIL_ID" <<'SQL'
SELECT version FROM schema_migrations WHERE version = '065_mail_inline_attachments.sql';
SELECT c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
WHERE t.relname='mail_attachments' AND c.conname IN
 ('mail_attachments_content_disposition_check','mail_attachments_inline_content_id_check');
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname=current_schema() AND tablename='mail_attachments'
 AND indexname='uq_mail_attachments_message_content_id';
SELECT id, status, attachment_count FROM mail_messages WHERE id = :'mail_id';
SQL
```

성공은 filename 한 행, 두 CHECK, `message_id,content_id WHERE content_id IS NOT NULL` partial unique index, `mail_messages.id` 조회다. 하나라도 없으면 rollout을 중단하고 migration runner/backup 상태를 복구 담당자에게 넘긴다. column/constraint/index는 자동 삭제하지 않는다. 구버전 frontend는 `bodyHtml=null`과 일반 `attachment`만 보내므로, 구 bundle이 남으면 CID UI를 rollout하지 않는다.

## Preview 소유권

사전 조건: agent-created QA owner/other-user/other-company fixture와 bearer가 환경으로 주입됐다.

```bash
QA_PREVIEW_HEADERS="$(mktemp)"
trap 'rm -f "$QA_PREVIEW_HEADERS"' EXIT
curl -sS -D "$QA_PREVIEW_HEADERS" -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ${QA_OWNER_BEARER}" "${API_BASE}/api/v1/mail/attachments/staged/${QA_UPLOAD_ID}/preview"
grep -Eiq '^content-type: image/(png|jpeg|webp)' "$QA_PREVIEW_HEADERS"
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ${QA_OTHER_USER_BEARER}" "${API_BASE}/api/v1/mail/attachments/staged/${QA_UPLOAD_ID}/preview"
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ${QA_OTHER_COMPANY_BEARER}" "${API_BASE}/api/v1/mail/attachments/staged/${QA_UPLOAD_ID}/preview"
```

성공은 owner 200(image MIME), 다른 user/company 403 또는 비노출 404다. 다른 actor가 200이면 발송/cleanup을 중단하고 fixture/access log를 보존해 권한 rollback을 요청한다.

## MIME·queue·실패 rollback

사전 조건: 격리 fixture mail ID와 secret 없는 raw `.eml` 사본이다.

```bash
python - <<'PY'
import os
from email import policy
from email.parser import BytesParser
from pathlib import Path
m=BytesParser(policy=policy.default).parsebytes(Path(os.environ["QA_EML_PATH"]).read_bytes())
print(m.get_content_type())
for p in m.walk():
 if p.get_content_disposition() in {"inline","attachment"}: print(p.get_content_disposition(),p.get("Content-ID"),p.get_filename())
PY
psql "$MOAWORKS_READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 -v mail_id="$QA_MAIL_ID" -c "SELECT id,content_disposition,content_id,file_name FROM mail_attachments WHERE message_id=:'mail_id';"
psql "$MOAWORKS_READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 -v mail_id="$QA_MAIL_ID" -c "SELECT id,status,attempt_count,provider_config_id FROM mail_delivery_queue WHERE mail_id=:'mail_id';"
```

성공은 `multipart/mixed > multipart/alternative > multipart/related`, CID별 `Content-ID`/inline, 일반 파일 attachment와 DB/queue 일치다. unknown CID, unreferenced inline, foreign owner/company, reused upload, duplicate CID 실패에는 새 mail row·queue·attached sidecar가 없어야 한다. 남으면 transaction/sidecar rollback을 먼저 수행하고 fixture를 보존한다.

## Provider lock·drain·전환/원복

사전 조건: admin QA bearer, 승인된 provider revision, queue drain owner가 있다.

```bash
curl -sS -H "Authorization: Bearer ${QA_ADMIN_BEARER}" "${API_BASE}/api/v1/admin/mail-delivery/status" \
  | jq -e '.provider.deliveryEnabled == true and .provider.lastTestStatus == "success" and ((.summary.processing // 0) == 0)'
curl -sS -H "Authorization: Bearer ${QA_ADMIN_BEARER}" "${API_BASE}/api/v1/admin/mail-delivery/queue?status=processing" \
  | jq -e '.total == 0'
```

성공은 provider enabled/최근 연결 시험 성공, processing queue 0건이다. 승인된 변경 창에서만 아래 전환을 실행한다. `${TARGET_PROVIDER}`는 `oci_email_delivery` 또는 `self_hosted` 중 승인값이며 실제 응답의 `activeProvider`와 revision을 기록한다.

```bash
curl --silent --show-error --fail -X POST \
  -H "Authorization: Bearer ${QA_ADMIN_BEARER}" \
  -H 'Content-Type: application/json' \
  --data "{\"targetProvider\":\"${TARGET_PROVIDER}\"}" \
  "${API_BASE}/api/v1/admin/mail-operations/providers/switch" \
  | jq -e --arg expected "$TARGET_PROVIDER" '.activeProvider == $expected'
```

전환 후 provider 연결 시험·queue drain·격리 QA 발송 중 하나라도 실패하면 새 발송을 중지하고 아래 API 원복을 한 번 실행한다. 원복 응답의 provider/revision을 확인한 뒤 queue 상태를 다시 조회한다. SQL 직접 update와 credential 포함 curl은 금지한다.

```bash
curl --silent --show-error --fail -X POST \
  -H "Authorization: Bearer ${QA_ADMIN_BEARER}" \
  "${API_BASE}/api/v1/admin/mail-operations/providers/rollback" \
  | jq -e --arg expected "$ROLLBACK_PROVIDER" '.activeProvider == $expected'
curl --silent --show-error --fail \
  -H "Authorization: Bearer ${QA_ADMIN_BEARER}" \
  "${API_BASE}/api/v1/admin/mail-delivery/queue?status=processing" \
  | jq -e '.total == 0'
```

## Frontend/server rollback·orphan·redaction

frontend/backend는 기록한 exact revision으로 함께 되돌리고 plain/general attachment smoke를 한다. migration 065와 inline row/CHECK/index는 유지하며 DB restore는 backup 검증/별도 승인 없이는 실행하지 않는다.

```bash
git -C "$BACKEND_CHECKOUT" switch --detach "$ROLLBACK_REVISION"
git -C "$FRONTEND_CHECKOUT" switch --detach "$ROLLBACK_REVISION"
test "$(git -C "$BACKEND_CHECKOUT" rev-parse HEAD)" = "$ROLLBACK_REVISION"
test "$(git -C "$FRONTEND_CHECKOUT" rev-parse HEAD)" = "$ROLLBACK_REVISION"
```

위 명령은 승인된 격리 checkout을 exact revision에 고정하는 단계다. 서비스 재시작·artifact 교체는 해당 환경의 승인된 배포 명령으로만 수행하며, health와 plain/general attachment smoke 실패 시 새 revision을 다시 배포하지 않고 기존 프로세스/artifact를 유지한다.

FK `ON DELETE CASCADE` 때문에 DB row끼리의 orphan 조회만으로 storage sidecar orphan을 찾을 수 없다. 아래 dry-run은 DB가 참조하는 `storage_key`와 `${MOAWORKS_STORAGE_PATH}/mail/uploads/*.json`의 `attached=true` metadata를 대조하고, DB 참조가 없는 sidecar 파일명만 출력한다.

```bash
SIDECAR_DB_KEYS="$(mktemp)"
export SIDECAR_DB_KEYS
trap 'rm -f "$SIDECAR_DB_KEYS"' EXIT
psql "$MOAWORKS_READONLY_DATABASE_URL" -At -v ON_ERROR_STOP=1 \
  -c "SELECT storage_key FROM mail_attachments WHERE storage_key IS NOT NULL" > "$SIDECAR_DB_KEYS"
python - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["MOAWORKS_STORAGE_PATH"]).resolve() / "mail" / "uploads"
referenced = set(Path(os.environ["SIDECAR_DB_KEYS"]).read_text(encoding="utf-8").splitlines())
for metadata_path in sorted(root.glob("*.json")):
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("attached") and metadata.get("storageKey") not in referenced:
        print(metadata_path.name)
PY
```

출력이 없어야 통과다. 출력이 있으면 retention 만료·binary/metadata 양측 비참조·backup·별도 승인 전 삭제하지 않으며, DB row 복원 또는 sidecar 격리 중 승인된 복구 방식을 적용한다.

```bash
grep -RIlE '(authorization|token|password|secret|bearer)' "${SAFE_LOG_DIR}" || true
```

출력은 redacted ticket에만 저장하고 bearer/provider credential/raw attachment/MIME를 첨부하지 않는다.

## 네트워크 경계

운영에서는 Oracle 고정 IP의 TCP/25, SPF, DKIM, PTR, 방화벽을 운영 담당자가 확인한다. 개발/WSL 25·2525 결과로 대체하지 않는다.

```bash
nc -vz "${ORACLE_RELAY_HOST}" 25
dig +short TXT "${SENDER_DOMAIN}"
dig +short TXT "${DKIM_SELECTOR}._domainkey.${SENDER_DOMAIN}"
dig +short -x "${ORACLE_FIXED_IP}"
```

성공은 승인된 운영 대상에서 네 확인이 기록되는 것이다. 실패 시 DNS/IP/방화벽을 임의 변경하지 않고 네트워크 담당자의 rollback/변경 승인으로 반환한다.
