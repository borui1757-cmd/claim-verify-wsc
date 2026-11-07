# Push a single changed file to Gitee (used after the initial bulk upload).
# ASCII only.
param(
  [Parameter(Mandatory = $true)][string]$RelPath,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Owner = 'wsc-ai',
  [string]$RepoName = 'claim-verify-wsc',
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$full = Join-Path $root $RelPath
if (-not (Test-Path $full)) { throw "not found: $full" }

$urlRel = $RelPath -replace '\\', '/'
$url = "https://gitee.com/api/v5/repos/$Owner/$RepoName/contents/$urlRel"
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))

$sha = $null
try { $cur = Invoke-RestMethod -Uri "$url`?access_token=$Token" -TimeoutSec 20; $sha = $cur.sha } catch { }

$payload = @{ access_token = $Token; content = $b64; message = $(if ($Message) { $Message } else { "update $urlRel" }); branch = 'master' }
if ($sha) { $payload.sha = $sha }

try {
  $method = if ($sha) { 'Put' } else { 'Post' }
  $null = Invoke-RestMethod -Method $method -Uri $url -Body ($payload | ConvertTo-Json -Depth 5 -Compress) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30
  Write-Host ("ok   {0} ({1})" -f $urlRel, $method.ToLower())
}
catch {
  throw ("push failed for {0}: {1}" -f $urlRel, $_.Exception.Message)
}
