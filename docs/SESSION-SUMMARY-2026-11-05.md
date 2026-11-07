# 会话小结（2026-11-05）

> 目标：把「agent 声称完成」这件事做成**可程序核验 + 可第三方验证**的证据链。
> 本文件记录今天实际做成的、测出来的、以及还没解决的。

## 一、今天做成的东西

| 模块 | 文件 | 作用 |
|---|---|---|
| 程序真值核验 | `lib/index.js`（0.5.0-experimental.1） | 14 类本机断言；observe 默认 |
| 轨迹证据对账 | `lib/promise.js`、`lib/evidence.js` | 声称 vs 工具调用，零模型调用 |
| 断言编译器 | `lib/dsl.js` + `lib/claim-dsl.js` | 自然语言 → 只读检查 → 程序执行 |
| 翻译见证 | `lib/witness.js` | 计划参数必须在原句有出处 |
| 时序对时 | `lib/dsl.js`（transient 标记） | 瞬态状态不能用来否定过去的断言 |
| 执行前授权 | `lib/policy.js` | allow/deny/pending + 路径前缀谓词 |
| 可写原语 + 审批 | `lib/dsl.js`(write_file)、`bin/approve.mjs` | 先备份再写；pending 不执行 |
| 报告隔离审计 | `lib/isolated-audit.js` | 声明只看报告、证据只看轨迹、判定走规则 |
| 声明覆盖率 | `lib/coverage.js`、`bin/coverage.mjs` | 实际动作里有多少被声明 |
| 签名回执 | `lib/receipt.js`、`lib/signing.js`、`lib/envelope.js` | Ed25519 信封 + 线性哈希链 |
| 链头锚定 | `lib/anchor.js`、`bin/anchor.mjs` | 链头 → RFC3161 时间戳 |
| 案例留档/重放 | `lib/cases.js`、`bin/replay.mjs`、`bin/replay-batch.mjs` | 离线复算，可换规则重跑 |
| 历史语料 | `bin/harvest.mjs` | 多帧 zstd 会话 → 案例（80 会话 → 1141 案例） |
| 脚本化标注 | `bin/autolabel.mjs`、`bin/label-audit.mjs` | 自动标签 + 抽样算 kappa |

**测试**：30 个测试文件全绿（`npm test`）。

## 二、测出来的数字（含出处）

| 实验 | 样本 | 结果 |
|---|---|---|
| 程序真值 vs 强模型裁判 | 26 条构造 | 我们 P/R 100%（0 调用）；deepseek 机械域 R=40%，叙事域 R=100% |
| DSL 编译器 | 60 条构造 | 翻译 98%、判定 100%、误报 0/10 |
| 报告—轨迹基准 | 400 案例 → 5555 声明 | 召回 96.4%、精度 100%、F1 98.1%（0 模型调用） |
| 泄漏消融（构造声明） | 60 条 | BLIND F1 83.6% / AWARE 83.6% / 我们 100%；**无泄漏效应** |
| 泄漏消融（报告自带声明） | 30 案例 | 抽出 16 条声明，仅 **1 条可用** → 无法复现 |
| 回执验签 | 10 份 | 逐条通过；改一条 verdict 即失败；链完整 |
| 链头锚定 | 10 份回执 | head=4dc3901821e8cc1f…，RFC3161 token 8012 字符 |
| 自动标签 | 1141 案例 | 37 条唯一标签（受重复句限制） |

## 三、关键发现（含负结果）

1. **报告密度低是主瓶颈**：编程 agent 的自由文本报告里几乎不含可核验的具体声明
   （30 份报告 → 16 条声明 → 1 条可用）。这解释了为什么“事后核验”收益受限。
2. **结构化声明是前置条件**：`report_claims` 工具把声明密度从“偶然”变成“每轮必报”。
3. **泄漏效应在本域无法复现**：声明若来自构造，判官看到的自述与声明不相关；声明若来自报告，样本又太少。
4. **机械事实上规则优于模型**：同批样本，确定性审计 F1 100% vs 模型判官 83.6%。
5. **时序会制造假阳性**：瞬态状态（端口/进程）跨轮判定必须降级为 insufficient。

## 四、关键设计决策

- 核验器**只读**；写操作移出核验路径（避免“核验器执行副作用”）
- `pending` 一律**不执行**，等 `bin/approve.mjs` 人工放行
- 声明解析与证据抽取**信息流隔离**（依据 arXiv 2610.29609 的泄漏发现）
- 回执**签名前**注入 `policyHash`，让“执行发生在哪版策略下”可验证
- 所有判定可离线重放（`cases.jsonl` + `replay-batch`），换规则不需重调模型

## 五、已知限制

1. 数据：37 条自产标签、构造案例为主；无独立第三方语料
2. 覆盖：DSL 只有 9 个原语；叙述类结论仍靠模型
3. 工程：装插件要手工 junction + 改 profile；改动需重启宿主
4. 安全：私钥明文 PEM；写原语有备份但无自动回滚
5. 学术：与 arXiv 2610.29609（report–trace auditing，F1 0.75–0.81）题目撞车，必须靠“OS 真值 + 密码学回执”区隔

## 六、论文可用材料

- 定位：**执行后核验**（他们做执行前授权/构造期校验）
- 差异：OS 级真值、第三方可验的回执、零模型判定成本
- 现有数字：98.1%（构造基准）、83.6%（同批 LLM 判官）、100%（构造评测）
- 负结果：报告声明密度低、泄漏在本域不可复现

## 七、下一步（按优先级）

1. 把 ①–⑤ 写成论文「实验」章节（每节标样本量与边界）
2. 查清 FN=10（疑似同句多标签覆盖）
3. 在真实使用里攒 200 条独立标签（当前 37）
4. 接公共轨迹数据集做外部效度（OpenToolTrace-X 是模板包，不可用）
5. 若要做产品：把“核验器”与“意图执行器”拆成两个组件

## 八、复现入口

```
npm test                         # 30 个测试文件
node bin/harvest.mjs             # 会话 → 案例
node bin/replay-batch.mjs --cases data/harvested-cases.jsonl
node eval/dsl-bench.mjs          # 编译器评测（60 条）
node eval/report-trace-bench.mjs # 报告-轨迹基准（零成本）
node eval/leakage-ablation.mjs   # 泄漏消融（构造声明）
node eval/leakage-from-reports.mjs # 泄漏消融（报告自带声明）
node bin/receipts.mjs --verify   # 回执验签 + 链校验
node bin/anchor.mjs --verify     # 链头锚定校验
```
