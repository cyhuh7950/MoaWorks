[CmdletBinding()]
param(
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredNames = @(
  'ADMIN_MFA_TOTP_CURRENT_KEY_VERSION',
  'ADMIN_MFA_TOTP_KEYRING',
  'ADMIN_MFA_OTP_HMAC_KEY',
  'ADMIN_MFA_RECOVERY_CODE_HMAC_KEY',
  'ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING'
)

function Assert-CanonicalBase64Key32 {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )
  if ([regex]::IsMatch($Value, '\s')) { throw "$Name 값에는 공백이나 개행을 사용할 수 없습니다." }
  try { $bytes = [Convert]::FromBase64String($Value) } catch { throw "$Name 값은 올바른 base64여야 합니다." }
  if ($bytes.Length -ne 32) { throw "$Name 값은 32-byte key여야 합니다." }
  $canonical = [Convert]::ToBase64String($bytes)
  if (-not [string]::Equals($canonical, $Value, [System.StringComparison]::Ordinal)) {
    throw "$Name 값은 canonical base64여야 합니다."
  }
}

function Invoke-MfaSecretPreflight {
  $missing = $requiredNames | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
  if ($missing) { throw "MFA Secret 참조 누락: $($missing -join ', ')" }

  $currentVersion = 0
  $currentText = [Environment]::GetEnvironmentVariable('ADMIN_MFA_TOTP_CURRENT_KEY_VERSION')
  if (-not [int]::TryParse($currentText, [ref]$currentVersion) -or $currentVersion -le 0) {
    throw 'MFA current key version은 양수 정수여야 합니다.'
  }

  try { $totpKeyring = [Environment]::GetEnvironmentVariable('ADMIN_MFA_TOTP_KEYRING') | ConvertFrom-Json -AsHashtable }
  catch { throw 'MFA TOTP keyring은 올바른 JSON 객체여야 합니다.' }
  if ($totpKeyring -isnot [System.Collections.IDictionary] -or -not $totpKeyring.ContainsKey([string]$currentVersion)) {
    throw 'MFA current key version이 TOTP keyring에 없습니다.'
  }
  foreach ($entry in $totpKeyring.GetEnumerator()) {
    $version = 0
    if (-not [int]::TryParse([string]$entry.Key, [ref]$version) -or $version -le 0) {
      throw 'MFA TOTP keyring version은 모두 양수 정수여야 합니다.'
    }
    Assert-CanonicalBase64Key32 -Name 'MFA TOTP keyring' -Value ([string]$entry.Value)
  }

  foreach ($hmacName in @('ADMIN_MFA_OTP_HMAC_KEY', 'ADMIN_MFA_RECOVERY_CODE_HMAC_KEY')) {
    Assert-CanonicalBase64Key32 -Name $hmacName -Value ([Environment]::GetEnvironmentVariable($hmacName))
  }

  try { $breakGlassKeyring = [Environment]::GetEnvironmentVariable('ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING') | ConvertFrom-Json -AsHashtable }
  catch { throw 'MFA break-glass keyring은 올바른 JSON 객체여야 합니다.' }
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
    Assert-CanonicalBase64Key32 -Name 'MFA break-glass publicKey' -Value ([string]$approver['publicKey'])
    if (-not $approver.ContainsKey('active') -or $approver['active'] -isnot [bool]) {
      throw 'MFA break-glass active는 boolean이어야 합니다.'
    }
    if ($approver.ContainsKey('boundUserId') -and ($approver['boundUserId'] -isnot [string] -or [string]::IsNullOrWhiteSpace($approver['boundUserId']))) {
      throw 'MFA break-glass boundUserId는 생략하거나 비어 있지 않은 문자열이어야 합니다.'
    }
  }
  'MFA_SECRET_PREFLIGHT_PASS'
}

function Set-SyntheticValidEnvironment {
  param([string]$Key)
  $env:ADMIN_MFA_TOTP_CURRENT_KEY_VERSION = '1'
  $env:ADMIN_MFA_TOTP_KEYRING = (@{ '1' = $Key } | ConvertTo-Json -Compress)
  $env:ADMIN_MFA_OTP_HMAC_KEY = $Key
  $env:ADMIN_MFA_RECOVERY_CODE_HMAC_KEY = $Key
  $env:ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING = (@{
    'approver-a' = @{ keyVersion = 1; publicKey = $Key; active = $true; boundUserId = 'custodian-a' }
  } | ConvertTo-Json -Compress)
}

function Invoke-ExpectedReject {
  param(
    [string]$Label,
    [string]$Key,
    [scriptblock]$Mutate
  )
  Set-SyntheticValidEnvironment -Key $Key
  & $Mutate
  try {
    Invoke-MfaSecretPreflight | Out-Null
    throw "INVALID_ACCEPTED:$Label"
  } catch {
    if ($_.Exception.Message -eq "INVALID_ACCEPTED:$Label") { throw }
    "${Label}_REJECTED"
  }
}

if (-not $SelfTest) {
  Invoke-MfaSecretPreflight
  exit 0
}

$original = @{}
foreach ($name in $requiredNames) { $original[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
  $key = [Convert]::ToBase64String([byte[]](0..31))
  $newlineKey = $key.Insert(8, [Environment]::NewLine)
  $spaceKey = $key.Insert(8, ' ')
  $badPaddingKey = $key.TrimEnd('=')
  $noncanonicalKey = $key.Substring(0, $key.Length - 2) + '9='

  Set-SyntheticValidEnvironment -Key $key
  Invoke-MfaSecretPreflight
  Invoke-ExpectedReject -Label 'TOTP_WHITESPACE' -Key $key -Mutate { $env:ADMIN_MFA_TOTP_KEYRING = (@{ '1' = $spaceKey } | ConvertTo-Json -Compress) }
  Invoke-ExpectedReject -Label 'OTP_HMAC_NEWLINE' -Key $key -Mutate { $env:ADMIN_MFA_OTP_HMAC_KEY = $newlineKey }
  Invoke-ExpectedReject -Label 'RECOVERY_HMAC_PADDING' -Key $key -Mutate { $env:ADMIN_MFA_RECOVERY_CODE_HMAC_KEY = $badPaddingKey }
  Invoke-ExpectedReject -Label 'RECOVERY_HMAC_NONCANONICAL' -Key $key -Mutate { $env:ADMIN_MFA_RECOVERY_CODE_HMAC_KEY = $noncanonicalKey }
  Invoke-ExpectedReject -Label 'BREAK_GLASS_PUBLIC_KEY_WHITESPACE' -Key $key -Mutate {
    $env:ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING = (@{ 'approver-a' = @{ keyVersion = 1; publicKey = $spaceKey; active = $true } } | ConvertTo-Json -Compress)
  }
  Invoke-ExpectedReject -Label 'BREAK_GLASS_ACTIVE' -Key $key -Mutate {
    $env:ADMIN_MFA_BREAK_GLASS_APPROVER_KEYRING = (@{ 'approver-a' = @{ keyVersion = 1; publicKey = $key; active = 'true' } } | ConvertTo-Json -Compress)
  }
  'MFA_SECRET_PREFLIGHT_SELF_TEST_PASS'
} finally {
  foreach ($name in $requiredNames) { [Environment]::SetEnvironmentVariable($name, $original[$name]) }
}
