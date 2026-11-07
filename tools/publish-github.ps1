# Publish claim-verify-wsc to GitHub via REST API (no git/gh required).
#
# WHY THIS EXISTS: this machine has no git and no gh CLI. The GitHub REST API can
# create the repo and upload files over HTTPS, which is enough for a first publish.
#
# ASCII ONLY. Windows PowerShell 5.1 reads this file as ANSI; any non-ASCII byte
# breaks parsing silently. Do not add Chinese comments here.
#
# Usage:
#   $env:GITHUB_TOKEN = 'ghp_xxxxxxxx'      # needs 'repo' scope
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/publish-github.ps1 -Owner <login>
#
#   -DryRun     list what would be uploaded, send nothing
#   -Private    create a private repo
#   -RepoName   override repo name (default claim-verify-wsc)

param(
  [string]$Owner = $env:GITHUB_OWNER,
  [string]$RepoName = 'claim-verify-wsc',
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Description = 'Verify what an AI agent claims about your machine against real system state. 19 read-only primitives, three-way verdicts with abstention, receipts and coverage.',
  [string]$Branch = 'main',
  [switch]$Private,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = 'https://api.github.com'

# --- file selection: same policy as .gitignore ----------------------------
# 2026-11-07: without these rules the script tried to upload 23,459 files / 368 MB
# (lib.bak-*, tools\gr-venv, pip-*), which would blow the 5000 req/hour rate limit.
$skipDirs = @('node_modules', '.git', 'gr-venv', 'data')
$skipLeafPatterns = @(
  '^lib\.bak', '\.bak-', '\.bak$', '\.tgz$',
  '^pip-(install|unpack|ephem|build)',
  '^hits\.jsonl$', '^debug\.jsonl$', '^\.cmdout\.txt$',
  '\.log$', '^key$', '\.pem$', '^\.env', '^reload-status\.json$'
)
$skipRel = @('eval\corpus.jsonl', 'eval/corpus.jsonl')

function Get-Rel($p) { $p.Substring($root.Length + 1) }

$files = @()
foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File)) {
  $rel = Get-Rel $f.FullName
  $segs = $rel -split '\\'
  $skip = $false
  foreach ($seg in $segs) {
    if ($skipDirs -contains $seg) { $skip = $true; break }
    foreach ($pat in $skipLeafPatterns) { if ($seg -match $pat) { $skip = $true; break } }
    if ($skip) { break }
  }
  if ($skip) { continue }
  if ($skipRel -contains $rel) { continue }
  $files += [pscustomobject]@{ rel = $rel; full = $f.FullName; size = $f.Length }
}
$files = $files | Sort-Object rel

Write-Host ("Files to upload: {0}" -f $files.Count)
$total = ($files | Measure-Object size -Sum).Sum
Write-Host ("Total: {0:N1} KB" -f ($total / 1KB))
if ($files.Count -le 12) { foreach ($f in $files) { Write-Host ("  {0}" -f $f.rel) } }

if ($DryRun) {
  Write-Host 'DRY RUN: nothing sent.'
  foreach ($f in $files) { Write-Host ("  {0,-46} {1,8:N0} B" -f $f.rel, $f.size) }
  exit 0
}

if (-not $Token) { throw 'No token. Set $env:GITHUB_TOKEN (needs repo scope).' }
if (-not $Owner) { throw 'No owner. Pass -Owner <github-login>.' }

$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'claim-verify-wsc-publisher'
}

function Invoke-GH {
  param([string]$Method, [string]$Url, $Body)
  $req = @{ Method = $Method; Uri = $Url; Headers = $headers }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    $req.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentType = 'application/json; charset=utf-8'
  }
  return Invoke-RestMethod @req
}

# --- 1. repo -------------------------------------------------------------
Write-Host ""
Write-Host "[1/3] repo $Owner/$RepoName"
$repoUrl = "$api/repos/$Owner/$RepoName"
try {
  $body = @{ name = $RepoName; description = $Description; private = [bool]$Private; has_issues = $true; has_wiki = $false }
  $repo = Invoke-GH 'POST' "$api/user/repos" $body
  Write-Host ("  created: {0}" -f $repo.html_url)
}
catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 422) { Write-Host '  already exists, continue' }
  else { throw }
}

# --- 2. upload (contents API, one request per file) ----------------------
# ~550 files here, well under the 5000 req/hour authenticated limit.
Write-Host ""
Write-Host "[2/3] uploading"
$ok = 0
$fail = @()
$i = 0
foreach ($f in $files) {
  $i++
  $relUrl = $f.rel -replace '\\', '/'
  $url = "$repoUrl/contents/$([uri]::EscapeUriString($relUrl))"
  try {
    $bytes = [System.IO.File]::ReadAllBytes($f.full)
    $b64 = [System.Convert]::ToBase64String($bytes)
    $payload = @{ message = "add $relUrl"; content = $b64; branch = $Branch }
    # existing file needs its sha
    try {
      $existing = Invoke-GH 'GET' "$url?ref=$Branch"
      if ($existing -and $existing.sha) { $payload.sha = $existing.sha }
    }
    catch { }
    Invoke-GH 'PUT' $url $payload | Out-Null
    $ok++
    if ($i % 25 -eq 0) { Write-Host ("  {0}/{1}" -f $i, $files.Count) }
  }
  catch {
    $fail += ("{0} :: {1}" -f $relUrl, $_.Exception.Message)
  }
}

# --- 3. summary ----------------------------------------------------------
Write-Host ""
Write-Host "[3/3] done"
Write-Host ("  uploaded: {0}" -f $ok)
Write-Host ("  failed:   {0}" -f $fail.Count)
foreach ($x in ($fail | Select-Object -First 15)) { Write-Host ("    {0}" -f $x) }
if ($fail.Count -gt 15) { Write-Host ("    ... and {0} more" -f ($fail.Count - 15)) }
Write-Host ("  repo: https://github.com/{0}/{1}" -f $Owner, $RepoName)
if ($fail.Count -gt 0) { exit 1 }
