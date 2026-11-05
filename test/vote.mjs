// vote.mjs —— 三票制：规则票 + 模型票，≥2 票一致才保留 contradicted
import { findModelVerdict, voteOnContradicted } from '../lib/vote.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  ${e}`); } };

const rule = (sentence, verdict, evidence = '规则证据') => ({ sentence, kind: 'test_pass', verdict, evidence, confidence: 1 });

// 1. 模型也判 contradicted → 保留，票数 2
let r = voteOnContradicted(
  [rule('测试全部通过', 'contradicted')],
  [{ sentence: '测试全部通过', verdict: 'contradicted', reason: '命令失败' }],
);
check('两票一致 → 保留 contradicted', r.results[0].verdict === 'contradicted' && r.confirmed === 1);
check('保留的条目带 votes=2', r.results[0].votes === 2);

// 2. 模型判 insufficient → 降级
r = voteOnContradicted(
  [rule('测试全部通过', 'contradicted')],
  [{ sentence: '测试全部通过', verdict: 'insufficient', reason: '记录未提' }],
);
check('模型不同判 → 降级 uncertain', r.results[0].verdict === 'uncertain' && r.downgraded === 1);
check('降级理由说明模型判了什么', r.results[0].evidence.includes('insufficient'), r.results[0].evidence);

// 3. 模型漏答 → 降级
r = voteOnContradicted([rule('测试全部通过', 'contradicted')], []);
check('模型漏答 → 降级', r.results[0].verdict === 'uncertain' && r.results[0].evidence.includes('漏答'));

// 4. supported / uncertain 不参与表决，原样保留
r = voteOnContradicted([rule('测试全部通过', 'supported'), rule('已重启', 'uncertain')], []);
check('非 contradicted 原样保留', r.results[0].verdict === 'supported' && r.results[1].verdict === 'uncertain');

// 5. 句子规范化匹配（模型句子带 markdown 差异也能对上）
r = voteOnContradicted(
  [rule('**测试全部通过**，用例都绿了', 'contradicted')],
  [{ sentence: '测试全部通过，用例都绿了', verdict: 'contradicted' }],
);
check('规范化后能匹配', r.results[0].verdict === 'contradicted');

// 6. findModelVerdict 空输入安全
check('空句子返回 null', findModelVerdict('', [{ sentence: 'x', verdict: 'contradicted' }]) === null);
check('空数组返回 null', findModelVerdict('abc', null) === null);

// 7. 多条混合
r = voteOnContradicted(
  [rule('A 测试通过', 'contradicted'), rule('B 已写入', 'contradicted'), rule('C 正常', 'supported')],
  [{ sentence: 'A 测试通过', verdict: 'contradicted' }],
);
check('混合：1 保留 1 降级 1 保留原判', r.confirmed === 1 && r.downgraded === 1 && r.results[2].verdict === 'supported');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
