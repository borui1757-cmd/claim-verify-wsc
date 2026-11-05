# claim-verify-wsc

> 不给答案打分，去问真值。
> Score nothing. Verify against reality.

**框架无关**：核心是纯 Node、零第三方依赖；DSH 只是其中一个适配器（`lib/index.js` 的 `apply`），
CLI 和程序化 API 在 DSH 之外也能直接用。名字里的 `wsc` 是作者署名。

> ⚠️ **实验版（`0.5.0-experimental.1`）**：默认 **observe** —— 只写日志，不追加说明、不打断对话。
> 真实对话里的真阳性样本还是个位数，"误报率"目前只有回放数据 + 26 条构造评测，没有大规模独立标注。
> 想让它开口，配 `annotate: true`；想先看它在你这台机器上抓到什么，读 `~/.dsh/dsh-claim-verify/hits.jsonl`。

一个挂在 agent 输出钩子上的**断言核验器**：把回答里「能核验的断言」抽出来，向本机要真值；对不上就标出来（可选：触发升级重答）。

和市面上主流方案的区别：**默认层不用第二个模型当裁判**。默认开启的核验全部是程序真值（端口探活、`existsSync`、日历、算式、目录计数），零模型调用；句子级模型核验是**可选层，默认关闭**。

---

## 它和 LLM 裁判是互补，不是替代（2026-11-05 实测）

同一批 26 条样本、同一份事实清单，两种方法各跑一遍：

| 断言域 | 本插件（程序真值） | deepseek-chat 当裁判 |
|---|---|---|
| 机械事实（端口/路径/日期/算式/计数）<br>18 条，其中 10 条是错的 | **P 100% / R 100% / F1 100%**<br>**0 次模型调用** | P 100% / **R 40%** / F1 57% |
| 叙事结论（"我改好了"/"服务停了"/"全部成功"）<br>8 条，其中 5 条是错的 | R 0% | **P 100% / R 100%** |

所以：**它不替代 LLM 裁判，只补「机械事实」这一类**。强模型漏掉的 6 条全是硬事实——`18080 端口`、不存在的路径、`12 月 6 日`、`1873×4=7000`、`1024/8=64`、`21 个 html 页面`。

成本对照：整批 26 条，程序真值 **0 次模型调用**；deepseek-chat 裁判 **26 次调用、约 21 秒**。

复现：`node eval/compare.mjs --judge=deepseek`，完整输出见 `eval/results-2026-11-05.md`。
样本用构造法生成（真值现场确认），共 26 条；**样本量还小，不能外推到"超过大厂"**。

---

## 安装（实验版）

普通的 DSH bundle 插件，装法和其它本地插件一样：

1. 把本目录放到任意位置（例如 `<workspace>/plugins/claim-verify-wsc`）
2. 在 profile 的 `package.json` 里加两处：

   ```jsonc
   "dependencies": { "claim-verify-wsc": "link:<插件绝对路径>" },
   "dsh": { "profile": { "bundles": [ /* ... */ "claim-verify-wsc" ] } }
   ```

3. 手工建 `node_modules/claim-verify-wsc` → 指向插件目录的 junction / 软链
   （**不要对正在运行的 profile 跑 `pnpm install`**，这条我们踩过坑）
4. 重启宿主

验证：`~/.dsh/dsh-claim-verify/loads.jsonl` 里出现 `"event":"loaded"` 就说明加载成功。

---

## 为什么需要它

agent 的假话有一半是「可核验的」：它说端口是 64164、文件在某个路径、今天周几、987×13 等于多少。这些不需要判断力，只需要去问一次真实系统。

但绝大多数防护方案做的是：

1. **再叫一个模型判好坏**（LLM-as-judge / RAGAS faithfulness）—— 贵、慢、自己也会编
2. **只判有没有引用来源**（attribution）—— 有来源不等于说对了
3. **只在发布前跑回归**（offline eval）—— 拦不住运行时现编

这个插件走第四条路：**能核验的就去核验，核验不了的不装作知道。**

---

## 核验什么（可扩展）

| 类别 | 抽取信号 | 真值来源 |
|---|---|---|
| 端口 | `127.0.0.1:8271`、「端口是 8271」+ 在跑/监听类断言词 | TCP connect 探活 |
| 路径 | `C:\...` / `~/...` + 在/是/配置类上下文 | `fs.existsSync` |
| 进程 PID | 「PID 71144 还在跑 / 已经不在了」 | `process.kill(pid, 0)`（EPERM 也算存在） |
| 文件行数 | 「`x.log` 一共 65 行」 | 读文件数换行 |
| 文件大小 | 「`x.log` 大小 20 KB」 | `fs.statSync().size`，2% 容差 |
| 文件哈希 | 「sha256 前 8 位是 a1b2c3d4」 | 现算 sha256 前缀比对 |
| 依赖版本 | 「`claim-verify-wsc@0.2.0`」「`x` 的版本是 1.2.3」 | 读 `node_modules/<name>/package.json` |
| 内存余量 | 「可用内存 12 GB」 | `os.freemem()`，25% 容差 |
| 磁盘余量 | 「C 盘剩余 500 GB」 | `fs.statfsSync()`，25% 容差（无子进程） |
| 服务状态 | 「服务 Spooler 正在运行 / 已经停止」 | `spawnSync('sc', ['query', name])` |
| 注册表值 | 「HKLM\…\Services\Spooler 的 Start 是 2」 | `spawnSync('reg', ['query', key, '/v', name])` |
| 计划任务 | 「计划任务 X 状态是就绪」 | `spawnSync('schtasks', ['/query','/tn',name,'/fo','list'])` |

**需要 spawn 的三类有硬预算**：单次 400ms 超时、每轮最多 3 次、同名真值 20 秒缓存。
实测（本机，`spawnSync` 不经 cmd shell）：`sc` 13ms / `reg` 12ms / `schtasks` 30ms；
对照 `powershell Get-Service` **429ms** —— 任何"顺手用 PowerShell 查一下"的实现都是错的。

> **踩坑记录（2026-11-05）**：这些系统工具在中文 Windows 上输出的是 **OEM 代码页（GBK/936）**，
> 按 UTF-8 解码会把「模式: 就绪」变成乱码，正则永远匹配不上。现在统一用
> `new TextDecoder('gbk')` 解码（英文系统下对 ASCII 恒等）。另外 `schtasks` 的运行状态在
> **「模式」** 栏而不是「状态」栏——「计划任务状态: 已启用」是另一个字段，且必须锚定行首，
> 否则「登录状态: 只使用交互方式」会被误当成任务状态。
| 时间 | 「现在时间是 05:30」 | `new Date()`，±5 分钟 |
| 日期/星期 | 「今天是 11 月 5 日 / 星期三」 | 本地日历 |
| 算式 | 「1873 乘以 4 等于 7000」 | 实际计算 |
| 计数 | 「一共 9 个 html 页面 / N 个按钮」 | 目录读取、DOM 计数 |
| 模型 | `provider/model` + 当前/本会话类断言 | 账单记录里本会话最后一条 |
| 金额 | 「今天花了 ¥12」 | 账单汇总，带容差 |

设计原则：**取不到真值就放过（unknown），绝不猜；疑问句、举例、假设一律不抽。**

---

## 四种用法

### A. 输出钩子（本仓库的形态）

```js
ctx.on('llm/stream', (options, next) => {
  // …收全文，在 finish 前追加核验结论
});
```

对不上的断言追加一段说明（**不覆盖原文**，改写会破坏流式与工具调用交错）：

```
【核验】本条回复有 1 处断言与实际不符（程序刚跑的，不是模型判断）：
- 端口 64164 → DSH 实际端口是 3080
```

### B. 级联触发器（已实现，默认关闭）

把「真值核验失败」当作**升级重路由的触发条件**：

```
便宜模型出答案 → 真值核验 → 对不上 → 下一次请求换强模型 → 再核验一次
```

现有级联（cascade）几乎都用**模型自评/置信度/第二个模型打分**来触发。
用「本机真值对不上」触发的，我们在公开项目里还没见到——同类项目（writeguard、
verifier-agent 等）做的是**事后报告或拦截**，不拿核验结果去驱动重路由。

**为什么挂在 `agent/request` 而不是 `llm/stream`**：后者的签名是
`(options, next) => AsyncIterable`，而 `next` 是 `() => AsyncIterable`——**不接受参数**，
第二次调用只会用同一个已准备好的调用再请求同一个模型，换不了 provider/model；
而且下游插件（比如计费）会被重复触发。`agent/request` 的契约允许监听器直接返回改过的
`{ provider, model }`，这才是升级的落点。

**语义边界（别夸大）**：它提升的是**下一次请求**所用的模型，不是把这一轮的回答推倒重来。
真正的"重答同一句"要在 agent loop 层面重放，那是另一个量级的改动。

```yaml
config:
  cascadeEnabled: true
  cascadeProvider: deepseek-account
  cascadeModel: deepseek-flash
  cascadeMax: 2          # 单会话最多升级几次，防循环
```

规则：只有**硬不符**（非低置信类）才触发；已经在目标模型上就不再升；升级记录写
`escalations.jsonl`，用来统计"升级之后是否真的更准"。

### C. 命令行（在 DSH 之外也能用）

```bash
node bin/claim-verify.mjs "服务 Spooler 已经停止"      # 人读
node bin/claim-verify.mjs --json "可用内存 99 GB"      # 机器读
echo "端口 3080 在跑" | node bin/claim-verify.mjs      # stdin
```

有硬报时退出码为 1，可以直接塞进 CI 当门禁。

### D. 程序化 API（接任何框架）

```js
import { verifyText, renderNote } from 'claim-verify-wsc';

const { claims, checked, bad } = await verifyText(modelOutput, { sessionId: 'x' });
```

**DSH 只是其中一个适配器。** 真正跟 DSH 绑定的只有三处：`apply(ctx, config)`、
`ctx.on('llm/stream')`、以及 cordis 的 bundle 注册；抽取层（`lib/index.js` 的
`extractClaims`）和真值层（`lib/host.js`、`lib/extra.js`）是纯 Node、零第三方依赖，
可以直接接到 OpenAI 代理中间件、LangChain callback、MCP server 或任何有"输出钩子"的地方。
`@deepseek-ai/schemastery` 只在 `lib/config.js` 里用，且是动态加载——没有它也能跑。

---

## 默认 observe，不是默认拦截

发布版默认 `annotate: false`——只写日志不追加。原因很直白：**误报比不报更烦人**。

我们自己的实测数据（2026-11-05 一晚，`~/.dsh/dsh-claim-verify/hits.jsonl`）：**14 次核验、35 条断言命中，其中真错只有 5 条**（全是端口：说 64164/8271 而实际 3080），其余 30 条是误报——

- Markdown 链接尾部的 `>` 被当成路径的一部分（`...index.js>`）
- 配置值 `perConversationCny: 0.01` 被当成「今天花了 0.01」
- 单价 `¥1/M`、`¥4/M` 被当成花费
- `notes/00-ideas.md`、`qq-bridge/config.json` 被当成 `provider/model`

**精度不到 15%，所以默认必须是 observe。** 现在的策略是**置信分层**：

| 层 | 类别 | 行为 |
|---|---|---|
| 高置信 | 端口 / 路径 / 时间 / 日期 / 算式 | 核验并报告（实测 5/5 命中全对） |
| 低置信 | 金额 / 模型 / 计数 | **只记日志，不报告、不触发升级**（实测 30/30 全错） |

七条防误报规则（已修）：

1. 路径排除 `<>` 与引号，尾部标点清洗
2. 金额只认「今天/累计」口径，且排除上限/单价/配置上下文
3. 模型名排除文件扩展名与目录前缀（`plugins/`、`notes/` 这类），占位符（`provider/model`）过滤
4. 取不到真值一律放过
5. **句内作用域**：断言词必须与候选值同句；假设句（比如/如果/可能）、问句整句放过
6. **极性判定（NegEx 精简版）**：句内扫否定线索词（没有/不是/未/不在…）+ 24 字作用域，
   伪否定（不仅/不但/不得不）先抹掉；否定断言不是丢弃，而是**期望值取反**核验——
   「18080 没有服务在监听」探活为 false 才算对，「3080 明明在监听却说没有」照样报
7. **URL 里的 host:port 不算端口断言**（`127.0.0.1:18080/authorize?...` 是登录链接，不是监听状态）

> 规则 6 的依据：NegEx 的「线索词 + 作用域」是临床 NLP 的标准做法，词表 191 条含 11 条伪否定
> （[NegEx](https://dl.acm.org/doi/pdf/10.1145/2110363.2110443)）；「抽取要 precision-first、宁可少抽也别抽错」
> 与 FActScore 对命题分解的经验一致（[FActScore, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.741.pdf)）。

**第二轮实测（2026-11-05 07:00，加完规则 5–7）**：拿 `hits.jsonl` 里 25 条历史误报原文回放，
仍会抽出断言的只剩 3 条 —— 其中 2 条是刻意写的错断言（`__no_such_file__.md`，本就该报），
1 条是被正确识别成否定式的 `18080`。**误报从 25/25 降到 0/25。**

**看日志攒够样本，再开拦截。** 这条比任何宣传语都重要：一个误报率 85% 的核验器，比不装更糟。

---

## 配置

```yaml
- id: claim-verify-wsc
  name: claim-verify-wsc
  config:
    enable: true
    annotate: false        # 默认只记不拦；要看到【核验】说明改成 true
    budgetMs: 1500         # 核验预算，超时放过
    portTimeoutMs: 300
    moneyTolerance: 0.3
    pagesDir: ''           # 可选：数 html 页面的目录，不配就跳过计数类
    buttonsFile: ''        # 可选：数按钮的 html 文件，不配就跳过
```

日志：`~/.dsh/dsh-claim-verify/hits.jsonl`（每次命中）、`loads.jsonl`（加载探针，用来确认插件真被宿主加载）。
> 日志目录名沿用了旧包名，为的是不改动历史数据位置。

---

## 局限（写清楚，不吹）

- 只覆盖**可核验**类断言。「为什么这个模型不聪明」「这个方案好不好」这类没有真值源，它不碰。
- 真值源要接：账单路径、服务端口、目录位置都是环境相关的，本仓库带的是 DSH 本机默认值。
- 追加的说明会进入下一轮上下文，模型可能引用它（有意为之）。
- 不是评测替代品：它管运行时，回归测试管发布前。

---

## 自测

```bash
node test/dry.mjs      # 抽取 + 核验 + 拼接（注入假真值，不联网）16 个用例
node test/hook.mjs     # 端到端：假流 → finish 前追加
node test/policy.mjs   # 置信分层 + 解析修复（防止再退回 85% 误报）
node test/resolve.mjs  # profile 侧 junction 能否解析到插件
node test/replay.mjs   # 拿 hits.jsonl 里的真实误报原文回放，量误报率
```

## 评测（eval/）—— 「最强」只能靠数字说

`test/` 管回归，`eval/` 管**指标**。两者别混。

> `eval/` **不随 npm 包发布**（`corpus.jsonl` 含真实会话片段），只在仓库里跑；
> 发布出去的是 `lib/ + bin/ + test/ + 文档`。`npm test` 在任何环境都能跑。

```bash
node eval/gold.mjs           # 金集：真值由构造决定，能同时算 precision 与 recall
node eval/corpus.mjs 200     # 真实语料：从会话原始记录抽 200 条回复，统计覆盖率 + 待标注清单
node eval/score.mjs          # 用 corpus.jsonl 的 label 算真实语料 P/R
```

**首轮结果（2026-11-05，57 条金集用例）**

| 口径 | precision | recall |
|---|---|---|
| 对用户可见的报告（端口/路径/时间/日期/算式/进程/文件属性/依赖版本/内存磁盘/服务/注册表/计划任务） | **1.000** | **0.850** |
| 含只记日志的低置信类（模型/金额/计数） | **1.000** | **1.000** |

recall 的 3 条缺口全部来自「故意不报」的低置信类（金额/模型/计数口径歧义大），不是抽不到。

**真实语料（200 条回复，稳定抽样）**：35 句含可核验断言、41 条断言；硬报 10 条。
逐条看：`date`/`time` 是**状态过期**（当时 02:24、现在 07:21）；`port` 那几条是
「用 adb 连 `127.0.0.1:16384`」这类**目标地址**，不是「现在在监听」；剩下一部分是路径后来被删。
**没有一条指向抽取层的结构性错误**——结构性错误在上一轮已经被榨干了（见下）。

> **抽样必须稳定**：早期用等距抽样，每加一条新会话下标全平移，三次跑出三批不同样本，
> 指标根本没法比较。现在改成**按正文哈希排序取前 N**，同一样本可复现。

> **方法论警告**：历史文本必须按**当时**的事实判定，不能拿现在的系统状态当准。
> `eval/corpus.mjs` 的核验结果只用来找**抽取层 bug**，不能当 precision 用——
> 正是这样抓到并修掉了 8 个真 bug：`C:\Program Files` 被空格截断、`#L29-L30` 行号锚点
> 被当成路径、祈使句「删 X」被当成断言「X 存在」、`今天是星期三。`（7 字）被长度保护整句跳过、
> 「`C:\x` **不在工作区里**」被读成「`C:\x` 不存在」（否定作用域越界）、
> 带序号指令被当成端口断言、**附加疑问句**「…这个页面**吧**」被当成断言、
> 中文引号 `“…”` 后面的解释被卷进路径值；另外补了「adbd **没有运行**起来 / → **不通**」
> 这类端口否定线索、元文本（引用原句讨论语法）、命令行（`adb connect …`）三类放过规则。




---

## 与同类方案的位置

### 一、已有的同类项目（截至 2026-11-05）

**这个方向不是我们首创。** 下面这些都在做「核验 agent 的断言 / 完成声明」，按接近程度排：

| 项目 | 它做什么（按其自述） | 与我们的差别 |
|---|---|---|
| [writeguard](https://github.com/brokenbartender/writeguard) | 校验 coding agent 声称对文件系统做的改动；哈希基准、零依赖、框架无关 | 只覆盖文件系统；我们是 14 类本机断言 + 否定极性 |
| [verifier-agent](https://github.com/isr4el-silv4/verifier-agent) | 监视 Pi coding agent，把每条断言对照文件系统真实状态核验 | 绑定单一 agent；我们是通用输出钩子 + 可独立调用的 API |
| [completion-checker](https://github.com/Amidwestnoob/completion-checker) | 对本地 agent 的任务声明做独立的文件系统核验 | 同上，且同样只到文件系统 |
| [rashomon](https://github.com/altrace-dev-role/rashomon) | 独立记录每次工具调用，标记「总结说测试全过、但其实失败」 | 它靠**旁听工具调用**推断；我们靠**读输出正文**抽取断言，不依赖 agent 框架的内部事件 |
| [sentinel](https://github.com/Rahulanand112/sentinel) | 拦截工具调用，声明结果对照独立证据（diff / 执行轨迹 / 隐藏测试） | 它是完整 runtime 中间件；我们是单点插件，只做一件事 |
| [Veract](https://github.com/Diwakarsrd/Veract) | local-first 可验证 agent runtime，「runtime 应该证明它完成了」 | 同上，runtime 级方案；我们可挂在任何有输出钩子的框架上 |

**共同点**：都认为「agent 不该自己宣布成功」。这一点我们不宣称原创。

需要说清楚的是：上面这些目前多是 0–1 star 的个人项目，**没有成熟实现和社区**。
但「没有成熟实现」不等于「我们更好」，只是目前还没人把它做扎实。

### 二、我们不一样的三点（都有代码支撑）

1. **覆盖面**：同类几乎只做文件系统。我们做 14 类，含端口探活、Windows 服务状态、
   注册表、计划任务、进程 PID、内存磁盘——这些要 `sc` / `reg` / `schtasks` 或 SCM API，
   不是 `fs.readFile` 能覆盖的。
2. **否定极性**：「`127.0.0.1:18080` 本机**没有**服务在监听」不能当成「在监听」去核验。
   我们用 NegEx 的线索词 + 作用域处理，并把否定断言**期望值取反**。同类里没见到这一层。
3. **中文句式**：同类都是英文句式。中文的否定（没有/不是/未）、附加疑问句（…吧）、
   祈使句（删 X）都要单独处理，我们踩过的 8 个真 bug 里有一半属于这类。

另外一个差异：我们**只追加说明，不拦截也不改写**——改写会破坏流式与工具调用交错。

### 三、广义对照

| 方案 | 判定依据 | 额外成本 | 会自己编吗 |
|---|---|---|---|
| LLM-as-judge / RAGAS faithfulness | 另一个模型 | 一次模型调用 | 会 |
| Guardrails validators | 规则/检索 | 低 | 部分 |
| 发布前回归（hallu-suite 之类） | 固定题集 | 无 | 不会，但拦不住运行时 |
| **本插件** | **本机真值** | **无模型调用** | **不会** |

---

MIT. 只为解决一件事：**让 agent 在说「端口是 64164」之前，先去问一句。**
