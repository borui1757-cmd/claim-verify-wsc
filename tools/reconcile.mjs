// reconcile.mjs —— 和 provider 官方账单对账（账本准不准）
//
// 为什么必须对账：本地账本是**按价目表自己算的**，官方是按实际计费扣的。
// 两者可能因为①价目表过时 ②错峰折扣没算 ③失败调用是否计费 ④币种口径 而系统性偏离。
// 不对账就不知道差多少——银行没有对账就是假账。
//
// 做法（没有官方 usage API 时的标准手段）：**余额法**
//   记下余额快照 → 隔一段时间再记 → 余额差 = 官方实际花费
//   与本地账本同期总和比较 → 得出偏差率
//
// 用法：
//   node tools/reconcile.mjs --snapshot     # 记一次余额快照
//   node tools/reconcile.mjs --report       # 用最近两次快照算偏差
//
// key 来源（按顺序，绝不打印）：
//   ① 环境变量 DEEPSEEK_API_KEY
//   ② 文件 tools/.deepseek-key（一行，只有 key）
import fs from 'node:fs';
import path from 'node:path';

const HIST = new URL('./balance-history.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KEYFILE = new URL('./.deepseek-key', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RECORDS = 'C:/Users/19156/.dsh/dsh-bill/records.jsonl';
const CNY = 7.2;

function readKey() {
  const env = process.env.DEEPSEEK_API_KEY;
  if (env && env.trim())
    return env.trim();
  try {
    const k = fs.readFileSync(KEYFILE, 'utf8').trim();
    if (k)
      return k;
  }
  catch { /* 没有文件 */ }
  return null;
}

const key = readKey();

if (process.argv.includes('--snapshot')) {
  if (!key) {
    console.log('没有可用的 key。把 DeepSeek API key 写到：');
    console.log('  ' + KEYFILE);
    console.log('（一行，只有 key；该文件不会被提交）');
    process.exit(1);
  }
  const r = await fetch('https://api.deepseek.com/user/balance', {
    headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
  });
  const txt = await r.text();
  if (!r.ok) {
    console.log('余额查询失败 HTTP ' + r.status + '：' + txt.slice(0, 200));
    process.exit(1);
  }
  const j = JSON.parse(txt);
  const snap = {
    at: Date.now(),
    available: j.is_available,
    balances: j.balance_infos || [],
  };
  const total = (snap.balances || []).reduce((s, b) => s + Number(b.total_balance || 0), 0);
  fs.appendFileSync(HIST, JSON.stringify(snap) + '\n', 'utf8');
  console.log('已记录余额快照：' + total.toFixed(2) + ' ' + ((snap.balances[0] && snap.balances[0].currency) || ''));
  process.exit(0);
}

// 报告：最近两次快照的差额 vs 本地账本
const snaps = fs.existsSync(HIST)
  ? fs.readFileSync(HIST, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

if (snaps.length < 2) {
  console.log('至少需要两次余额快照才能对账（当前 ' + snaps.length + ' 次）。');
  console.log('先跑：node tools/reconcile.mjs --snapshot');
  process.exit(0);
}

const a = snaps[snaps.length - 2];
const b = snaps[snaps.length - 1];
const balOf = (s) => (s.balances || []).reduce((x, y) => x + Number(y.total_balance || 0), 0);
const officialSpentCny = balOf(a) - balOf(b);

const rows = fs.readFileSync(RECORDS, 'utf8').trim().split('\n').map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean).filter((r) => r.time >= a.at && r.time <= b.at);
const ledgerUsd = rows.reduce((s, r) => s + (r.usd || 0), 0);
const ledgerCny = ledgerUsd * CNY;

const pct = officialSpentCny ? ((ledgerCny - officialSpentCny) / officialSpentCny * 100) : 0;

console.log('对账报告（余额法）\n');
console.log('  区间: ' + new Date(a.at).toLocaleString('zh-CN') + ' → ' + new Date(b.at).toLocaleString('zh-CN'));
console.log('  官方扣费: ¥' + officialSpentCny.toFixed(3));
console.log('  本地账本: ¥' + ledgerCny.toFixed(3) + '（' + rows.length + ' 次调用）');
console.log('  偏差:     ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%  ' + (Math.abs(pct) < 5 ? '✅ 一致' : (pct > 0 ? '⚠ 账本高估' : '⚠ 账本低估')));
