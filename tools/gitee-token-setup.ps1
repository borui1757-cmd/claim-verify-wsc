# Gitee token setup - opens the right page, takes one paste, verifies, stores it.
#
# Why this exists: the token can only be created inside a logged-in browser
# session. This script removes every other step: it opens the exact page
# (https://gitee.com/profile/personal_access_tokens -- note /profile/), reads
# the token with hidden input, verifies it against the API, and stores it as a
# user environment variable so the publish script can pick it up.
#
# Usage:  double-click tools\gitee-token-setup.bat   (or run this .ps1)
# Test:   powershell -File tools\gitee-token-setup.ps1 -Token dummy   (no prompt)
#
# ASCII only: Windows PowerShell 5.1 mis-parses UTF-8 CN text in .ps1 files.

param(
  [string]$Token = '',
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$tokenUrl = 'https://gitee.com/profile/personal_access_tokens'

if (-not $NoOpen) {
  Write-Host ''
  Write-Host 'Opening the Gitee token page in your browser...' -ForegroundColor Cyan
  try { Start-Process $tokenUrl } catch { Write-Host "  could not open browser, go here manually: $tokenUrl" }
}

if (-not $Token) {
  Write-Host ''
  Write-Host 'On that page:' -ForegroundColor Yellow
  Write-Host '  1. click  [生成新令牌]  (top right)'
  Write-Host '  2. description: claim-verify-wsc-publish'
  Write-Host '  3. permissions: tick only  [projects]'
  Write-Host '  4. expiration: 7 days'
  Write-Host '  5. submit, then COPY the token (shown once)'
  Write-Host ''
  $sec = Read-Host 'Paste the token here (input is hidden)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$Token = $Token.Trim()
if (-not $Token) { Write-Host 'No token given. Nothing changed.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'Verifying against Gitee API...' -ForegroundColor Cyan
try {
  $me = Invoke-RestMethod -Uri "https://gitee.com/api/v5/user?access_token=$Token" -TimeoutSec 20
}
catch {
  Write-Host '  verification FAILED - token rejected. Create a new one and try again.' -ForegroundColor Red
  Write-Host ("  detail: " + $_.Exception.Message)
  exit 1
}

[Environment]::SetEnvironmentVariable('GITEE_TOKEN', $Token, 'User')
[Environment]::SetEnvironmentVariable('GITEE_OWNER', $me.login, 'User')

Write-Host ''
Write-Host '  OK' -ForegroundColor Green
Write-Host ("  user  : {0}" -f $me.login)
Write-Host ("  name  : {0}" -f $me.name)
Write-Host ("  repo  : https://gitee.com/{0}/claim-verify-wsc" -f $me.login)
Write-Host ''
Write-Host 'Token stored as user env var GITEE_TOKEN. Tell the assistant "done" and it will publish.'
Write-Host ''
