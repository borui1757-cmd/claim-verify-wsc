// bank.mjs —— 预算银行：流水 / 风控 / 授信 / 余额
//
// 银行为什么能省你的钱？不是因为它会赚钱，是因为它**记账 + 风控 + 授信**。
// 我们早就有账本（dsh-bill/records.jsonl，14000+ 条），只是没人看。
//
// 行业省钱的两个核心（AWS semantic cache 实测 -86%、前缀缓存 1/30 价）都指向同一件事：
// **重复**。所以风控的核心是抓"重复支付"——冷启动就是最典型的一种。
//
// 用法：
//   node tools/bank.mjs                 # 今日流水 + 预算状态
//   node tools/bank.mjs --days 7        # 近 N 天
//   node tools/bank.mjs --risk          # 风控异常清单
//   node tools/bank.mjs --session <id>  # 单会话账单
//   node tools/bank.mjs --json          # 机器可读
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'C:/Users/19156/.dsh/dsh-bill';
const RECORDS = path.join(DIR, 'records.jsonl');
const CONFIG = new URL('./bank-config.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CNY = 7.2;

// 默认授信：日预算 20 元、80% 预警
const DEFAULT_CFG = { dailyBudgetCny: 20, alertAt: 0.8, bigCallCny: 0.4, coldStartInput: 100000, coldStartRatio: 0.1 };
let cfg = DEFAULT_CFG;
try {
  if (fs.existsSync(CONFIG))
    cfg = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
  else
    fs.writeFileSync(CONFIG, JSON.stringify(DEFAULT_CFG, null, 2), 'utf8');
}
catch { cfg = DEFAULT_CFG; }

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

if (!fs.existsSync(RECORDS)) {
  console.log('没有账本：' + RECORDS);
  process.exit(0);
}

const rows = fs.readFileSync(RECORDS, 'utf8').trim().split('\n').map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const now = Date.now();
const days = Number(argOf('--days', 0));
const startArg = argOf('--start', null);
// 口径说明（2026-11-07 对齐）：
//   本工具默认按**本地零点**结算（日历日）。
//   内置的 bill_stats 是按**宿主进程启动**结算（本次运行以来）——两者都没有错，
//   只是窗口不同，所以数字对不上。要复现 bill_stats 的口径：--start <宿主启动时间>。
let since;
if (startArg) {
  since = /^\d+$/.test(startArg) ? Number(startArg) : new Date(startArg).getTime();
}
else if (days) {
  since = now - days * 86400_000;
}
else {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  since = d.getTime();
}
const scope = rows.filter((r) => r.time >= since);

const cny = (usd) => (usd * CNY);
const fmt = (usd) => '¥' + cny(usd || 0).toFixed(2);

// ── 风控规则 ──
function risks(list) {
  const out = [];
  for (const r of list) {
    const cr = r.cacheReadTokens || 0;
    const inp = r.inputTokens || 0;
    const ratio = cr / Math.max(1, cr + inp);
    // ① 冷启动：大输入 + 几乎没命中缓存 = 重复支付整段前缀
    if (inp >= cfg.coldStartInput && ratio < cfg.coldStartRatio) {
      out.push({ kind: 'cold-start', at: r.time, session: r.sessionId, value: r.usd, detail: `输入 ${inp} token，命中仅 ${(ratio * 100).toFixed(1)}%` });
    }
    // ② 大额单条
    else if (cny(r.usd || 0) >= cfg.bigCallCny) {
      out.push({ kind: 'big-call', at: r.time, session: r.sessionId, value: r.usd, detail: `单条 ${fmt(r.usd)}（阈值 ¥${cfg.bigCallCny}）` });
    }
  }
  // ③ 连续重启：30 分钟内出现 ≥2 次冷启动
  const cold = out.filter((x) => x.kind === 'cold-start').sort((a, b) => a.at - b.at);
  for (let i = 1; i < cold.length; i++) {
    if (cold[i].at - cold[i - 1].at <= 30 * 60_000) {
      out.push({ kind: 'restart-storm', at: cold[i].at, session: cold[i].session, value: cold[i].value + cold[i - 1].value, detail: '30 分钟内连续冷启动（= 连续重启）' });
    }
  }
  return out;
}

// ── 输出 ──
const total = scope.reduce((s, r) => s + (r.usd || 0), 0);
const bySess = new Map();
for (const r of scope) {
  const k = String(r.sessionId || '?').slice(-12);
  bySess.set(k, (bySess.get(k) || 0) + (r.usd || 0));
}
const budget = cfg.dailyBudgetCny;
const usedCny = days ? null : cny(total);
const pct = days ? null : Math.min(100, (usedCny / budget) * 100);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ totalUsd: total, totalCny: cny(total), calls: scope.length, risks: risks(scope), budget, usedCny, pct }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--risk')) {
  const rs = risks(scope);
  console.log(`风控扫描（${scope.length} 条调用，${days ? days + ' 天' : '今天'}）\n`);
  if (!rs.length) { console.log('  ✅ 没有异常'); process.exit(0); }
  const byKind = {};
  for (const r of rs) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log('  分类: ' + JSON.stringify(byKind) + '\n');
  const coldTotal = rs.filter((r) => r.kind === 'cold-start').reduce((s, r) => s + r.value, 0);
  console.log(`  冷启动合计损失: ${fmt(coldTotal)}（${rs.filter((r) => r.kind === 'cold-start').length} 次）\n`);
  for (const r of rs.slice(-12)) {
    console.log(`  [${r.kind}] ${new Date(r.at).toLocaleString('zh-CN')} ${fmt(r.value)}  ${r.detail}`);
  }
  if (rs.length > 12) console.log(`  …还有 ${rs.length - 12} 条`);
  process.exit(0);
}

const sessArg = argOf('--session', null);
if (sessArg) {
  const mine = scope.filter((r) => String(r.sessionId || '').includes(sessArg));
  const t = mine.reduce((s, r) => s + (r.usd || 0), 0);
  console.log(`会话 ${sessArg}：${mine.length} 次调用，${fmt(t)}`);
  const colds = mine.filter((r) => (r.inputTokens || 0) >= cfg.coldStartInput && (r.cacheReadTokens || 0) / Math.max(1, (r.cacheReadTokens || 0) + (r.inputTokens || 0)) < cfg.coldStartRatio);
  console.log(`  其中冷启动 ${colds.length} 次，占 ${fmt(colds.reduce((s, r) => s + (r.usd || 0), 0))}`);
  process.exit(0);
}

// 默认：流水 + 余额
console.log(`预算银行（窗口：${new Date(since).toLocaleString('zh-CN')} → 现在）\n`);
console.log('  调用数: ' + scope.length);
console.log('  花费:   ' + fmt(total) + '   ≈ $' + total.toFixed(4));
if (!days) {
  console.log(`  预算:   ¥${budget}  已用 ${pct.toFixed(1)}%  ${pct >= cfg.alertAt * 100 ? '⚠ 接近上限' : '✅'}`);
  if (pct >= 100) console.log('  🚫 已超预算：建议切换更便宜的模型或暂停长任务');
}
const rs = risks(scope);
const coldLoss = rs.filter((r) => r.kind === 'cold-start').reduce((s, r) => s + r.value, 0);
console.log(`  风控:   ${rs.length} 条异常，其中冷启动损失 ${fmt(coldLoss)}`);
console.log('\n  按会话（Top 5）:');
for (const [k, v] of [...bySess.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5))
  console.log(`    ${k}  ${fmt(v)}`);
console.log('\n  提示: --risk 看异常明细 · --session <id> 看单会话 · --days 7 看一周');
