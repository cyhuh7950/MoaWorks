# 메일 총량 한도·관리자 MFA 관리 절차

## 1. 적용 범위와 금지사항

이 문서는 개발·테스트·staging·인수검증 환경의 migration 066~068, 메일 엔진 전체 일일 발송 한도, 관리자 MFA, 오프라인 2인 복구 절차를 다룹니다.

- Secret 원문, QR, 수동 키, OTP, 복구 코드, 개인키를 Git·명령 이력·로그·보고서·화면 캡처에 남기지 않습니다.
- DNS, PTR, blocklist, Provider 전환, 실제 재발송은 이 절차의 자동 실행 범위가 아닙니다.
- 새 DB나 Container를 만들지 않습니다. 기존 지정 DB를 사용하고 QA row는 고유 ID로만 정리합니다.
- migration 066~068은 additive schema입니다. 이미 적용된 schema나 보안 row를 되돌리기 목적으로 삭제하지 않습니다.

## 2. 사전 확인

저장소 루트에서 현재 브랜치와 변경 파일을 확인합니다.

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

DB 접속값은 Secret 주입 경로에서 process 환경변수로 제공합니다. 원문을 출력하지 않고 존재 여부만 확인합니다.

```powershell
$required = @('POSTGRES_HOST','POSTGRES_PORT','POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD')
$missing = $required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing) { throw "DB Secret 참조 누락: $($missing -join ', ')" }
```

적용 기록과 핵심 객체를 읽기 전용으로 확인합니다.

```sql
SELECT version, applied_at
FROM public.schema_migrations
WHERE version IN (
  '066_mail_sender_display_id.sql',
  '067_mail_engine_daily_send_limit.sql',
  '068_admin_mfa_and_active_limit.sql'
)
ORDER BY version;

SELECT
  to_regclass('public.mail_engine_daily_send_usage') AS quota_table,
  to_regclass('public.admin_mfa_profiles') AS mfa_profile_table,
  to_regclass('public.admin_mfa_break_glass_requests') AS break_glass_request_table,
  to_regclass('public.admin_mfa_break_glass_approvals') AS break_glass_approval_table;

SELECT conname
FROM pg_catalog.pg_constraint
WHERE conrelid IN (
  'public.user_mail_basic_preferences'::regclass,
  'public.users'::regclass,
  'public.admin_mfa_profiles'::regclass,
  'public.admin_mfa_challenges'::regclass
)
ORDER BY conname;

SELECT tgname, tgrelid::regclass
FROM pg_catalog.pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('users_admin_active_limit_guard','roles_admin_active_limit_guard')
ORDER BY tgname;
```

판정 기준은 migration row 3건, quota/MFA/break-glass table 비-null, sender mode CHECK에 `name`, `id`, `name_email`, 관리자 guard trigger 2건입니다. 하나라도 다르면 다음 단계로 진행하지 않고 실제 누락 객체와 migration 기록을 대조합니다.

## 3. 메일 엔진 전체 일일 발송 한도

`MAIL_ENGINE_DAILY_SEND_LIMIT`는 개인별 한도가 아니라 메일 엔진 전체 발송 시도 수입니다. PostgreSQL의 `Asia/Seoul` 날짜로 원자 예약하며 Provider 호출 직전에 증가합니다.

`MAIL_ENGINE_DAILY_SEND_LIMIT=0`은 제한이 비활성인 상태이며 보안 한도가 적용된 것으로 간주하면 안 됩니다.

- `0`: 제한 비활성. 보안 제한이 켜진 상태로 해석하지 않습니다.
- 양수: 해당 날짜에 N건을 허용하고 N+1번째 시도부터 Provider를 호출하지 않습니다.
- DB 오류·결과 누락·형식 오류: fail-closed. Provider를 호출하지 않습니다.
- 한도 소진: queue item은 `quota_deferred`로 보존하며 서울 날짜 자정 뒤 queue ID 기반 최대 300초 jitter를 적용합니다.
- 인증 메일도 같은 총량에 포함됩니다. 한도 소진 중 관리자 복구는 복구 코드 또는 2인 오프라인 절차를 사용합니다.

현재 사용량은 다음 읽기 전용 SQL로 확인합니다.

```sql
SELECT usage_date, attempt_count, updated_at
FROM public.mail_engine_daily_send_usage
WHERE usage_date >= (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date - 2
ORDER BY usage_date DESC;
```

양수 값 반영 전에는 승인된 값, queue 적체, 다음 서울 날짜 자정의 재개량을 함께 확인합니다. 긴급 비활성화가 승인된 경우에만 값을 `0`으로 바꾸며 usage row는 삭제하지 않습니다.

## 4. MFA Secret 사전 확인과 key 교체

필수 process 환경변수는 다음과 같습니다.

```text
ADMIN_MFA_TOTP_CURRENT_KEY_VERSION
ADMIN_MFA_TOTP_KEYRING
ADMIN_MFA_OTP_HMAC_KEY
ADMIN_MFA_RECOVERY_CODE_HMAC_KEY
ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING
```

- TOTP keyring은 양수 version을 key로 하고 base64 32-byte key를 값으로 하는 JSON 객체입니다.
- OTP·복구 코드 HMAC key는 각각 base64 32-byte 값입니다.
- break-glass keyring은 immutable approver ID별 `keyVersion`, base64 Ed25519 public key, `active`, 선택적 `boundUserId`를 가진 JSON 객체입니다.
- private key는 DB·Git·공유 서버에 두지 않습니다.

원문을 출력하지 않는 존재 확인:

```powershell
$required = @(
  'ADMIN_MFA_TOTP_CURRENT_KEY_VERSION',
  'ADMIN_MFA_TOTP_KEYRING',
  'ADMIN_MFA_OTP_HMAC_KEY',
  'ADMIN_MFA_RECOVERY_CODE_HMAC_KEY',
  'ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING'
)
$missing = $required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing) { throw "MFA Secret 참조 누락: $($missing -join ', ')" }

function Assert-CanonicalBase64Key32([string]$name, [string]$value) {
  if ([regex]::IsMatch($value, '\s')) { throw "$name 값에는 공백이나 개행을 사용할 수 없습니다." }
  try { $bytes = [Convert]::FromBase64String($value) } catch { throw "$name 값은 올바른 base64여야 합니다." }
  if ($bytes.Length -ne 32) { throw "$name 값은 32-byte key여야 합니다." }
  if (-not [string]::Equals([Convert]::ToBase64String($bytes), $value, [System.StringComparison]::Ordinal)) {
    throw "$name 값은 canonical base64여야 합니다."
  }
}

$currentVersion = 0
$currentText = [Environment]::GetEnvironmentVariable('ADMIN_MFA_TOTP_CURRENT_KEY_VERSION')
if (-not [int]::TryParse($currentText, [ref]$currentVersion) -or $currentVersion -le 0) {
  throw 'MFA current key version은 양수 정수여야 합니다.'
}

try {
  $totpKeyring = [Environment]::GetEnvironmentVariable('ADMIN_MFA_TOTP_KEYRING') | ConvertFrom-Json -AsHashtable
} catch {
  throw 'MFA TOTP keyring은 올바른 JSON 객체여야 합니다.'
}
if (-not $totpKeyring.ContainsKey([string]$currentVersion)) {
  throw 'MFA current key version이 TOTP keyring에 없습니다.'
}
foreach ($entry in $totpKeyring.GetEnumerator()) {
  $version = 0
  if (-not [int]::TryParse([string]$entry.Key, [ref]$version) -or $version -le 0) {
    throw 'MFA TOTP keyring version은 모두 양수 정수여야 합니다.'
  }
  Assert-CanonicalBase64Key32 'MFA TOTP keyring' ([string]$entry.Value)
}

foreach ($hmacName in @('ADMIN_MFA_OTP_HMAC_KEY', 'ADMIN_MFA_RECOVERY_CODE_HMAC_KEY')) {
  Assert-CanonicalBase64Key32 $hmacName ([Environment]::GetEnvironmentVariable($hmacName))
}

try {
  $breakGlassKeyring = [Environment]::GetEnvironmentVariable('ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING') | ConvertFrom-Json -AsHashtable
} catch {
  throw 'MFA break-glass keyring은 올바른 JSON 객체여야 합니다.'
}
if ($breakGlassKeyring -isnot [System.Collections.IDictionary] -or $breakGlassKeyring.Count -lt 1) {
  throw 'MFA break-glass keyring은 한 명 이상의 approver를 가진 JSON 객체여야 합니다.'
}
foreach ($entry in $breakGlassKeyring.GetEnumerator()) {
  $approverId = [string]$entry.Key
  if ([string]::IsNullOrWhiteSpace($approverId)) { throw 'MFA break-glass approver ID는 비어 있을 수 없습니다.' }
  if ($entry.Value -isnot [System.Collections.IDictionary]) { throw 'MFA break-glass approver 항목은 JSON 객체여야 합니다.' }
  $approver = $entry.Value
  $keyVersion = 0
  if (-not $approver.ContainsKey('keyVersion') -or -not [int]::TryParse([string]$approver['keyVersion'], [ref]$keyVersion) -or $keyVersion -le 0) {
    throw 'MFA break-glass keyVersion은 양수 정수여야 합니다.'
  }
  Assert-CanonicalBase64Key32 'MFA break-glass publicKey' ([string]$approver['publicKey'])
  if (-not $approver.ContainsKey('active') -or $approver['active'] -isnot [bool]) {
    throw 'MFA break-glass active는 boolean이어야 합니다.'
  }
  if ($approver.ContainsKey('boundUserId') -and ($approver['boundUserId'] -isnot [string] -or [string]::IsNullOrWhiteSpace($approver['boundUserId']))) {
    throw 'MFA break-glass boundUserId는 생략하거나 비어 있지 않은 문자열이어야 합니다.'
  }
}
'MFA_SECRET_PREFLIGHT_PASS'
```

동일 계약의 재현 가능한 합성값 검증은 Secret 원문을 출력하지 않습니다.

```powershell
pwsh -NoProfile -File backend/scripts/task11_mfa_secret_preflight_verify.ps1 -SelfTest
```

TOTP key 교체 순서:

1. 기존 current key와 과거 decrypt key를 keyring에 유지한 채 새 key version을 추가합니다.
2. 새 version을 current로 지정하고 신규 암호화만 새 key로 수행합니다.
3. batch별로 decrypt→새 nonce/AAD(`profile_id|user_id|key_version`)→encrypt 후 재검증합니다.
4. 아래 SQL 결과에서 과거 version row가 0이고 되돌리기 기간이 끝난 뒤에만 old key를 제거합니다.

```sql
SELECT totp_key_version, count(*)
FROM public.admin_mfa_profiles
WHERE totp_key_version IS NOT NULL
GROUP BY totp_key_version
ORDER BY totp_key_version;
```

batch 재암호화 도구가 준비되지 않은 환경에서는 old key를 제거하거나 current version을 단독으로 바꾸지 않습니다.

## 5. 관리자 등록 상태와 최대 3명 확인

관리 권한 계정은 `user_type='admin'` 또는 role permission에 `admin:*`가 있는 사용자입니다.

```sql
SELECT u.id, u.email, u.status, u.user_type, r.id AS role_id,
       (p.status = 'active') AS mfa_active,
       p.profile_version, u.auth_session_version
FROM public.users AS u
LEFT JOIN public.roles AS r ON r.id = u.role_id
LEFT JOIN public.admin_mfa_profiles AS p ON p.user_id = u.id
WHERE u.user_type = 'admin'
   OR pg_catalog.jsonb_exists(COALESCE(r.permissions, '[]'::jsonb), 'admin:*')
ORDER BY u.id;
```

판정 기준:

- active 관리 권한 계정은 최대 3명입니다.
- 신규·승격·재활성 계정은 `pending_mfa`에서 이메일 확인과 TOTP 등록을 마친 뒤 같은 transaction에서 active로 전환해야 합니다.
- 미등록 active 관리 권한 계정, 4번째 active 전환, MFA material 일부만 채워진 profile은 허용하지 않습니다.

## 6. `optional`에서 `required`로 전환

먼저 `ADMIN_MFA_ENFORCEMENT=optional`에서 모든 active 관리 권한 계정의 MFA 등록을 완료합니다. 아래 transaction은 승인된 전환 때만 실행합니다.

```sql
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(1297043287, 3);
SELECT singleton, enforcement_mode, required_epoch
FROM public.admin_mfa_policy
WHERE singleton = TRUE
FOR UPDATE;

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users AS u
    LEFT JOIN public.roles AS r ON r.id = u.role_id
    LEFT JOIN public.admin_mfa_profiles AS p ON p.user_id = u.id
    WHERE u.status = 'active'
      AND (u.user_type = 'admin' OR pg_catalog.jsonb_exists(COALESCE(r.permissions, '[]'::jsonb), 'admin:*'))
      AND (p.user_id IS NULL OR p.status <> 'active')
  ) THEN
    RAISE EXCEPTION 'ACTIVE_PRIVILEGED_ADMIN_WITHOUT_MFA';
  END IF;
END
$check$;

UPDATE public.admin_mfa_policy
SET enforcement_mode = 'required',
    required_epoch = required_epoch + 1,
    updated_at = statement_timestamp()
WHERE singleton = TRUE;

UPDATE public.users AS u
SET auth_session_version = auth_session_version + 1,
    updated_at = statement_timestamp()
FROM public.roles AS r
WHERE r.id = u.role_id
  AND u.status = 'active'
  AND (u.user_type = 'admin' OR pg_catalog.jsonb_exists(COALESCE(r.permissions, '[]'::jsonb), 'admin:*'));
COMMIT;
```

그 뒤 process 설정을 `ADMIN_MFA_ENFORCEMENT=required`로 반영하고 관리 화면의 password→TOTP→token 흐름을 확인합니다. 이전 token은 profile version, policy epoch, session version 중 하나라도 다르면 401이어야 합니다.

되돌릴 때도 epoch와 session version을 감소시키지 않습니다. 승인된 경우 mode를 `optional`로 바꾸면서 epoch와 관리 권한 사용자의 session version을 다시 증가시키고, 기존 MFA profile과 challenge 감사 기록은 보존합니다.

## 7. 오프라인 2인 break-glass

두 승인자는 서로 다른 active immutable approver ID와 외부 보관 Ed25519 private key를 사용합니다. 자기승인, 같은 approver의 중복 승인, 만료·payload mismatch는 거부됩니다.

아래 `<격리-폴더>`는 저장소 밖의 소유자 전용 폴더입니다. 이유 원문은 별도 파일로 만들고 shell argument에 직접 쓰지 않습니다.

```powershell
Set-Location D:\Project\MoaWorks\backend
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass request `
  --target-user-id <대상-user-id> `
  --reason-file <격리-폴더>\reason.txt `
  --correlation-id <승인-correlation-id> `
  --expires-in-minutes 15 `
  --out <격리-폴더>\request.json
```

각 승인자는 DB 접속 없이 자신의 별도 장치에서 서명합니다.

```powershell
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass sign `
  --request <격리-폴더>\request.json `
  --approver-id <승인자-id> `
  --key-version <version> `
  --private-key-file <외부-private-key-file> `
  --out <격리-폴더>\approval-1.json
```

두 서명 파일을 각각 등록하고 1회 실행합니다.

```powershell
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass approve --request-id <request-id> --approval-file <격리-폴더>\approval-1.json
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass approve --request-id <request-id> --approval-file <격리-폴더>\approval-2.json
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass execute --request-id <request-id> --challenge-output <격리-폴더>\reenroll-challenge.json
```

성공 기준:

- request가 `consumed`이고 두 distinct approval만 존재합니다.
- 대상 사용자의 `auth_session_version`과 MFA `profile_version`이 증가합니다.
- 이전 open challenge는 취소됩니다.
- 출력은 10분 `mfa_reenroll` challenge뿐이며 full 관리자 token이나 active 전환은 없습니다.
- output은 기존 파일을 덮어쓰지 않고 Windows에서는 현재 SID 전용 ACL, POSIX에서는 owner-only mode입니다.

중단·오입력·미사용 pending request는 취소합니다.

```powershell
.\.venv\Scripts\python.exe -m app.cli.admin_mfa_break_glass cancel --request-id <request-id> --reason-file <격리-폴더>\cancel-reason.txt
```

완료 후 request·approval 감사 row는 보존하고 reason/private key/challenge 임시 파일은 승인된 보존기간 뒤 소유자가 정확한 파일 단위로 정리합니다.

## 8. 코드 되돌리기 순서

1. 새 MFA enrollment 시작을 중단하고 pending break-glass request를 `cancel`합니다.
2. current/old TOTP decrypt key와 break-glass old public key를 모두 유지합니다.
3. 코드 revision을 되돌리되 migration 066~068 schema와 기존 row는 삭제하지 않습니다.
4. quota 긴급 비활성화가 승인됐으면 값을 `0`으로 반영하고 usage row는 보존합니다.
5. MFA mode 변경이 승인됐으면 `optional`로 바꾸되 policy epoch·profile version·session version을 감소시키지 않습니다.
6. sender preference의 `id` row는 보존하고 구버전 client가 `name`으로 안전하게 fallback하는지 확인합니다.
7. 전체 backend·웹·모바일 회귀와 stale token 거부를 다시 실행합니다.

## 9. 인수검증 명령

```powershell
Set-Location D:\Project\MoaWorks\backend
.\.venv\Scripts\python.exe -m pytest -q -k "mail or auth or admin"

Set-Location D:\Project\MoaWorks\frontend\user-web
npm test
npm run verify:mail-rich-editor
npm run build
node scripts\phase5-mail-popup-verify.mjs

Set-Location D:\Project\MoaWorks\frontend\admin-web
npm test
npm run build
node scripts\admin-mfa-runtime-verify.mjs

Set-Location D:\Project\MoaWorks\frontend\mobile-app
npm test
npm run bundle
```

실행할 수 없는 항목은 PASS로 표시하지 않습니다. 사유·영향·시도·재검증 조건을 보고서에 기록하고 다른 독립 검증을 계속합니다.
