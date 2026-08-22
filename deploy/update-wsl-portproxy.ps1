[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Distro
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "관리자 권한 PowerShell에서 실행해야 합니다."
}

$wslAddressText = (& wsl.exe -d $Distro -- hostname -I).Trim()
$wslAddress = ($wslAddressText -split '\s+' | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } | Select-Object -First 1)
if (-not $wslAddress) {
    throw "WSL IPv4 주소를 확인하지 못했습니다."
}

$ports = 25, 80, 443
foreach ($port in $ports) {
    & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port | Out-Null
    & netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$wslAddress connectport=$port | Out-Null
}

Write-Host "WSL 포트 전달 갱신 완료: 0.0.0.0:{25,80,443} -> ${wslAddress}:{동일 포트}"
& netsh interface portproxy show v4tov4
