// manifest-cli.mjs —— 任务清单工具：开工前登记，收工时核覆盖率
//
// 用法：
//   node tools/manifest-cli.mjs new --session=s1 --title="发版" --file=plan.json
//   node tools/manifest-cli.mjs check --session=s1
//
// plan.json 形如：
//   [{"desc":"生成报告","claim":{"kind":"path","value":"C:/out/report.md"}},
//    {"desc":"端口在听","claim":{"kind":"port","value":"3080"}}]
import fs from 'node:fs';
import path from 'node:path';
import { createManifest, saveManifest, loadLatestManifest, computeCoverage, renderCoverage } from '../lib/manifest.js';

const HOME = process.env.USERPROFILE || '';
const DIR = path.join(HOME, '.dsh', 'dsh-claim-verify');
const MANIFESTS = path.join(DIR, 'manifests.jsonl');
const RECEIPTS = path.join(DIR, 'receipts.jsonl');

const arg = (n, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=').slice(1).join('=') : d;
};

const cmd = process.argv[2];
const sessionId = arg('session', null);

if (cmd === 'new') {
  const file = arg('file', null);
  if (!file || !fs.existsSync(file)) {
    console.error('需要一个 --file=plan.json');
    process.exit(2);
  }
  // 容忍 UTF-8 BOM（PowerShell 的 Set-Content 会加）
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const items = JSON.parse(raw);
  const m = createManifest({ sessionId, title: arg('title', ''), items });
  saveManifest(MANIFESTS, m);
  console.log(`已登记清单：${m.items.length} 项  digest=${m.digest.slice(0, 16)}…`);
  for (const it of m.items)
    console.log(`  - ${it.id}  ${it.desc}${it.claim ? '  [' + it.claim.kind + ']' : ''}`);
}
else if (cmd === 'check') {
  const m = loadLatestManifest(MANIFESTS, sessionId);
  if (!m) {
    console.error('没有找到清单（先跑 new）');
    process.exit(2);
  }
  const receipts = [];
  if (fs.existsSync(RECEIPTS)) {
    for (const l of fs.readFileSync(RECEIPTS, 'utf8').trim().split('\n').filter(Boolean).slice(-100)) {
      try { receipts.push(JSON.parse(l)); }
      catch { /* 跳过 */ }
    }
  }
  const cov = computeCoverage(m, receipts);
  console.log(`清单：${m.title || '(无标题)'}  digest=${m.digest.slice(0, 16)}…`);
  console.log(`覆盖率：${cov.covered}/${cov.total} = ${(cov.coverage * 100).toFixed(1)}%`);
  console.log(`判定：${cov.verdict}`);
  if (cov.missing.length) {
    console.log('缺项：');
    for (const x of cov.missing) console.log(`  - ${x.id}  ${x.desc}`);
  }
  const line = renderCoverage(cov);
  if (line) console.log('\n' + line);
}
else {
  console.log('用法：node tools/manifest-cli.mjs <new|check> --session=s1 [--title=..] [--file=plan.json]');
  process.exit(2);
}
