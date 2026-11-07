# Push the changed files of the cascade release to Gitee.
# ASCII only. Run from the plugin root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/push-changed.ps1 -Token <token>
param([Parameter(Mandatory = $true)][string]$Token)

$root = Split-Path -Parent $PSScriptRoot
$list = @(
  'lib/cascade.js',
  'lib/config.js',
  'lib/index.js',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'test/cascade.mjs',
  'tools/push-file.ps1'
)

$fail = 0
foreach ($f in $list) {
  try {
    & (Join-Path $PSScriptRoot 'push-file.ps1') -RelPath $f -Token $Token -Message "cascade: update $f"
  }
  catch {
    Write-Host ("FAIL {0}" -f $f)
    $fail += 1
  }
}
Write-Host ("`ndone: {0} files, {1} failed" -f $list.Count, $fail)
if ($fail -gt 0) { exit 1 }
