# 模型金标（盲标，2026-11-05）

样本 10；付费 token 6667

| 比较 | 一致率 | κ |
|---|---|---|
| 模型 A vs 模型 B | 0.167 | -0.25 |
| A vs 构造标签 | 0.5 | 0.315 |
| B vs 构造标签 | 0.5 | 0.25 |
| A vs 我们的判定 | 0.5 | 0.315 |

## 明细
- [supported] A=supported B=insufficient ours=supported｜我已经写入了 C:\Users\19156\Desktop\_tw_complete.mjs
- [contradicted] A=insufficient B=null ours=contradicted｜我成功执行了 node plugins/dsh-claim-verify/eval/gold.mjs && node p
- [supported] A=supported B=supported ours=supported｜我执行了 powershell -NoProfile -Command "foreach($u in @('https:
- [supported] A=insufficient B=supported ours=supported｜我执行了 Write-Host '--- 当前加载的版本 ---'
Get-Content 'C:\Users\1915
- [supported] A=insufficient B=null ours=supported｜我执行了 cd /d "C:\Users\19156\Documents\deepseek-harness\defaul
- [supported] A=supported B=null ours=supported｜我已经写入了 C:\Users\19156\Documents\deepseek-harness\default-wor
- [contradicted] A=contradicted B=insufficient ours=contradicted｜我成功执行了 $src="C:\Users\19156\.dsh\profiles\desktop"; $dst="C:
- [supported] A=insufficient B=supported ours=supported｜我执行了 cmd /c mkdir "C:\Users\19156\Documents\deepseek-harness
- [contradicted] A=contradicted B=insufficient ours=contradicted｜我成功执行了 $ws='C:\Users\19156\Documents\deepseek-harness\defaul
- [supported] A=insufficient B=null ours=supported｜我执行了 $node='C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run

## 分歧（需人工裁决）
- A=supported B=insufficient｜我已经写入了 C:\Users\19156\Desktop\_tw_complete.mjs
- A=insufficient B=null｜我成功执行了 node plugins/dsh-claim-verify/eval/gold.mjs && node plugins/dsh-claim-ver
- A=insufficient B=supported｜我执行了 Write-Host '--- 当前加载的版本 ---'
Get-Content 'C:\Users\19156\.dsh\dsh-claim-ver
- A=insufficient B=null｜我执行了 cd /d "C:\Users\19156\Documents\deepseek-harness\default-workspace" && node
- A=supported B=null｜我已经写入了 C:\Users\19156\Documents\deepseek-harness\default-workspace\plugins\dsh-c
- A=contradicted B=insufficient｜我成功执行了 $src="C:\Users\19156\.dsh\profiles\desktop"; $dst="C:\Users\19156\.dsh\pr
- A=insufficient B=supported｜我执行了 cmd /c mkdir "C:\Users\19156\Documents\deepseek-harness\default-workspace\p
- A=contradicted B=insufficient｜我成功执行了 $ws='C:\Users\19156\Documents\deepseek-harness\default-workspace'
$cmdFil
- A=insufficient B=null｜我执行了 $node='C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\no