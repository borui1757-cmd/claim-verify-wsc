// hint.mjs —— 可复核提示（把核验结论变成模型能自己验证的观测）
import { reproduceHint, feedbackForResult, buildFeedback } from '../lib/feedback.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const isWin = process.platform === 'win32';

// 路径存在性
const h1 = reproduceHint('path', { path: 'C:\\a\\b.txt' }, true);
check('path 给出命令', Boolean(h1) && h1.includes('b.txt'), String(h1));
check('path 期望值正确', /期望输出\s*(True|False)/.test(h1 || ''));
check('path 命令形态符合平台', isWin ? /Test-Path/.test(h1) : /test -e/.test(h1), String(h1));

// 端口
const h2 = reproduceHint('port', { host: '127.0.0.1', port: 3080 }, true);
check('port 给出命令', Boolean(h2) && h2.includes('3080'), String(h2));

// 计数
const h3 = reproduceHint('dir_count', { dir: 'C:\\tmp', count: 3 }, true);
check('dir_count 给出命令', Boolean(h3) && /3/.test(h3), String(h3));

// 未知原语 → null（不乱给）
check('未知原语返回 null', reproduceHint('weird', {}, true) === null);

// 反馈文本里带 hint
const fb = feedbackForResult({ verdict: 'contradicted', target: '已写入 a.txt', reason: '文件不存在', hint: h1 }, 'firm');
check('反馈包含复核提示', fb.includes('你可以自己复核'), fb.slice(0, 120));
check('反馈保留原因', fb.includes('文件不存在'));
const fbNo = feedbackForResult({ verdict: 'contradicted', target: 'x', reason: 'y' }, 'firm');
check('无 hint 时不多写', !fbNo.includes('复核'));

// 批量：两条都有 hint
const batch = buildFeedback([
  { verdict: 'contradicted', target: 'a', reason: 'r1', hint: h1 },
  { verdict: 'contradicted', target: 'b', reason: 'r2', hint: h2 },
], 'soft');
check('批量包含两条复核', (batch.match(/你可以自己复核/g) || []).length === 2);

// 账本提示（外部世界模型）
const fbl = feedbackForResult({ verdict: 'contradicted', target: 'a', reason: 'r', ledgerNote: '10 分钟前成立，现在不成立' }, 'soft');
check('反馈带账本提示', fbl.includes('10 分钟前成立'));

// supported 不产生反馈
check('supported 无反馈', feedbackForResult({ verdict: 'supported', target: 'x' }, 'firm') === null);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
