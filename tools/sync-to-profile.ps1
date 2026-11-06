# sync-to-profile.ps1 —— 把工作目录同步到 profile 里**真正被加载**的那份副本。
#
# 为什么需要：宿主加载的是 profiles\<name>\node_modules\<pkg> 下的**真实副本**（不是链接）。
# 2026-11-06 实证：改了一整天代码，宿主 buildId 一直是 b982f4ccccea 从未变过——
# 因为它加载的是 8:55 那份旧副本。重启一百次也不会生效。
#
# 用法（PowerShell）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File sync-to-profile.ps1
# 参数：-Profile web（默认）、-Package claim-verify-wsc（默认）
param(
  [string]$Profile = 'web',
  [string]$Package = 'claim-verify-wsc'
)

$ErrorActionPreference = 'Stop'
$src = 'C:\Users\19156\Documents\deepseek-harness\default-workspace\plugins\dsh-claim-verify'
$dst = Join-Path (Join-Path (Join-Path $env:USERPROFILE '.dsh\profiles') $Profile) ('node_modules\' + $Package)

if (-not (Test-Path $dst)) {
  Write-Host "[x] 目标不存在：$dst" -ForegroundColor Red
  exit 1
}

# 1) 备份
$bak = "$dst.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
Move-Item $dst $bak -Force
Write-Host "[1/3] 已备份 -> $bak"

# 2) 镜像同步（排除 node_modules / .git）
robocopy $src $dst /MIR /XD node_modules .git /NFL /NDL /NP /NJH /NJS | Out-Null
Write-Host "[2/3] 已同步（robocopy exit=$LASTEXITCODE）"

# 3) 校验 buildId 一致
Push-Location $dst
$bid = (node --input-type=module -e "import { computeBuildId } from './lib/build-id.js'; console.log(computeBuildId());")
$importOk = (node --input-type=module -e "try { await import('./lib/index.js'); console.log('ok'); } catch (e) { console.log('fail:' + e.message); }")
Pop-Location

Write-Host "[3/3] 目标 buildId = $bid ；导入检查 = $importOk"

if ($importOk -eq 'ok') {
  Write-Host "`n完成。现在请重启宿主：双击桌面 重启DSH.bat" -ForegroundColor Green
}
else {
  Write-Host "`n导入失败，已保留备份：$bak" -ForegroundColor Red
  exit 1
}
