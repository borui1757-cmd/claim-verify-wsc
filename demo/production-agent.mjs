#!/usr/bin/env node
// demo/production-agent.mjs —— 端到端演示：
//   动作 → 核验 → 回执 → 第三方独立验证（含篡改检测）
//
// 用真实磁盘，不依赖模型。跑法：node demo/production-agent.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attest, verifyAttestation, appendAttestation, toProfileReceipt } from '../lib/attest.js';
import { loadOrCreateKeypair } from '../lib/signing.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-demo-'));
const work = path.join(dir, 'work');
fs.mkdirSync(work, { recursive: true });
const kp = loadOrCreateKeypair(dir);

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(72));

line('演示：让 agent 碰生产，每一步都可核对、可举证\n');

// ── 场景 1：写文件，真的成功了 ──
const f1 = path.join(work, 'config.json');
const content1 = '{"mode":"fast","retries":3}';
fs.writeFileSync(f1, content1);
const r1 = attest(
  { claim: { kind: 'write', target: f1 }, facts: { writes: [{ path: f1, isError: false }] } },
  { dir },
);
appendAttestation(dir, r1);

hr();
line('场景 1：写入 config.json（真实成功）');
line(`  磁盘大小：${fs.statSync(f1).size} 字节`);
line(`  判定：${r1.verdict}`);
line(`  回执：${r1.digest.slice(0, 16)}…  链：${r1.chain.slice(0, 12)}…`);

// ── 场景 2：写文件，被静默截断 ──
const f2 = path.join(work, 'report.txt');
const full = 'ALPHA-BRAVO-CHARLIE-DELTA-ECHO-FOXTROT-GOLF-HOTEL-INDIA-JULIET-KILO-LIMA';
fs.writeFileSync(f2, full.slice(0, 36)); // 只写了半截
const r2 = attest(
  {
    claim: { kind: 'write', target: f2 },
    facts: { actual: 36, expected: 72 },
  },
  { dir, prevDigest: r1.chain },
);
appendAttestation(dir, r2);

hr();
line('场景 2：写入 report.txt（被截断：实际 36 / 预期 72）');
line(`  判定：${r2.verdict}（actual 36 ≠ expected 72，直接判不符）`);
line(`  回执：${r2.digest.slice(0, 16)}…  链：${r2.chain.slice(0, 12)}…`);

// ── 场景 3：第三方独立验证 ──
hr();
line('场景 3：第三方独立验证（不信任生成方）');
for (const [name, rec] of [['记录1', r1], ['记录2', r2]]) {
  const v = verifyAttestation(rec, { publicKey: kp.publicKey });
  line(`  ${name}：${v.ok ? '✅ 验签通过、链一致' : `❌ ${v.reasons.join('; ')}`}`);
}

// ── 场景 4：篡改检测 ──
hr();
line('场景 4：篡改一条记录（把 contradicted 改成 supported）');
const tampered = { ...r2, verdict: 'supported' };
const vt = verifyAttestation(tampered, { publicKey: kp.publicKey });
line(`  已验证结果：${vt.ok ? '❌ 没检出（异常）' : `✅ 检出：${vt.reasons[0]}`}`);

// ── 场景 5：IETF 草案风格的 profile receipt ──
hr();
line('场景 5：转成 IETF 草案风格的合规回执');
const prof = toProfileReceipt(r2, { subject: 'agent-demo' });
line(`  receipt_id：${prof.receipt_id.slice(0, 16)}…`);
line(`  action：${prof.action.kind} → ${prof.action.outcome}`);
line(`  limitations：${prof.limitations.length} 条（草案要求声明"不能证明什么"）`);

hr();
line(`\n账本：${path.join(dir, 'attestations.jsonl')}`);
line('结论：每一步都有判定、有签名、可独立验证；篡改会被检出。');
line('这正是"可以碰生产"的许可证——不是更聪明，是可举证。');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
