// accept-task.mjs —— 任务级验收演示：从"断言对"走到"交付成不成"
//
// 场景：要求 agent 生成一份报告并启动服务。
// 验收标准里分三类角色（照抄工业界 Rubric 结构）：
//   acceptance  —— 能阻断交付
//   theory      —— 只记录，不阻断
// 证据由**我们已有的核验器**提供（19 类原语），语义判断由 judge 提供。
//
// 用法：node tools/accept-task.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTask, summarizeTask } from '../lib/rubric.js';
import { extractClaims, verifyClaims } from '../lib/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-accept-'));
const report = path.join(dir, 'report.md');
const CFG = { portTimeoutMs: 300, moneyTolerance: 0.15 };

// ── "agent" 的产出：写了报告，但只写了 2 个章节（不达标） ──
fs.writeFileSync(report, '# 报告\n\n## 1. 背景\n\n## 2. 结论\n');

// ── 验收标准 ──
const rubrics = [
  {
    id: 'a1',
    criterion: '报告文件已生成',
    required_evidence: ['path'],
    weight: 2,
    role: 'acceptance',
  },
  {
    id: 'a2',
    criterion: '报告包含 3 个章节',
    required_evidence: ['path'],
    pass_condition: '至少 3 个二级标题（##）',
    weight: 2,
    role: 'acceptance',
  },
  {
    id: 'a3',
    criterion: '服务在 3210 端口监听',
    required_evidence: ['port'],
    weight: 1,
    role: 'acceptance',
  },
  {
    id: 't1',
    criterion: '说明了所用方法',
    role: 'theory',
    weight: 1,
  },
];

// ── 证据采集：用现有核验器 ──
async function collect(kind, text) {
  const claims = extractClaims(text).filter((c) => c.kind === kind);
  if (!claims.length)
    return { present: false, detail: '未抽到断言' };
  const res = await verifyClaims(claims, 'accept', CFG);
  return { present: true, ok: (res.bad || []).length === 0, claims, bad: res.bad };
}

const evPath = await collect('path', `报告已经写到 \`${report}\` 了。`);
const evPort = await collect('port', '服务现在在 127.0.0.1:3210 上监听。');

const available = [];
if (evPath.ok)
  available.push('path');
// 端口那条：断言失败 → 证据"不成立"，但我们仍然拿到了这次探测（所以证据类型存在）
if (evPort.present)
  available.push('port');

console.log('证据采集：');
console.log('  path=' + (evPath.ok ? '成立' : '不成立') + '  port=' + (evPort.ok ? '成立' : '不成立'));
console.log('  可作为预检依据的证据类型: ' + JSON.stringify(available) + '\n');

// ── 判定器 ──
const judge = (r) => {
  if (r.id === 'a1')
    return evPath.ok ? { ok: true, detail: '文件存在' } : { ok: false, detail: '文件不存在' };
  if (r.id === 'a2') {
    const text = fs.readFileSync(report, 'utf8');
    const n = (text.match(/^##\s/gm) || []).length;
    return { ok: n >= 3, detail: `只有 ${n} 个章节（要求 3）` };
  }
  if (r.id === 'a3')
    return evPort.ok ? { ok: true, detail: '端口在听' } : { ok: false, detail: '端口没有监听' };
  if (r.id === 't1')
    return { ok: false, detail: '报告里没有说明方法' };
  return null;
};

const result = await evaluateTask({ rubrics, available, judge });

console.log('逐条验收：');
for (const r of result.results)
  console.log(`  [${r.role}] ${r.id} ${r.status.padEnd(8)} ${r.detail || ''}`);

console.log('\n最终：' + summarizeTask(result));
if (result.forced.length) {
  console.log('待复核：');
  for (const f of result.forced) console.log('  - ' + f.id + '：' + f.reason);
}
if (result.gaps.length) {
  console.log('学习缺口（不阻断交付）：');
  for (const g of result.gaps) console.log('  - ' + g.id + '：' + g.detail);
}

fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
