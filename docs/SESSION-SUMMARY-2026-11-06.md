# 会话小结 · 2026-11-06（凌晨）

> 一页纸，明天从这里接上。

## 一、仓库与产物

| 项 | 状态 |
|---|---|
| GitHub | https://github.com/borui1757-cmd/claim-verify-wsc（公开，100+ 文件） |
| 测试 | **48 个测试文件，0 FAIL** |
| 录屏 | `C:\Users\19156\Desktop\claim-verify-demo.mp4`（27 秒，四场景） |
| 投稿目标 | **FSE 2027 Tool Demonstrations**，截止 **2027-01-26** |

## 二、今天新增的机制

| 机制 | 文件 | 测试 |
|---|---|---|
| 原子写 + 撤销 | `lib/dsl.js`（write_file / restore_file） | `test/atomic.mjs` 14/14 |
| 外部世界模型（账本） | `lib/worldmodel.js`、`bin/worldmodel.mjs` | `test/worldmodel.mjs` 13/13 |
| 自校准 + 重复拦截 | `lib/calibration.js` | `test/calibration.mjs` 13/13 |
| 元声明核验（"我查过了"） | `lib/isolated-audit.js`（meta_verify） | `test/meta.mjs` 12/12 |
| 矛盾优先级 | `lib/priority.js`、`bin/priority.mjs` | `test/priority.mjs` 10/10 |
| 慢循环（整理账本） | `lib/consolidate.js`、`bin/consolidate.mjs` | `test/consolidate.mjs` 15/15 |
| 激素式全局调制（**默认关闭**） | `lib/hormone.js` | `test/hormone.mjs` 15/15 |
| MCP 服务 | `lib/mcp-core.js`、`bin/mcp-server.mjs` | `test/mcp.mjs` 15/15 |
| 可复核命令（反馈带命令） | `lib/feedback.js`（reproduceHint） | `test/hint.mjs` 12/12 |
| 护栏自评 | `eval/guardrail-check.mjs` | 自评 **4/5** |

## 三、实验与数字

| 实验 | 结果 |
|---|---|
| 报告缺口 | 18,066 动作仅 **6.4%** 被提及；命令 **0.2%**；**91.8%** 含失败案例从不提失败 |
| 结构化声明 | 自由文本覆盖 **22.5%** → 结构化 **100%**（n=4） |
| 回写（不可恢复） | 谎报 3/3 → 0 |
| 回写（可恢复） | 任务成功率 0% → 100%（token ×3.2） |
| 回滚 vs 反馈 | 无核验 0% / 仅回滚 **17%** / 回滚+反馈 **100%** |
| 通道 vs 措辞 | 无通道 1/6 → 有通道 5/6 → 加提示 6/6 |
| **调质旋钮 soft vs firm** | **无差异**（负结果，已写进 §3.9） |
| 材料性分级 | 噪音占 **28.5%**；分级后前 8 噪音 2/8 → 0/8 |

## 四、论文状态

| 文档 | 状态 |
|---|---|
| `THESIS-骨架.md` | 8 章 + **威胁模型/non-goals 专节** |
| `THESIS-系统方案.md` | 3.1–3.11，含 **3.9 外部世界模型**、**快慢双循环（MAPE-K）**、调制负结果 |
| `THESIS-实验与鲁棒性.md` | 7.0–7.9，含 7.6.1–7.6.7 |
| `TOOLPAPER-FSE2027-骨架.md` | 4 页结构 + 9 行评估表 + 录屏脚本 + 投稿清单 |
| `REBUTTAL-质疑回应.md` | 6 条质疑逐条 |
| `GuardrailBench-骨架.md` | 五条判据 + 自评工具 |
| `FUTURE-IDEAS.md` | 区间化核验（未做） |

## 五、明天要做的两件

1. **架构图 Fig.1**（报告/轨迹/OS 真值 → 判定 → 回执 → 回写）
2. **4 页英文正文**（骨架已定，直接扩写）

## 六、必须记住的边界

- 覆盖面 **18.5%**（自评门槛 30%）没达标——原语数量是原因，不是判据失败
- **不训练模型**：世界模型是外置账本，不是权重
- 回执证明"某人给出过这个判定"，**不证明判定语义正确**
- 回滚只覆盖受控原语，shell 副作用只核验
- 所有"不是首创"的地方都已在文档中标注

## 七、一句自省

今晚我在对话里**四次**把没查的事实说成"查过了"（时间三次、一次元声明）。
这不是记性问题，是**没有闸门**——正是我们论文的论点。
插件的 `annotate` 已改为 `true`，但**需要重启宿主才生效**。
