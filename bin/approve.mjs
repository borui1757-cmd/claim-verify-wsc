#!/usr/bin/env node
// 审批 CLI：处理策略判为 pending 的计划（两阶段执行的第一阶段产物）。
//
// 用法：
//   node bin/approve.mjs --list                 # 看有哪些待批
//   node bin/approve.mjs --apply <planDigest>   # 批准并执行
//   node bin/approve.mjs --reject <planDigest>  # 拒绝（留痕）
//
// 说明：pending 的计划只是"被记下来"，**没有执行**；只有 --apply 才会真正跑。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runPlan } from '../lib/dsl.js';
import { canonicalJson } from '../lib/policy.js';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const pendingFile = path.join(dir, 'pending-plans.jsonl');
const approvalsFile = path.join(dir, 'approvals.jsonl');

const readJsonl = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  catch { return []; }
};
const append = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + '\n');

const digestOf = (plan) => crypto.createHash('sha256').update(canonicalJson(plan)).digest('hex');

if (args.includes('--list')) {
  const rows = readJsonl(pendingFile).filter((r) => r.status === 'pending');
  if (!rows.length) {
    console.log('没有待批的计划。');
    process.exit(0);
  }
  for (const r of rows) {
    console.log(`[${r.digest.slice(0, 12)}]  ${r.at}  ${r.policyHash.slice(0, 10)}  ${JSON.stringify(r.plan).slice(0, 120)}`);
  }
  console.log(`\n共 ${rows.length} 条待批。批准：node bin/approve.mjs --apply <digest前12位>`);
  process.exit(0);
}

const applyDigest = argOf('apply');
const rejectDigest = argOf('reject');
if (!applyDigest && !rejectDigest) {
  console.error('用法：--list | --apply <digest> | --reject <digest>');
  process.exit(2);
}

const rows = readJsonl(pendingFile);
const idx = rows.findIndex((r) => r.status === 'pending' && r.digest.startsWith(applyDigest || rejectDigest));
if (idx < 0) {
  console.error('找不到匹配的待批计划');
  process.exit(1);
}
const rec = rows[idx];

if (rejectDigest) {
  rec.status = 'rejected';
  rec.decidedAt = new Date().toISOString();
  fs.writeFileSync(pendingFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  append(approvalsFile, { at: rec.decidedAt, digest: rec.digest, decision: 'rejected' });
  console.log('已拒绝（未执行）：' + rec.digest.slice(0, 12));
  process.exit(0);
}

// 批准并执行：用全放行策略跑一次（审批本身已是这道闸门）
const result = await runPlan(rec.plan, { policy: { default: 'allow', rules: {} } });
rec.status = 'approved';
rec.decidedAt = new Date().toISOString();
rec.result = { verdict: result.verdict, reason: String(result.reason || '').slice(0, 300) };
fs.writeFileSync(pendingFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
append(approvalsFile, {
  at: rec.decidedAt,
  digest: rec.digest,
  decision: 'approved',
  verdict: result.verdict,
  reason: rec.result.reason,
  results: (result.results || []).map((r) => ({ prim: r.prim, actual: r.actual, detail: r.detail })),
});
console.log(`已批准并执行：${result.verdict} —— ${rec.result.reason}`);
process.exit(0);
