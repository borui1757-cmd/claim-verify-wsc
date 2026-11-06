# deploy.ps1 -- one command: CI -> sync -> verify -> (optional) restart -> self-check
#
# Why: 2026-11-07 we shipped "changed but not loaded" three times because manual steps were skipped.
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads UTF-8 as ANSI and Chinese characters break parsing.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 -Restart
param(
  [switch]$Restart,
  [string]$Profile = 'web',
  [string]$Package = 'claim-verify-wsc'
)

$ErrorActionPreference = 'Stop'
$src = 'C:\Users\19156\Documents\deepseek-harness\default-workspace\plugins\dsh-claim-verify'
$dst = Join-Path $env:USERPROFILE ('.dsh\profiles\' + $Profile + '\node_modules\' + $Package)
$loads = Join-Path $env:USERPROFILE '.dsh\dsh-claim-verify\loads.jsonl'

function BuildIdAt($dir) {
  Push-Location $dir
  try { return (node --input-type=module -e "import { computeBuildId } from './lib/build-id.js'; console.log(computeBuildId());") }
  finally { Pop-Location }
}

Write-Host '[1/5] running CI ...'
Push-Location $src
$ci = node tools/ci.mjs
Pop-Location
$ci | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) {
  Write-Host '[x] CI failed, deploy aborted' -ForegroundColor Red
  exit 1
}

Write-Host '[2/5] syncing to profile ...'
& (Join-Path $src 'tools\sync-to-profile.ps1') -Profile $Profile -Package $Package
if ($LASTEXITCODE -ne 0) { Write-Host '[x] sync failed' -ForegroundColor Red; exit 1 }

Write-Host '[3/5] checking buildId ...'
$srcId = BuildIdAt $src
$dstId = BuildIdAt $dst
Write-Host ('  src={0}  dst={1}' -f $srcId, $dstId)
if ($srcId -ne $dstId) {
  Write-Host '[x] buildId mismatch, deploy aborted' -ForegroundColor Red
  exit 1
}

if ($Restart) {
  Write-Host '[4/5] restarting host ...'
  $line = (netstat -ano | Select-String ':3080\s' | Select-String 'LISTENING' | Select-Object -First 1).Line
  if ($line) {
    $hostPid = ($line -split '\s+')[-1]
    Write-Host ('  killing PID ' + $hostPid)
    taskkill /F /PID $hostPid | Out-Null
    Start-Sleep -Seconds 2
  }
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $env:USERPROFILE 'Desktop\launch-web.ps1') -WaitSeconds 120
  Write-Host '  host relaunched'
}
else {
  Write-Host '[4/5] restart skipped (use -Restart)'
}

Write-Host '[5/5] self-check ...'
Start-Sleep -Seconds 3
if (Test-Path $loads) {
  $line = (netstat -ano | Select-String ':3080\s' | Select-String 'LISTENING' | Select-Object -First 1).Line
  $listenerPid = if ($line) { ($line -split '\s+')[-1] } else { $null }
  $entries = Get-Content $loads -Tail 50 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ }
  $hostEntry = if ($listenerPid) { $entries | Where-Object { [string]$_.pid -eq [string]$listenerPid } | Select-Object -Last 1 } else { $null }
  if ($hostEntry) {
    Write-Host ('  host pid=' + $hostEntry.pid + ' version=' + $hostEntry.version + ' buildId=' + $hostEntry.buildId)
    if ($hostEntry.buildId -eq $srcId) {
      Write-Host '  OK: host is running the latest code' -ForegroundColor Green
    }
    else {
      Write-Host ('  WARN: host still on old code (expected ' + $srcId + '), restart needed') -ForegroundColor Yellow
    }
  }
  else {
    $last = $entries | Select-Object -Last 1
    Write-Host ('  no record for listener pid ' + $listenerPid + '; last entry pid=' + $last.pid + ' buildId=' + $last.buildId)
    Write-Host '  WARN: cannot confirm host load, restart and re-run' -ForegroundColor Yellow
  }
}
else {
  Write-Host '  no loads.jsonl, cannot self-check'
}
