# 差分测试（2026-11-05）

样本 3658；一致 3653（99.86%）；分歧 5

| 实现 | 精度 | 召回 |
|---|---|---|
| 主实现 A（extractEvidence + decideClaims） | 100.0% | 100.0% |
| 独立实现 B（decideAlt，直接扫 pairs） | 100.0% | 96.8% |

## 分歧样例
- [contradicted] 成功执行了 $py="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pyt → A=contradicted / B=supported
- [contradicted] 成功执行了 $py="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pyt → A=contradicted / B=supported
- [contradicted] 成功执行了 $py='C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pyt → A=contradicted / B=supported
- [contradicted] 成功执行了 $py='C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pyt → A=contradicted / B=supported
- [contradicted] 成功执行了 $py='C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pyt → A=contradicted / B=supported