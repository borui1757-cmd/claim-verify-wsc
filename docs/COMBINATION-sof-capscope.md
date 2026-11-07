# 组合设计：授权层（SOF/CapScope）+ 执行后核验（本项目）

日期：2026-11-05

## 一、两篇外部工作的要点

### SOF —— The Pre-Execution Enforcement Gap（Zenodo 21657496，v1.4，产线自 2026-02）
- 定义的缺口：文档/评估/监控都无法**阻止**动作，只有执行前授权能
- 机制：在"提议的动作"与"真正执行它的工具/凭据/端点"之间插入确定性授权边界
- 策略：**operator 签名的 Sigil Warrant**
- 决策：`ALLOWED / DENIED / PENDING`（PENDING = 转人工审批）
- 凭证：决策与策略**按哈希绑定**，装在 **Ed25519 Intent Attestation** 里
- 证据：每次决策写**哈希链**记录；映射 ISO/IEC 42001 Annex A、NIST AI RMF 1.0

### CapScope（arXiv 2609.08371，2026-09）
- 能力作用域 harness：每个子 agent 一份**类型化 capability**，存储在模型上下文之外
- 每次工具调用按发起 agent 的 capability 校验；跨子 agent 权限不自动继承
- 实测（300 runs）：注入被执行 33–47/75（基线）→ **3/75**（CapScope）；任务完成 68/75 vs 基线 68–72/75

## 二、与本项目的关系：互补，不重叠

| 阶段 | 谁做 | 产出 |
|---|---|---|
| 授权（执行前） | SOF / CapScope | ALLOWED/DENIED/PENDING + intent attestation |
| 执行 | 工具/运行时 | 实际副作用 |
| **核验（执行后）** | **本项目** | 断言 vs 实际 → supported/contradicted + 证据回执 |
| 审计映射 | SOF（ISO/NIST） | 控制项对照 |

关键重叠点：**SOF 的 Intent Attestation 与我们的回执是同一层技术**（Ed25519 + 哈希链 + 时间戳）。
差别的语义：
- SOF 证明「这个动作是被策略允许的」
- 我们证明「这个结果与它声称的一致」

## 三、组合架构

```
用户意图
  │
  ├─① 策略（Warrant / capability）──────────────► 决策 ALLOWED/DENIED/PENDING
  │                                               │ 策略哈希绑定
  ├─② 执行（工具调用）                            │
  │                                               ▼
  └─③ 执行后核验（本项目）──────────────────► 回执 { resultAttestation }
        断言 → DSL 检查 → 程序执行                │ 引用 ① 的 policyHash
        产出 supported/contradicted               │ 链式证据 + RFC3161 时间戳
                                                  ▼
                                            ④ 审计（ISO 42001 / NIST AI RMF）
```

## 四、本项目要补的三件事

1. **原语副作用声明 + 策略闸门**（对标 SOF 的 authorization boundary）
   - 每个原语标注 effect：`read` / `write` / `dangerous`
   - 策略可配 `allow` / `deny` / `require-approval`
   - 决策与策略哈希一起落进 `audit.jsonl`
2. **回执携带 policyHash**：证明这次执行发生在哪版策略下（与 Warrant 哈希对齐）
3. **字段命名收敛**：`intent attestation`、`warrant hash`、`decision`，避免自造词

## 五、边界与风险

- SOF 已在产线运行、CapScope 已给出注入防御数字；**"agent 治理"不再是空白**
- 本项目的独立价值只有一段：**执行后核验**（动作没发生却声称发生）
- 若做产品，正确的姿态是**接入**（作为策略层的后置核验器），不是另起一套治理框架

## 六、论文可用的定位句

> 已有工作保证「将要做的动作被授权」（SOF、CapScope），也保证「生成的代码安全」（SIGIL），
> 但 agent 最常见的失败是**动作根本没发生却被声称发生**。
> 本文把这类执行后断言形式化为可判定的检查问题，并给出可第三方验证、与授权层策略绑定的证据回执。
