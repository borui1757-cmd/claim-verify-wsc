# CHANGELOG

## 0.2.0-experimental.2 — 2026-11-05

- **新增级联触发**（`lib/cascade.js`）：核验出现**硬不符**后，下一次 `agent/request`
  自动把模型升级到指定的一档；带 `cascadeMax` 上限、已在目标模型上不重复升级。
  升级记录写 `escalations.jsonl`。
- 为什么挂在 `agent/request` 而不是 `llm/stream`：后者 `next` 不接受参数，换不了模型，
  二次调用还会重复触发下游插件（计费）。详见 README B 节。
- 新增 `test/cascade.mjs`（5 个用例：不升级 / 升级 / 只消费一次 / 受上限约束 / 防自我循环），
  已并入 `npm test`。

## 0.2.0-experimental.1 — 2026-11-05

- **改名** `dsh-claim-verify` → **`claim-verify-wsc`**（作者署名 wsc；去掉了 `dsh-` 前缀，
  因为它不再只服务 DSH）。
- **与 DSH 解耦**：`@deepseek-ai/schemastery` 从 `lib/index.js` 挪到单独的 `lib/config.js`，
  并改成动态 import。没有 DSH 依赖时 `Config` 为空，核心（`verifyText` / CLI）照常工作。
- 新增程序化 API `verifyText()` / `renderNote()` 与命令行入口 `bin/claim-verify.mjs`。
- `test/resolve.mjs` 改成非 DSH 环境自动 SKIP，可直接进 CI。
- 修 `fmtBytes` 只到 MB 的问题（4.4 GB 会被显示成 4459.52 MB）。

## 0.2.0-experimental.0 — 2026-11-05

首个对外实验版。**默认 observe：只写日志，不追加说明。**

### 可核验断言（14 类，真值全部来自本机）

端口 · 路径 · 进程 PID · 文件行数 · 文件大小 · 文件哈希 · 依赖版本 ·
内存余量 · 磁盘余量 · 服务状态 · 注册表值 · 计划任务 · 时间 · 日期/星期 · 算式 · 计数

### 新增（相对 0.1.x 内部版）

- `lib/host.js`：进程 PID / 文件行数 / 文件大小 / 文件哈希 / 依赖版本 / 内存 / 磁盘 /
  服务 / 注册表 / 计划任务，共 10 类主机断言。
- 需要 spawn 的三类（服务/注册表/计划任务）带硬预算：单次 400ms 超时、每轮最多 3 次、
  同名 20 秒缓存。
- `eval/`：金集评测（`gold.mjs`，57 条用例，算 precision + recall）+ 真实语料回放
  （`corpus.mjs` / `score.mjs`，稳定抽样）+ 真机冒烟（`smoke-host.mjs`）。
- CI：ubuntu/windows × node 20/22/24。

### 修复（内部版期间抓到的真 bug，均由评测发现）

- 追加说明的流式块不合法，导致**整轮会话失败**（高危）
- 「今天是星期三。」7 个字被长度保护整句跳过
- `C:\Program Files` 被空格截断成 `C:\Program`
- `#L29-L30` 行号锚点被当成路径的一部分
- 中文引号 `“…”` 之后的解释被卷进路径值
- 祈使句「删 X」被当成断言「X 存在」；带序号的指令被当成端口断言
- 「`C:\x` 不在工作区里」被读成「`C:\x` 不存在」（否定作用域越界）
- 附加疑问句「…这个页面吧」被当成断言
- `127.0.0.1:18080/authorize` 这种 URL 被当成端口断言
- 系统工具输出是 **GBK** 而非 UTF-8，导致服务/计划任务真值全部取不到（静默失效）
- `schtasks` 的运行状态在「模式」栏，且必须锚定行首，否则「登录状态」被误读

### 破坏性变更 / 迁移注意

- `annotate` 默认值从 `true` 改为 **`false`**（observe-first）。要看到【核验】说明需显式配置。
- 计数类断言不再有内置目录：必须配 `pagesDir` / `buttonsFile`，否则整类跳过。
  （旧版硬编码了作者本机的 `relay/public` 路径，对其他人永远取不到真值。）

### 已知局限

见 README「局限」一节。核心一条：**只覆盖能取到真值的断言**，
「文件已经创建好了」这种不带路径的说法抽不到。
