#!/usr/bin/env node
// coverage-all.mjs —— 三把尺子放一张报告里（2026-11-07）。
//
// 以前这三是散着的，各自看都像"没问题"：
//   ① 声明覆盖率（bin/coverage.mjs）实际动作里有多少被 agent 声明了
//   ② 任务覆盖率（manifest）承诺的清单项里有多少拿到回执（三档：strong/weak/missing）
//   ③ 承诺完备性（completeness）已发生的动作里有多少根本没进清单 ← 分母有没有被低估
//
// 只有 ② 高、③ 也 OK，覆盖率才可信：**覆盖率的分母必须是完备的**。
// 依据 ClaimReceipt (arXiv 2609.01992)："a committed universe against which omissions become visible"。
//
// 用法：
//   node bin/coverage-all.mjs                 # 最近 100 份回执 + 该 session 最新清单
//   node bin/coverage-all.mjs --session=s1
//   node bin/coverage-all.mjs --json          # 一行 JSON，给狗/CI 吃
//
// 退出码：0 覆盖率与完备性都说得过去 / 1 有缺项或有未承诺动作 / 2 没有清单（无法判定）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLatestManifest, computeCoverage, renderCoverage } from '../lib/manifest.js';
import { computeCommitmentCompleteness, renderCompleteness } from '../lib/completeness.js';

const argv = process.argv.slice(2);
const argOf = (n) => {
  const a = argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const sessionId = argOf('session') ?? null;
const asJson = argv.includes('--json');
const wantFail = argv.includes('--fail');

const DIR = path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const RECEIPTS = path.join(DIR, 'receipts.jsonl');
const MANIFESTS = path.join(DIR, 'manifests.jsonl');

const readJsonl = (file, limit = 100) => {
  if (!fs.existsSync(file))
    return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

const receipts = readJsonl(RECEIPTS, 100);
const manifest = loadLatestManifest(MANIFESTS, sessionId);

// ① 声明覆盖率
const withDecl = receipts.filter((r) => r.coverage && Number.isInteger(r.coverage.actual));
let declSum = { actual: 0, matched: 0, undeclared: 0 };
for (const r of withDecl) {
  declSum.actual += r.coverage.actual || 0;
  declSum.matched += r.coverage.matched || 0;
  declSum.undeclared += r.coverage.undeclaredCount || 0;
}
const declRate = declSum.actual ? declSum.matched / declSum.actual : null;

// ② 任务覆盖率 + ③ 承诺完备性
const cov = manifest ? computeCoverage(manifest, receipts) : null;
const cmp = manifest ? computeCommitmentCompleteness(manifest, receipts) : null;

let code = 0;
let verdict = 'OK';
if (!manifest) {
  code = 2;
  verdict = 'NO_MANIFEST';
}
else if (cov.verdict === 'INCONCLUSIVE_COVERAGE') {
  code = 1;
  verdict = 'MISSING_ITEMS';
}
else if (cmp.verdict === 'UNCOMMITTED_ACTIONS') {
  code = 1;
  verdict = 'UNCOMMITTED_ACTIONS';
}
else if (cov.verdict === 'COVERAGE_WEAK') {
  verdict = 'COVERAGE_WEAK';
}
else {
  verdict = 'OK';
}

const status = {
  ok: code === 0,
  verdict,
  exitCode: code,
  at: new Date().toISOString(),
  sessionId,
  receipts: receipts.length,
  declaration: { receiptsWithCoverage: withDecl.length, ...declSum, rate: declRate },
  taskCoverage: cov ? { total: cov.total, covered: cov.covered, strong: cov.strong, weak: cov.weak, missing: cov.missing.length, verdict: cov.verdict } : null,
  commitment: cmp ? { committed: cmp.committed, uncommitted: cmp.uncommitted.length, completeness: cmp.completeness, verdict: cmp.verdict, boundary: cmp.boundary } : null,
};

if (asJson) {
  console.log(JSON.stringify(status));
}
else {
  console.log('覆盖率总览（三个尺子放一起看）');
  console.log(`  目录      ${DIR}`);
  console.log(`  清单      ${manifest ? `${manifest.items.length} 项  digest=${String(manifest.digest).slice(0, 12)}…` : '(没有清单 → 覆盖率无法判定)'}`);
  console.log('');
  if (declRate === null) {
    console.log(`  ① 声明覆盖率  (还没有带 coverage 字段的回执)`);
  }
  else {
    console.log(`  ① 声明覆盖率  ${Math.round(declRate * 100)}%  （实际动作 ${declSum.actual}，被声明 ${declSum.matched}，未声明 ${declSum.undeclared}）`);
  }
  if (cov) {
    console.log(`  ② 任务覆盖率  ${(cov.coverage * 100).toFixed(1)}%  （${cov.covered}/${cov.total}；强 ${cov.strong} / 弱 ${cov.weak} / 缺 ${cov.missing.length}）→ ${cov.verdict}`);
  }
  else {
    console.log('  ② 任务覆盖率  —');
  }
  if (cmp) {
    console.log(`  ③ 承诺完备性  ${(cmp.completeness * 100).toFixed(1)}%  （清单 ${cmp.committed} 项，已发生但未承诺 ${cmp.uncommitted.length} 个）→ ${cmp.verdict}`);
    console.log(`      边界      ${cmp.boundary}`);
  }
  else {
    console.log('  ③ 承诺完备性  —');
  }
  console.log('');
  for (const line of [renderCoverage(cov), renderCompleteness(cmp)]) {
    if (line)
      console.log('  ' + line);
  }
  if (!manifest)
    console.log('  没有清单：先跑 tools/manifest-cli.mjs new --file=plan.json');
  console.log(`\n  结论      ${verdict}（exit ${code}）`);
  if (wantFail && code === 0)
    console.log('  --fail：当前没有缺项，无需过滤');
}

process.exit(code);
