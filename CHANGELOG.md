# 0.6.0

## 新增

- `lib/adapter.js` —— **可插拔判定适配层**：`adjudicate(facts, claim)` → `supported | contradicted | insufficient`，
  纯函数、零模型调用、零网络。接入说明见 `docs/对接说明.md`。
- `lib/verified-write.js` —— 写入 + 立即 OS 核验，返回 `{ok, verified:{exists,size}, sha256}`；
  支持 `actualBytes`/`expectedBytes` 成对字段（实测比单语义键名更易被模型利用）。
- `lib/exit-attr.js` —— **退出码归属**：多语句命令（`npm test; Write-Output "after"`）的退出码不可归属，
  判定降级为 `insufficient` 而不是误判成功。
- `lib/build-id.js` —— 源码指纹，写入 `loads.jsonl` 与 debug 行，保证日志可追溯到版本。
- `lib/outcomes.js` —— 干预与结果的关联（`intervention` / `outcome` 成对），用于事后核算干预是否必要。
- `lib/redflag.js` —— 措辞红旗（高精确低召回），命中只用于优先核验，**未命中不豁免**。
- `bench/` —— `ExecutionHallu-Bench`：3 族任务 × 2 种披露 × 多模型，真值取自真实磁盘。

## 修复

- **退出码格式**：`isolated-audit.js` / `promise.js` / `decide-alt.js` 里的正则写的是
  `exit code [1-9]`，而 DSH 实际格式是 `[exit code: 1]`（带方括号与冒号）——失败标记全部漏判。
- **fail-open**：`agent/request` 路由选择失败时回退到原始请求；`llm/stream` 合成 `text-delta` 失败不打断流。

## 测试

- 56 个测试文件，全部通过；`npm test` 零网络、零模型调用。
- 新增回归：`test/exit-marker.mjs`、`test/exit-attr.mjs`、`test/build-id.mjs`、
  `test/outcomes.mjs`、`test/redflag.mjs`、`test/adapter.mjs`、`test/verified-write.mjs`。

## 实测结论（可复现）

| 干预 | 结果 |
|---|---|
| 核验结论放工具结果（非事后消息） | 无保留谎报 **20/20 → 0/20**（两次独立复现） |
| 只报状态（`size`） | **无帮助**，与不报相同 |
| 报与意图的差（`actual`/`expected`） | 谎报 **20/20 → 0/20** |
| 事前接种 | 明确判失败 **0/20 → 13/20**（加措辞指令 20/20） |
| 讲道理 / 加强措辞 / 强制二元 | **无效** |

**边界**：单模型为主、n≤20、仅覆盖有客观真值的声明（真实语料中约 18.5%）。

## 已知问题

- 插件形态依赖宿主事件，MCP 形态覆盖面更广（见 README）。
- 跨工具链条不追溯前提（实测 6/6 被"读回伪造"骗过）。
- 中文表述的关键词分类器易漏判，论文中所有比例均已人工抽样复核。
