# Publish claim-verify-wsc to Gitee via REST API (no git required).
#
# Why Gitee: on this machine github.com times out (web UI unreachable) while
# api.github.com happens to work. gitee.com answers in ~180ms, so it is the
# practical path. GitHub can be mirrored later when it is reachable.
#
# Usage:
#   $env:GITEE_TOKEN = 'xxxxxxxx'          # https://gitee.com/profile/personal_access_tokens -> 生成新令牌
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/publish-gitee.ps1 -Owner <gitee-login>
#
#   -Private   private repo
#   -DryRun    only list what would be uploaded
#
# ASCII only: Windows PowerShell 5.1 mis-parses UTF-8 CN text in .ps1 files.

param(
  [string]$Owner = $env:GITEE_OWNER,
  [string]$RepoName = 'claim-verify-wsc',
  [string]$Token = $env:GITEE_TOKEN,
  [string]$ApiBase = 'https://gitee.com/api/v5',
  [string]$Description = 'Verify what an AI agent claims about your machine against the real system state. Local ground truth, 14 claim kinds, zero model calls.',
  [switch]$Private,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = $ApiBase.TrimEnd('/')

# --- file selection -------------------------------------------------------
function Get-Rel($p) { $p.Substring($root.Length + 1) }

$files = @()
foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File)) {
  $rel = Get-Rel $f.FullName
  if ($rel -match '\\node_modules\\|\\\.git\\') { continue }
  if ($f.Extension -eq '.tgz') { continue }
  if ($rel -eq 'eval\corpus.jsonl' -or $rel -eq 'eval/corpus.jsonl') { continue }
  $files += [pscustomobject]@{ rel = $rel; full = $f.FullName; size = $f.Length }
}
$files = $files | Sort-Object rel

Write-Host ("Files to upload: {0}" -f $files.Count)
foreach ($f in $files) { Write-Host ("  {0,-40} {1,7} B" -f $f.rel, $f.size) }
Write-Host ("Total: {0:N1} KB" -f (($files | Measure-Object size -Sum).Sum / 1KB))

if ($DryRun) { Write-Host 'DRY RUN: nothing sent.'; exit 0 }

if (-not $Token) { throw 'No token. Set $env:GITEE_TOKEN (create one at https://gitee.com/profile/personal_access_tokens).' }
if (-not $Owner) { throw 'No owner. Pass -Owner <gitee-login>.' }

function Invoke-Gitee {
  param([string]$Method, [string]$Url, $Body)
  $req = @{ Method = $Method; Uri = $Url; TimeoutSec = 30 }
  if ($null -ne $Body) {
    $req.Body = ($Body | ConvertTo-Json -Depth 6 -Compress)
    $req.ContentType = 'application/json; charset=utf-8'
  }
  return Invoke-RestMethod @req
}

# --- 1. create repo -------------------------------------------------------
Write-Host "`n[1/3] repo $Owner/$RepoName"
$repoUrl = $null
try {
  $body = @{
    access_token = $Token
    name         = $RepoName
    description  = $Description
    private      = [bool]$Private
    auto_init    = $true
  }
  $repo = Invoke-Gitee 'POST' "$api/user/repos" $body
  $repoUrl = $repo.html_url
  Write-Host ("  created: {0}" -f $repoUrl)
}
catch {
  Write-Host ("  create failed (maybe exists): {0}" -f $_.Exception.Message)
}

# --- 2. upload files ------------------------------------------------------
Write-Host "`n[2/3] uploading"
$ok = 0; $fail = 0
foreach ($f in $files) {
  $urlRel = $f.rel -replace '\\', '/'
  $url = "$api/repos/$Owner/$RepoName/contents/$urlRel"
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.full))

  # existing sha is required when the file already exists
  $sha = $null
  try {
    $cur = Invoke-Gitee 'GET' "$url`?access_token=$Token" $null
    if ($cur -and $cur.sha) { $sha = $cur.sha }
  } catch { }

  $payload = @{ access_token = $Token; content = $b64; message = "add $urlRel"; branch = 'master' }
  if ($sha) { $payload.sha = $sha }

  try {
    $null = Invoke-Gitee 'POST' $url $payload
    Write-Host ("  ok   {0}" -f $urlRel); $ok++
  }
  catch {
    # Gitee uses POST for create and PUT for update; retry once as PUT
    try {
      $null = Invoke-Gitee 'PUT' $url $payload
      Write-Host ("  ok   {0} (update)" -f $urlRel); $ok++
    }
    catch {
      Write-Host ("  FAIL {0} -> {1}" -f $urlRel, $_.Exception.Message); $fail++
    }
  }
}

Write-Host "`n[3/3] done: $ok ok, $fail failed"
if ($repoUrl) { Write-Host "  repo: $repoUrl" }
else { Write-Host "  repo: https://gitee.com/$Owner/$RepoName" }
if ($fail -gt 0) { exit 1 }
