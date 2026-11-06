// 第 3 步：把核验记录导出成 PRM/RL 可用的 per-step reward 格式。
//
// 依据：
//  - PRM800K 三态：+1 正确 / 0 中性 / -1 错误（另有 null = 未标注）
//  - ARC (NeurIPS 2026)：每步要有「预测」与「被观测证伪/证实」的成对结构
//  - awesome-evals「Verifiable reward / RL-environment rubric」：同一份产物既是评测也是训练奖励
//
// 输出：tools/prm-export.jsonl
// 每行：{step_id, session, at, prediction, observation, reward, kind}
//
// 用法：node tools/to-prm.mjs [hits.jsonl]
import fs from 'node:fs';

const IN = process.argv[2] || 'C:/Users/19156/.dsh/dsh-claim-verify/hits.jsonl';
const OUT = new URL('./prm-export.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (!fs.existsSync(IN)) { console.log('找不到输入:', IN); process.exit(1); }

const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
const out = [];
let n = 0;

for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (!e || !e.at) continue;
  const sid = String(e.sessionId || 'unknown');
  const bad = Array.isArray(e.bad) ? e.bad : [];
  const badKeys = new Set(bad.map((b) => b.kind + '|' + JSON.stringify(b.claim)));
  const text = String(e.text || '');

  n += 1;
  // 一条记录 = 一个"步"：把该步出现的每条断言变成一条 reward
  // ✅ 被判不一致 → -1（预测被环境证伪）
  // ✅ 被核对且通过 → +1；没有核对到（checked 计数不含它）→ 无法确定，记 null
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
  // 通过项：hits.jsonl 只记录"不一致"，通过数 = checked - bad.length
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
