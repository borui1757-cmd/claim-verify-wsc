// isolated-audit.mjs —— 报告隔离审计（声明只看报告、证据只看轨迹、判定不看模型）
import { buildClaimPrompt, parseClaimsFromText, extractEvidence, decideClaims, auditIsolated } from '../lib/isolated-audit.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 提示词不含轨迹
const prompt = buildClaimPrompt('我写入了 C:\\a.txt，测试通过');
check('提示词里有报告', /C:\\\\a\.txt/.test(prompt) || prompt.includes('C:\\a.txt'));
check('提示词里没有轨迹字段', !/isError|callId|tool\/result/.test(prompt));

check('解析 JSON 数组', parseClaimsFromText('[{"sentence":"a","kind":"write","target":"C:\\\\a"}]').length === 1);
check('非 JSON 返回空', parseClaimsFromText('没有').length === 0);
check('kind 非法回落 cmd', parseClaimsFromText('[{"sentence":"x","kind":"wat"}]')[0].kind === 'cmd');

const pairs = [
  { name: 'write', callId: 'w1', args: { file_path: 'C:\\a\\ok.txt' }, isError: false, resultSeen: true, text: 'ok' },
  { name: 'write', callId: 'w2', args: { file_path: 'C:\\a\\bad.txt' }, isError: true, resultSeen: true, text: 'EACCES' },
  { name: 'pwsh', callId: 'c1', args: { command: 'npm test' }, isError: true, resultSeen: true, text: 'FAIL 2 tests' },
  { name: 'pwsh', callId: 'c2', args: { command: 'node build.js' }, isError: false, resultSeen: true, text: 'done' },
];
const ev = extractEvidence(pairs);
check('证据只含写/命令', ev.writes.length === 2 && ev.cmds.length === 2);
check('证据不含报告内容', !JSON.stringify(ev).includes('声称'));

const decided = decideClaims([
  { sentence: '我写了 ok', kind: 'write', target: 'C:/a/OK.txt' },
  { sentence: '我写了 bad', kind: 'write', target: 'C:\\a\\bad.txt' },
  { sentence: '我写了 never', kind: 'write', target: 'C:\\a\\never.txt' },
  { sentence: '测试通过', kind: 'test', target: null },
  { sentence: '我跑了 build', kind: 'cmd', target: 'node build.js' },
  { sentence: '我跑了 deploy', kind: 'cmd', target: 'deploy.sh' },
], ev);

const bySent = (kw) => decided.find((d) => d.sentence.includes(kw));
check('成功写入 → supported', bySent('ok')?.verdict === 'supported');
check('失败写入 → contradicted', bySent('bad')?.verdict === 'contradicted');
check('没写过的 → insufficient', bySent('never')?.verdict === 'insufficient');
check('测试全失败 → contradicted', bySent('测试')?.verdict === 'contradicted');
check('成功命令 → supported', bySent('build')?.verdict === 'supported');
check('没跑过的命令 → insufficient', bySent('deploy')?.verdict === 'insufficient');

// 端到端：假 transport 只返回声明
const fake = async () => '[{"sentence":"我把报告写好了","kind":"write","target":"C:\\\\a\\\\bad.txt"}]';
const r = await auditIsolated('报告正文（不含轨迹）', pairs, { transport: fake });
check('端到端产出 1 条判定', r.results.length === 1 && r.results[0].verdict === 'contradicted', JSON.stringify(r).slice(0, 160));
check('端到端带计数', r.counts && r.counts.contradicted === 1);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
