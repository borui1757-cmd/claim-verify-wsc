// autolabel.mjs —— 自动标注规则 + kappa 的纯函数测试
import { classifyDetail, collectAutoLabels, cohenKappa } from '../lib/autolabel.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// classifyDetail
check('正常执行结果可自动标', classifyDetail({ stage: 'run', verdict: 'contradicted', reason: '不存在：C:\\a' }).ok === true);
check('见证失败不可自动标', classifyDetail({ stage: 'witness', verdict: 'insufficient' }).ok === false);
check('生成失败不可自动标', classifyDetail({ stage: 'generate', verdict: 'insufficient' }).ok === false);
check('策略拦截不可自动标', classifyDetail({ stage: 'run', verdict: 'insufficient', reason: '策略未放行：write_file=pending' }).ok === false);
check('无法评估不可自动标', classifyDetail({ stage: 'run', verdict: 'insufficient', reason: '有检查无法评估：读不到文件' }).ok === false);
check('insufficient 不可自动标', classifyDetail({ stage: 'run', verdict: 'insufficient', reason: 'x' }).ok === false);

// collectAutoLabels
const rows = [
  { at: 't1', policyHash: 'p1', dsl: { details: [
    { sentence: '我把 A 写了', verdict: 'supported', stage: 'run', reason: '存在：C:\\a', plan: { all: [{ prim: 'exists', args: { path: 'C:\\a' }, expect: true }] } },
    { sentence: '我把 B 写了', verdict: 'insufficient', stage: 'witness', reason: '翻译见证不通过' },
  ] } },
  { at: 't2', policyHash: 'p2', dsl: { details: [
    { sentence: '我把 C 写了', verdict: 'contradicted', stage: 'run', reason: '不存在：C:\\c', plan: { all: [{ prim: 'exists', args: { path: 'C:\\c' }, expect: true }] } },
    { sentence: '我把 A 写了', verdict: 'supported', stage: 'run', reason: '存在：C:\\a', plan: { all: [{ prim: 'exists', args: { path: 'C:\\a' }, expect: true }] } },
  ] } },
];
const got = collectAutoLabels(rows);
check('自动标签 2 条', got.auto.length === 2, JSON.stringify(got.auto.map((r) => r.sentence)));
check('需人工 1 条', got.todo.length === 1 && got.todo[0].why === 'stage-witness');
check('重复样本被去重', got.auto.filter((r) => r.sentence === '我把 A 写了').length === 1);
check('keep 了 policyHash', got.auto.every((r) => typeof r.policyHash === 'string'));

// cohenKappa
const perfect = cohenKappa([{ a: 'supported', b: 'supported' }, { a: 'contradicted', b: 'contradicted' }]);
check('全一致 → kappa=1', perfect.kappa === 1 && perfect.agreement === 1);
const none = cohenKappa([{ a: 'supported', b: 'contradicted' }, { a: 'contradicted', b: 'supported' }]);
check('全不一致 → kappa<0', none.kappa < 0, JSON.stringify(none));
const mixed = cohenKappa([
  { a: 'supported', b: 'supported' }, { a: 'supported', b: 'supported' },
  { a: 'contradicted', b: 'contradicted' }, { a: 'contradicted', b: 'supported' },
]);
check('混合样本 kappa 在 0..1 之间', mixed.kappa > 0 && mixed.kappa < 1, JSON.stringify(mixed));
check('空输入不炸', cohenKappa([]).n === 0);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
