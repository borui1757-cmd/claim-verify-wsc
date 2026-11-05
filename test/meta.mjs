// meta.mjs —— 元声明核验（"我查过了 / 已验证 / 测试通过"）
import { detectMetaClaims, decideClaims, extractEvidence } from '../lib/isolated-audit.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 抽取
check('识别「我查过了」', detectMetaClaims('我查过了端口状态。').length === 1);
check('识别「已验证」', detectMetaClaims('配置已验证，服务正常。').length === 1);
check('识别「测试通过」', detectMetaClaims('所有测试通过。').length === 1);
check('不识别普通陈述', detectMetaClaims('我把文件写到了 C:\\a.txt。').length === 0);
check('引述不算', detectMetaClaims('你说「我查过了」这件事。').length === 0);
check('假设句不算', detectMetaClaims('如果你查过了就可以继续。').length === 0);
check('短句不算', detectMetaClaims('查过。').length === 0);

// 判定：无动作 → contradicted
const evNone = { writes: [], cmds: [] };
const r1 = decideClaims([{ kind: 'meta_verify', sentence: '我查过了' }], evNone);
check('无核验动作 → contradicted', r1[0].verdict === 'contradicted', JSON.stringify(r1[0]));
check('理由点明"没有任何执行动作"', r1[0].reason.includes('没有任何执行动作'), r1[0].reason);

// 判定：只有失败动作 → contradicted
const evFail = { writes: [], cmds: [{ cmd: 'curl x', isError: true }] };
const r2 = decideClaims([{ kind: 'meta_verify', sentence: '我查过了' }], evFail);
check('核验动作全部失败 → contradicted', r2[0].verdict === 'contradicted', JSON.stringify(r2[0]));

// 判定：有成功动作 → supported
const evOk = { writes: [], cmds: [{ cmd: 'netstat -ano' }] };
const r3 = decideClaims([{ kind: 'meta_verify', sentence: '我查过了' }], evOk);
check('有成功执行 → supported', r3[0].verdict === 'supported', JSON.stringify(r3[0]));

// 端到端：报告里说"我查过了"，但轨迹空 → contradicted
const ev = extractEvidence([]);
const r4 = decideClaims(detectMetaClaims('我查过了，端口没问题。'), ev);
check('端到端：无动作被证伪', r4[0].verdict === 'contradicted', JSON.stringify(r4[0]));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
