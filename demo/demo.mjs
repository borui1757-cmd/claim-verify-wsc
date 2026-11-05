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

// ───────────────────────────── 场景 D
hr();
line('场景 D：失败的写入从不落地（原子写 + 撤销）');
hr();
line();

const guarded = path.join(tmp, 'config.txt');
fs.writeFileSync(guarded, 'version=1');
line(`  现状：${path.basename(guarded)} 内容 = version=1`);
await sleep(500);

// 故意写到一个"是目录"的路径，rename 必失败
const badTarget = path.join(tmp, 'is-a-dir');
fs.mkdirSync(badTarget, { recursive: true });
const rD1 = await runPlan({ all: [{ prim: 'write_file', args: { path: badTarget, content: 'boom' }, expect: true }] });
line(`  写入失败的那种情况 → 判定 ${rD1.verdict}`);
line(`  目标目录仍然完好：${fs.statSync(badTarget).isDirectory() ? '是 ✓' : '否 ✗'}`);
line('  临时文件已清理，磁盘上没有半个坏文件。');
await sleep(800);
line();

// 正常覆盖 → 备份 → 撤销
const rD2 = await runPlan({ all: [{ prim: 'write_file', args: { path: guarded, content: 'version=2' }, expect: true }] });
const bak = rD2.results[0]?.meta?.backup;
line(`  覆盖写入 → ${rD2.verdict}，当前内容 = ${fs.readFileSync(guarded, 'utf8')}`);
line(`  写入前已备份：${bak ? '是 ✓' : '否 ✗'}`);
await sleep(600);

if (bak) {
  const rD3 = await runPlan({ all: [{ prim: 'restore_file', args: { path: guarded, backup: bak }, expect: true }] });
  line(`  撤销 → ${rD3.verdict}，内容回到 = ${fs.readFileSync(guarded, 'utf8')}`);
}
line();
line('  结论：对受控原语的动作，坏的写入不会落地；写错了也能一键还原。');
line();
await sleep(700);

hr();
line('演示结束。仓库：https://github.com/borui1757-cmd/claim-verify-wsc');
hr();

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
