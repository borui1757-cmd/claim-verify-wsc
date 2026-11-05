#!/usr/bin/env node
// 演示脚本：三个场景，一次跑完。用于录屏。
//
//   node demo/demo.mjs
//
// 场景 A：静默失败 —— 工具说成功，系统说没有
// 场景 B：回执 —— 可被第三方验证；改一个字节立刻失败
// 场景 C：弃权 —— 没有客观证据时输出 insufficient

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPlan } from '../lib/dsl.js';
import { verifySentence } from '../lib/claim-dsl.js';
import { makeEnvelope, verifyRecord, chainDigest } from '../lib/envelope.js';
import { aivsFields, verifyAivsChain } from '../lib/aivs.js';

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

line();
line('  claim-verify-wsc  ·  核验智能体的完成声明');
line('  不给答案打分，去问真值。');
line();

// ───────────────────────────── 场景 A
hr();
line('场景 A：工具说成功，系统说没有');
hr();
line();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-demo-'));
const target = path.join(tmp, 'out.txt');

// 模拟"静默失败"：调用返回 ok，但没真正落盘
const evidence = {
  writes: [{ path: target, ok: true, textFailed: false }],
  cmds: [],
};
line(`  代理声称：  「我已经写入了 ${target}」`);
line('  工具返回：  ok（8 字节）');
await sleep(600);
line();
line('  但目标路径上什么都没有。核验器只看真实文件：');
const r1 = await runPlan(
  { all: [{ prim: 'exists', args: { path: target }, expect: true }] },
  {},
);
line(`  → 判定：${r1.verdict}`);
line(`  → 依据：${r1.results[0].detail}`);
await sleep(900);
line();
line('  于是回写给模型：');
line('  【核验】目标文件不存在（写入未落到目标位置）');
line('  不要声称该操作已完成；先修正或重试。');
line();
await sleep(900);

// 真正写入后，同一句声称就成立了
fs.writeFileSync(target, 'alpha-01');
const r2 = await runPlan({ all: [{ prim: 'exists', args: { path: target }, expect: true }] }, {});
line(`  重试后真实落盘，再核验 → ${r2.verdict}`);
line();
await sleep(900);

// ───────────────────────────── 场景 B
hr();
line('场景 B：回执可被第三方验证（不需要信任我们）');
hr();
line();

const priv = crypto.generateKeyPairSync('ed25519');
const privPem = priv.privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = priv.publicKey.export({ type: 'spki', format: 'pem' });
const base = {
  at: new Date().toISOString(),
  claims: [{ text: `我已经写入了 ${path.basename(target)}`, verdict: 'supported' }],
  digest: crypto.createHash('sha256').update(String(Date.now())).digest('hex'),
};
const signedBody = { ...base, prevDigest: '', chain: chainDigest('', base.digest) };
signedBody.aivs = aivsFields({ rowId: 1, sessionId: 'demo', timestamp: Date.now() / 1000, prevHash: '' });
const envelope = makeEnvelope(signedBody, { privateKey: privPem, publicKey: pubPem });
const record = { ...signedBody, envelope };

line('  回执已生成：');
line(`    digest  = ${signedBody.digest.slice(0, 24)}…`);
line(`    sig     = ${String(record.envelope?.signatures?.[0]?.sig || '').slice(0, 24)}…`);
line(`    row_hash= ${record.aivs.row_hash.slice(0, 24)}…`);
await sleep(800);
line();

const ok1 = verifyRecord(record, pubPem);
line(`  用公钥离线验签： ${ok1.ok ? '通过 ✓' : '失败 ✗'}`);
const chain1 = verifyAivsChain([record]);
line(`  校验 AIVS 链：   ${chain1.ok ? '完整 ✓' : '断开 ✗'}`);
await sleep(800);
line();

line('  现在改动回执里的一个字段（把 supported 改成 contradicted）：');
const tampered = JSON.parse(JSON.stringify(record));
tampered.claims[0].verdict = 'contradicted';
const ok2 = verifyRecord(tampered, pubPem);
line(`  再验签： ${ok2.ok ? '通过（不应该）' : '失败 ✗ —— 篡改被检出'}`);
line();
await sleep(900);

// ───────────────────────────── 场景 C
hr();
line('场景 C：没有客观证据时，弃权而不是乱判');
hr();
line();

const sentence = '系统已经优化，整体性能提升明显。';
line(`  声明：「${sentence}」`);
await sleep(600);
line('  这句话没有任何可核验的对象（文件？端口？进程？都没有）。');
line();

// 不调模型，直接看规则层的判断
const r3 = await verifySentence(sentence, { transport: async () => '{"unsupported":"主观评价，无客观真值"}' });
line(`  → 判定：${r3.verdict}`);
line(`  → 原因：${r3.reason || '无法形式化'}`);
line();
line('  这就是设计：宁可说「不知道」，也不给一个听起来合理的结论。');
line();
await sleep(600);

hr();
line('演示结束。仓库：https://github.com/borui1757-cmd/claim-verify-wsc');
hr();

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
