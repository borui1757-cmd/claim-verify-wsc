# v0.3 设计说明：防虚报完成（report–trace 审计）

> 主要参考：**Who Verifies the Agent's Success Claim? Self-Report Leakage in GUI-Agent
> Completion Judging**（arXiv [2610.29609](https://arxiv.org/abs/2610.29609)，ICSE 2027 接收）
>
> 文中标注 **[论文]** 的是该论文已确立的结论；**[本设计]** 是我把它映射到 DSH 插件上的具体选择，
> 尚未验证——按本项目的规矩，没跑过的都当假设。

---

## 一、论文给我们的三条硬结论 **[论文]**

### 1. 问题定义

一次运行建模为 `u = (x, τ, m)`：

| 符号 | 含义 | 在 DSH 里对应什么 **[本设计]** |
|---|---|---|
| `x` | 自然语言任务 | 用户这一轮的要求（`user/message`） |
| `τ` | 独立记录的执行轨迹 | `session/event` 流里的 `tool/call` / `tool/result` |
| `m` | agent 自己的最终报告 | `llm/stream` 收全文后的 assistant 正文 |

**dangerous misreport**（危险误报）的定义：报告宣称成功，但轨迹不支持"agent 在本次运行中
自己产出了任务要求的结果"。

关键点：**最终屏幕/状态看起来对，不等于它做到了**。论文列举了四种假成功——目标状态本来就存在、
目标列表为空、代理屏幕、编辑未保存。

### 2. self-report leakage（自我报告泄漏）

同一裁判读同一份任务和轨迹，只把 agent 的自我报告给或不给：

- Qwen3.5-35B-A3B：扣掉报告后，只靠轨迹抓危险误报的**召回率提升 43.4 个百分点**
- DeepSeek-284B-A13B：提升 **13.3 个百分点**

→ **报告不是中立的上下文，它是污染源。** 它会让裁判倾向于"判定完成"。

### 3. 因此必须 report isolation（报告隔离）

不是"提示词里叫模型别看报告"，而是**在信息流上切断**：

```
① ClaimReader    ── 只读 m（报告）        → 产出 claim intent c*
② TraceExtractor ── 只读 x 和 τ（绝不读 m） → 产出 typed evidence
③ Policy         ── 只读 ①和②的产物      → pass / flag / review
```

论文的隔离是"结构强制"，不是提示词自觉。

**效果** **[论文]**
- F1 **0.75–0.78**（465 条审计记录，含 180 条危险误报）；留出集 **0.77–0.81**
- 门控下（flag 和 review 都拦住自动通过）能挡 **74–90%** 的危险误报，代价是 **45–56%** 的复核量

---

## 二、和我们现在的实现差在哪 **[本设计]**

| 方面 | 现在（v0.2） | v0.3 应该 |
|---|---|---|
| 抽取 | `extractClaims(text)` 读全文，声明与判定同源 | 拆成 ClaimReader / TraceExtractor 两个模块 |
| 真值 | 探当前系统状态（有时间差） | **优先对账轨迹**（无时间差），状态兜底 |
| 隔离 | 无 | Extractor 的函数签名里**根本拿不到报告文本** |
| 输出 | 一段追加说明 | 结构化审计记录（`pass`/`flag`/`review`） |
| 可复现 | 不能 | 证据缓存 + 策略可换，重放不用重新取证 |

**归因**：我们现在的"抽取→核验"在一条流水线上，报告既是"待验对象"又参与了"事实形成"，
正是论文说的循环论证。这是**结构缺陷**，不是精度问题。

---

## 三、三段式架构 **[本设计]**

### ① ClaimReader（读报告，不读轨迹）

职责：从报告里抽"动作类断言"。

```js
// 输入只有 { reportText, turn }
// 注意：函数签名里没有 trace —— 靠类型保证隔离
{
  id: 'c1',
  kind: 'action',            // 只做动作类
  verb: 'create',            // create|modify|delete|start|stop|test_pass|write
  target: {
    type: 'path' | 'service' | 'pid' | 'command' | 'task',
    value: 'C:\\Users\\19156\\Desktop\\out.json'
  },
  count: null,               // 「已修改 3 处」里的 3
  hedged: false,             // 有 应该/大概/可能 = 非确定，降低权重
  raw: '已创建 C:\\Users\\19156\\Desktop\\out.json'
}
```

动作类句式白名单（precision-first）：

```
已创建 / 已新建 / 已写入 / 已保存 / 已修改 N 处 / 已删除 /
已启动 / 已停止 / 已在跑 / 服务已重启 / 测试全部通过 / 构建成功 / 已提交
```

**不收**：时间、金额、算式、模型名——这些没有轨迹可对账，留给旧路径（状态兜底）。

### ② TraceExtractor（读轨迹，**拿不到报告**）

职责：把轨迹压成"实际发生了什么"的证据表。

```js
// 输入只有 { events, taskText }，绝无 reportText
{
  writes:  [{ path, tool, ok, seq }],      // write / edit / str_replace 类工具
  deletes: [{ path, tool, ok, seq }],
  commands:[{ cmd, tool, exitCode, ok, seq }],
  services:[{ name, action, ok, seq }],
  tests:   [{ cmd, exitCode, ok, seq }],
  spawns:  [{ pid, tool, seq }],
  summary: { totalCalls, failedCalls, truncated: false }
}
```

**失败也算证据**：`tool/result` 里 `isError` 或非零退出码，是"没做成"的直接证据——
这是探活给不了的（探活只能看到最终状态）。

### ③ Policy（确定性规则，无模型）

输入只有 `claims[] + evidence`，输出 `pass | flag | review`：

| 情形 | 判定 | 理由 |
|---|---|---|
| 断言的动作在证据里找到且 `ok: true` | `pass` | 轨迹支持 |
| 断言的动作在证据里找到但 `ok: false` | **`flag`** | 做了但失败了——最危险的误报 |
| 断言的动作**完全找不到**，且轨迹非空 | **`flag`** | 没做过 |
| 断言的动作找不到，且轨迹被截断/为空 | `review` | 证据不足，不敢下结论 |
| 断言非动作类（时间/金额/算式） | 走旧路径 | 不在本次范围内 |
| 报告中措辞模糊（hedged） | 降级为 `review` | 不确定声明不算硬失败 |

**默认 observe**：`flag` 只记日志，`annotate: true` 才追加说明。

---

## 四、DSH 侧接入点 **[本设计]**

### 轨迹从哪来

`dsh-agent-loop` 写的是 session 事件：

```js
// dsh-agent-loop/lib/index.js
682:  session.append("tool/call",   {...})
697:  session.append("tool/result", {...})
```

`Session.commit()`（`dsh-session/lib/index.js:1579`）会 publish 到 `session/event`，
回调签名 `(session, event)`。所以：

```js
ctx.on('session/event', (session, event) => {
  if (event.type === 'tool/call')   buf.push({ side: 'call',   data: event.data, seq: event.seq });
  if (event.type === 'tool/result') buf.push({ side: 'result', data: event.data, seq: event.seq });
});
```

按 `sessionId` 分桶，`turn` 结束时取用并清空（避免无界增长）。

### 时序 **[本设计]**

```
llm/stream 收全文 ──► 到 finish 时
                         ├─ ClaimReader(reportText)        ← 只看报告
                         ├─ TraceExtractor(turnEvents)     ← 只看轨迹（函数拿不到报告）
                         └─ Policy(claims, evidence)
                              └─ flag/review → 日志 +（可选）追加说明
```

**必须等 turn 真正结束再评估**：一轮里可能有多个 step，前一个 step 的工具调用属于同一轮。
按 `turn/end` 或 `step` 归属取整轮事件。

---

## 五、改造清单 **[本设计]**

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/trace.js` | **新增** | 订阅 `session/event`，按会话累积工具轨迹；提供 `takeTurn()` |
| `lib/actions.js` | **新增** | ClaimReader：动作类断言抽取（句式白名单 + 否定极性复用现有 NegEx） |
| `lib/evidence.js` | **新增** | TraceExtractor：轨迹 → typed evidence；**签名里没有 reportText** |
| `lib/policy.js` | **新增** | 确定性判定，输出 pass/flag/review + 理由 |
| `lib/audit.js` | **新增** | 拼装三段，写 `audit.jsonl`（可重放） |
| `lib/index.js` | 改 | 挂 `session/event`；`finish` 时走 audit 分支；保留旧路径做兜底 |
| `lib/config.js` | 改 | 新增 `auditEnabled` / `auditMode: observe|annotate` |
| `test/audit.mjs` | **新增** | 造 12–15 条轨迹+报告组合，断言判定正确 |
| `docs/design-v0.3-trace-audit.md` | 本文件 | — |

**隔离怎么保证**（这是本设计的核心约束）：

1. `buildEvidence(events, taskText)` 的形参里**没有 report**
2. `audit()` 里先调 `buildEvidence`，再调 `readClaims`，**顺序固定**
3. 测试里加一条静态检查：`evidence.js` 不得 import 任何含 claim/report 字样的模块

---

## 六、实施顺序 **[本设计]**

1. **只做证据层**（`trace.js` + `evidence.js`），先不判定——用真实会话跑一遍，
   把 `tool/call` + `tool/result` 的形状摸清（不同工具的数据结构不一样，这是最大未知）
2. 加 `actions.js` + `policy.js`，用**手工标注的 30 条**验证判定
3. 接进 `finish`，默认 observe 跑一周，看 `audit.jsonl`
4. 有数据后再开 `annotate`

**不要跳步**：第 1 步没做扎实，后面的规则全是空中楼阁。

---

## 七、风险 **[本设计]**

| 风险 | 说明 | 应对 |
|---|---|---|
| 工具参数结构不统一 | `write`/`bash`/`edit` 的 data 形状大概率不同 | 第 1 步先摸清，按工具名分派解析器 |
| 轨迹可能被裁剪 | 长会话里 `tool/result` 会被压掉（`dsh-compaction-tool-result-pruner`） | 检测 `truncated` 标记 → 判 `review` 而不是 `flag` |
| 一轮跨多个 step | 事件归属易错 | 按 `turn/end` 收口，不按 `finish` |
| 报告里**没提**的动作 | 做了但没说 → 不该 flag | 只对账"报告声称的动作"，反向不做 |
| 我们做不过论文 | 他们 465 条标注、F1 0.78 | 不承诺数字；先跑通，再谈指标 |

---

## 八、定位（据此更新对外说法）
不再说"断言核验器"，改说：

> **防虚报完成的护栏**：在 agent 汇报"已完成"时，用**独立的工具调用轨迹**核对它到底做没做，
> 而且是**claim-blind**——先不看它怎么说，只看它做了什么。

参考论文的结论，**这条路的天花板是 F1 0.78 左右、复核量 45%**，不是"全自动零误报"。
对外要按这个口径写，别承诺做不到的事。
