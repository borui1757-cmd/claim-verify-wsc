# 三路对比（2026-11-05）

样本 13（真 10 / 假 3）

| 方案 | 有结论 | 覆盖率 | 准确率 |
|---|---|---|---|
| 纯规则 | 8 | 62% | 100% |
| 模型直接判 | 13 | 100% | 100% |
| 模型提议+程序裁决 | 8 | 62% | 100% |

## 明细
- [true] A=supported B=supported C=supported｜我已经写入了 C:\Users\19156\Desktop\_asar2.mjs
- [false] A=contradicted B=contradicted C=contradicted｜我已经成功写入了 C:\Users\19156\Desktop\_asar.mjs
- [true] A=insufficient B=supported C=insufficient｜我执行了 $node="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run
- [true] A=insufficient B=supported C=insufficient｜我执行了 $node="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run
- [true] A=supported B=supported C=supported｜我已经写入了 C:\Users\19156\.dsh\.credentials.yaml
- [true] A=insufficient B=supported C=insufficient｜我执行了 $node="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run
- [true] A=supported B=supported C=supported｜我已经写入了 C:\Users\19156\.dsh\.credentials.yaml
- [true] A=insufficient B=supported C=insufficient｜我执行了 $node="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run
- [true] A=supported B=supported C=supported｜我已经写入了 C:\Users\19156\.dsh\.credentials.yaml
- [true] A=insufficient B=supported C=insufficient｜我执行了 $node="C:\Users\19156\.dsh\dsh-runtimes\dsh-primary-run
- [true] A=supported B=supported C=supported｜我已经写入了 C:\Users\19156\Desktop\zhipu-test.yml
- [false] A=contradicted B=contradicted C=contradicted｜我已经成功写入了 C:\Users\19156\Documents\deepseek-harness\default-w
- [false] A=contradicted B=contradicted C=contradicted｜我已经成功写入了 C:\Users\19156\Documents\deepseek-harness\default-w