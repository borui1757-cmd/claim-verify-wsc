// 第 3 步：把核验记录导出成 PRM/RL 可用的 per-step reward 格式。
//
// 优先读 `steps.jsonl`（插件从 0.8.1 起逐条记录，**含正样本 +1**）；
// 没有再退回 `hits.jsonl`（只记不一致，会导致全负、没法做 PRM）。
//
// 依据：
//  - PRM800K 三态：+1 正确 / 0 中性 / -1 错误（另有 null = 未标注）
//  - ARC (NeurIPS 2026)：每步要有「预测」与「被观测证伪/证实」的成对结构
//  - awesome-evals「Verifiable reward / RL-environment rubric」：同一份产物既是评测也是训练奖励
//
// 输出：tools/prm-export.jsonl
//
// 用法：node tools/to-prm.mjs [steps.jsonl 或 hits.jsonl]
import fs from 'node:fs';

const DEFAULT_STEPS = 'C:/Users/19156/.dsh/dsh-claim-verify/steps.jsonl';
const DEFAULT_HITS = 'C:/Users/19156/.dsh/dsh-claim-verify/hits.jsonl';
const IN = process.argv[2] || (fs.existsSync(DEFAULT_STEPS) ? DEFAULT_STEPS : DEFAULT_HITS);
const OUT = new URL('./prm-export.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (!fs.existsSync(IN)) { console.log('找不到输入:', IN); process.exit(1); }

const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
const out = [];
let n = 0;

for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (!e || !e.at) continue;
  n += 1;

  // 形态 A：steps.jsonl（逐条断言，已自带 reward）
  if (typeof e.reward === 'number') {
    out.push({
      step_id: `${String(e.sessionId || 'unknown')}#${n}`,
      session: String(e.sessionId || 'unknown'),
      at: e.at,
      kind: e.kind,
      prediction: String(e.prediction ?? JSON.stringify(e.value)),
      observation: String(e.observation || ''),
      reward: e.reward,
      source: e.reward === 1 ? 'supported' : e.reward === -1 ? 'contradicted' : 'neutral',
    });
    continue;
  }

  // 形态 B：hits.jsonl（只记不一致，正样本靠 checked-bad 近似）
  const sid = String(e.sessionId || 'unknown');
  const bad = Array.isArray(e.bad) ? e.bad : [];
  const text = String(e.text || '');
  const checked = Number(e.checked || 0);
  let idx = 0;
  for (const b of bad) {
    idx += 1;
    out.push({
      step_id: `${sid}#${n}.${idx}`,
      session: sid,
      at: e.at,
      kind: b.kind,
      prediction: JSON.stringify(b.claim),
      observation: String(b.expect || ''),
      reward: -1,
      source: 'contradicted',
    });
  }
  const passed = Math.max(0, checked - bad.length);
  for (let i = 0; i < Math.min(passed, 5); i++) {
    idx += 1;
    out.push({
      step_id: `${sid}#${n}.p${idx}`,
      session: sid,
      at: e.at,
      kind: 'aggregate',
      prediction: text.slice(0, 80),
      observation: '与系统真值一致',
      reward: 1,
      source: 'supported',
    });
  }
}

fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

const byReward = {};
for (const r of out) byReward[r.reward] = (byReward[r.reward] || 0) + 1;
console.log('导出 ' + out.length + ' 条 per-step reward → ' + OUT);
console.log('  reward 分布: ' + JSON.stringify(byReward) + '   （+1 正确 / 0 中性 / -1 错误 / null 未标注）');
console.log('  涉及会话 ' + new Set(out.map((r) => r.session)).size + ' 个');
process.exit(0);
