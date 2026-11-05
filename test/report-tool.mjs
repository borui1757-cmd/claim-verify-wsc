// report-tool.mjs —— report_claims 工具的离线测试
import { makeReportClaimsTool } from '../lib/report-tool.js';

const pairs = [
  { name: 'write', callId: 'w1', turn: 1, args: { file_path: 'C:\\tmp\\a.txt' }, isError: false, resultSeen: true, text: 'ok' },
  { name: 'pwsh', callId: 'c1', turn: 1, args: { command: 'npm test' }, isError: true, resultSeen: true, text: 'FAIL' },
];
const tool = makeReportClaimsTool({ getPairs: () => pairs });

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('工具名是 report_claims', tool.name === 'report_claims');
check('参数 schema 里有 claims', Boolean(tool.parameters && tool.parameters.properties && tool.parameters.properties.claims));
check('kind 是枚举且含 write/cmd', Array.isArray(tool.parameters.properties.claims.items.properties.kind.enum)
  && tool.parameters.properties.claims.items.properties.kind.enum.includes('write')
  && tool.parameters.properties.claims.items.properties.kind.enum.includes('cmd'));

const exec = { agent: { session: { id: 's1' } } };
const out = await tool.execute({
  claims: [
    { kind: 'write', target: 'C:\\tmp\\a.txt' },
    { kind: 'cmd', target: 'npm test' },
    { kind: 'write', target: 'C:\\tmp\\never.txt' },
  ],
}, exec);

check('返回 summary', out && out.summary && out.summary.total === 3, JSON.stringify(out && out.summary));
check('1 支持 / 1 反驳 / 1 无证据', out.summary.supported === 1 && out.summary.contradicted === 1 && out.summary.insufficient === 1);
check('results 带 verdict 与 target', out.results.every((r) => ['supported', 'contradicted', 'insufficient'].includes(r.verdict) && typeof r.target === 'string'));
check('反驳项带证据工具名', out.results.find((r) => r.verdict === 'contradicted')?.evidenceTool === 'pwsh');

const outSchema = tool.output && tool.output.schema;
check('output schema 里有 summary/results', Boolean(outSchema && outSchema.properties && outSchema.properties.summary && outSchema.properties.results));

// 非 write/cmd 的种类 → 一律 insufficient（第一期不瞎判）
const out2 = await tool.execute({ claims: [{ kind: 'port', target: '3080' }] }, exec);
check('port 类 → insufficient', out2.summary.insufficient === 1);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
