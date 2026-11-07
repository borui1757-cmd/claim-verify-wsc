// gold.mjs —— 金集评测：每条用例的**真值由构造决定**（不靠模型、不靠当下系统状态），
// 因此能同时算出 precision 和 recall。dry.mjs 只验「该不该报」，这里算「报得准不准、漏了多少」。
//
// 用法：node eval/gold.mjs

import { extractClaims, verifyClaims, buildNote } from '../lib/index.js';

const cfg = { portTimeoutMs: 50, moneyTolerance: 0.3, annotate: true };

// 冻结真值：模拟 2026-11-05 07:00 的机器状态
const deps = {
  probePort: async (port) => [3080, 8700, 8800, 5099, 3100].includes(port),
  pathExists: (p) => {
    const v = p.toLowerCase();
    if (v.includes('nope'))
      return false;
    return v.startsWith('c:\\users\\user\\desktop') || v === 'c:\\users\\user\\.dsh';
  },
  lastSessionModel: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
  todaySpendUsd: () => 0.0757,
  dshPort: () => 3080,
  nowMs: Date.parse('2026-11-05T06:05:00+08:00'),
  countHtmlPages: () => 7,
  countButtons: () => 3,
  pidExists: (p) => p === 71144,
  countLines: (p) => (p.toLowerCase().includes('dsh-web.log') ? 65 : 150),
  fileSize: (p) => (p.toLowerCase().includes('dsh-web.log') ? 20480 : 1000),
  fileHash: () => 'a1b2c3d4e5f60718',
  pkgVersion: (n) => (n === 'dsh-claim-verify' ? '0.1.3' : null),
  availableMem: () => 12 * 1024 ** 3,
  diskFree: (d) => (d === 'C:' ? 500 * 1024 ** 3 : null),
  serviceState: (n) => (n === 'Spooler' ? { found: true, text: 'RUNNING' } : n === 'EventLog' ? { found: true, text: 'STOPPED' } : { found: false }),
  registryValue: (k, n) => (n === 'Start' ? { found: true, type: 'REG_DWORD', data: '0x2' } : { found: false }),
  taskState: (n) => (n.includes('ScheduledDefrag') ? { found: true, text: '就绪' } : { found: false }),
};

// wrong = 这条文本里**客观为假**的断言条数（由构造决定）
const cases = [
  { name: '端口说错', text: 'DSH 实际端口是 64164。', wrong: 1 },
  { name: '端口说对', text: 'DSH 实际端口是 3080。', wrong: 0 },
  { name: '端口（否定式，真）', text: '127.0.0.1:18080 本机没有服务在监听。', wrong: 0 },
  { name: '端口（否定式，假）', text: '127.0.0.1:3080 上没有任何服务在监听。', wrong: 1 },
  { name: 'URL 里的端口（不是断言）', text: '回调是 http://127.0.0.1:18080/authorize?token=1 ，复制整条给我。', wrong: 0 },
  { name: '路径说错', text: '配置在 C:\\Users\\user\\Desktop\\nope.md 里。', wrong: 1 },
  { name: '路径说对', text: '配置在 C:\\Users\\user\\Desktop\\dsh-web.log 里。', wrong: 0 },
  { name: '路径（否定式，真）', text: 'C:\\Users\\user\\Desktop\\nope.md 这个文件不存在。', wrong: 0 },
  { name: '路径（否定式，假）', text: 'C:\\Users\\user\\Desktop\\dsh-web.log 这个文件不存在。', wrong: 1 },
  { name: '路径带 Markdown 尖括号', text: '读 [index.js](C:\\Users\\user\\Desktop\\dsh-web.log) 就行。', wrong: 0 },
  { name: '模型说错', text: '本会话我跑在 zhipu/glm-4-flash 上。', wrong: 1 },
  { name: '模型说对', text: '本会话我跑在 deepseek-account/deepseek-flash 上。', wrong: 0 },
  { name: '目录名（不是模型）', text: '改动都在 plugins/dsh-claim-verify 里。', wrong: 0 },
  { name: '模板词（不是模型）', text: '配置写 provider/model 这种形式即可。', wrong: 0 },
  { name: '金额说错', text: '今天累计花了 $0.58。', wrong: 1 },
  { name: '金额说对', text: '今天累计花了 $0.0757。', wrong: 0 },
  { name: '配置值（不是花费）', text: '花费护栏现在是 ¥0.01/会话。', wrong: 0 },
  { name: '时间说错', text: '现在时间是 05:30。', wrong: 1 },
  { name: '时间说对', text: '现在时间是 06:05。', wrong: 0 },
  { name: '星期说错', text: '今天是星期三。', wrong: 1 },
  { name: '页面数说错', text: 'relay/public 下一共有 9 个 html 页面。', wrong: 1 },
  { name: '算式说错', text: '1873 乘以 4 等于 7000。', wrong: 1 },
  { name: '算式说对', text: '1873 乘以 4 等于 7492。', wrong: 0 },
  { name: '举例（不是断言）', text: '比如 127.0.0.1:9999 这种地址很常见。', wrong: 0 },
  { name: '否定作用域：不在工作区 ≠ 不存在', text: '要改的 package.json 在 `C:\\Users\\user\\.dsh` 下，不在工作区里，必须提权。', wrong: 0 },
  { name: '列表序号祈使句（不是断言）', text: '1. 启动 MuMu 12 → `adb connect 127.0.0.1:16384`', wrong: 0 },
  { name: '附加疑问句 吧（不是断言）', text: '你说的“现在的链接”是 `127.0.0.1:59203` 这个页面吧', wrong: 0 },
  { name: '附加疑问句 吗（不是断言）', text: 'DSH 端口是 64164 吗', wrong: 0 },
  { name: '陈述「还在呢」不能被当问句', text: '端口 3080 还在呢，桥接也指着它。', wrong: 0 },
  { name: '中文引号不卷进路径', text: '对路径“C:\\Users\\user\\Desktop\\dsh-web.log”的访问被拒绝。', wrong: 0 },
  { name: '端口否定：adbd 没运行起来', text: '安卓系统只在后台半启动，adbd 根本没有运行起来，因此 `adb connect localhost:5555` 永远返回 offline。', wrong: 0 },
  { name: '端口否定：不通', text: 'config.dsh.baseUrl = 127.0.0.1:56545 → 不通', wrong: 0 },
  { name: '元文本（引用原句讨论语法）', text: '刚才那句原话是 `127.0.0.1:59203` 这个页面吧，句尾是语气词。', wrong: 0 },
  { name: '假设（不是断言）', text: '如果端口是 64164，那就说明配错了。', wrong: 0 },
  { name: '问句（不是断言）', text: '你说的端口 64164 是哪个服务？', wrong: 0 },
  { name: '进程 PID 在（对）', text: '宿主 PID 71144 还在跑。', wrong: 0 },
  { name: '进程 PID 说成在跑（错）', text: '宿主 PID 99999 还在跑。', wrong: 1 },
  { name: '文件行数（对）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 一共 65 行。', wrong: 0 },
  { name: '文件行数（错）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 一共 200 行。', wrong: 1 },
  { name: '文件大小（对）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 大小 20 KB。', wrong: 0 },
  { name: '文件大小（错）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 大小 99 KB。', wrong: 1 },
  { name: '文件哈希（对）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 的 sha256 前 8 位是 a1b2c3d4。', wrong: 0 },
  { name: '文件哈希（错）', text: '`C:\\Users\\user\\Desktop\\dsh-web.log` 的 sha256 前 8 位是 deadbeef。', wrong: 1 },
  { name: '依赖版本 name@semver（对）', text: 'profile 里装的是 `dsh-claim-verify@0.1.3`，bundles 里也挂了。', wrong: 0 },
  { name: '依赖版本 name@semver（错）', text: 'profile 里装的是 `dsh-claim-verify@0.0.9`，bundles 里也挂了。', wrong: 1 },
  { name: '依赖版本 版本是 X（对）', text: '`dsh-claim-verify` 的版本是 0.1.3。', wrong: 0 },
  { name: '内存余量（对）', text: '可用内存 12 GB，够跑。', wrong: 0 },
  { name: '内存余量（错）', text: '可用内存 3 GB，够跑。', wrong: 1 },
  { name: '磁盘余量（对）', text: 'C 盘剩余 500 GB，装得下。', wrong: 0 },
  { name: '磁盘余量（错）', text: 'C 盘剩余 12 GB，装得下。', wrong: 1 },
  { name: '服务在运行（对）', text: '服务 Spooler 正在运行。', wrong: 0 },
  { name: '服务说在运行（错）', text: '服务 EventLog 正在运行。', wrong: 1 },
  { name: '服务已停止（对）', text: '服务 EventLog 已经停止，不用管。', wrong: 0 },
  { name: '注册表值（对）', text: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler 的 Start 是 2。', wrong: 0 },
  { name: '注册表值（错）', text: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler 的 Start 是 4。', wrong: 1 },
  { name: '计划任务就绪（对）', text: '计划任务 Microsoft\\Windows\\Defrag\\ScheduledDefrag 状态是就绪。', wrong: 0 },
  { name: '计划任务（错）', text: '计划任务 Microsoft\\Windows\\Defrag\\Nope 状态是就绪。', wrong: 1 },
];

let tp = 0, fp = 0, fn = 0, tn = 0;
let tpAll = 0, fpAll = 0, fnAll = 0;
const rows = [];
for (const c of cases) {
  const claims = extractClaims(c.text);
  const result = await verifyClaims(claims, 'session-gold', cfg, deps);
  const flagged = result.bad.filter((b) => !b.soft).length;
  const flaggedAll = result.bad.length;
  const t = Math.min(flagged, c.wrong);
  const f = Math.max(0, flagged - c.wrong);
  const m = Math.max(0, c.wrong - flagged);
  tp += t; fp += f; fn += m;
  tpAll += Math.min(flaggedAll, c.wrong);
  fpAll += Math.max(0, flaggedAll - c.wrong);
  fnAll += Math.max(0, c.wrong - flaggedAll);
  if (c.wrong === 0 && flagged === 0) tn += 1;
  const ok = f === 0 && m === 0;
  rows.push({ ok, name: c.name, flagged, flaggedAll, wrong: c.wrong, note: buildNote(result) });
}

for (const r of rows) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.name}  [报=${r.flagged} 全判=${r.flaggedAll} 假=${r.wrong}]`);
  if (!r.ok && r.note) console.log(r.note.split('\n').map((l) => '      ' + l).join('\n'));
}

const P = tp + fp ? tp / (tp + fp) : 1;
const R = tp + fn ? tp / (tp + fn) : 1;
const PAll = tpAll + fpAll ? tpAll / (tpAll + fpAll) : 1;
const RAll = tpAll + fnAll ? tpAll / (tpAll + fnAll) : 1;
console.log(`\n用例 ${cases.length}：通过 ${rows.filter((r) => r.ok).length}，失败 ${rows.filter((r) => !r.ok).length}`);
console.log(`【对用户可见的报告】TP=${tp} FP=${fp} FN=${fn}  precision=${P.toFixed(3)}  recall=${R.toFixed(3)}`);
console.log(`【含只记日志的低置信类】TP=${tpAll} FP=${fpAll} FN=${fnAll}  precision=${PAll.toFixed(3)}  recall=${RAll.toFixed(3)}`);
process.exit(fp === 0 ? 0 : 1);
