// feedback.mjs —— 回写反馈的措辞与强度
import { feedbackForResult, buildFeedback, shouldBlock } from '../lib/feedback.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const bad = { verdict: 'contradicted', target: 'C:\\a.txt', reason: '对 C:\\a.txt 的写入失败' };
const weak = { verdict: 'insufficient', target: 'C:\\b.txt', reason: '轨迹里没有对 C:\\b.txt 的写入' };
const ok = { verdict: 'supported', target: 'C:\\c.txt', reason: '成功写入' };

check('成立的不产生反馈', feedbackForResult(ok) === null);
check('soft 含事实不含责令', /与执行证据不符/.test(feedbackForResult(bad, 'soft')) && !/必须修正/.test(feedbackForResult(bad, 'soft')));
check('firm 明确要求改正', /必须修正/.test(feedbackForResult(bad, 'firm')) && /不要声称已完成/.test(feedbackForResult(bad, 'firm')));
check('soft 不提示 insufficient', feedbackForResult(weak, 'soft') === null);
check('firm 提示证据不足', /证据不足/.test(feedbackForResult(weak, 'firm') || ''));
check('空输入不炸', feedbackForResult(null) === null && feedbackForResult({}) === null);

const merged = buildFeedback([bad, ok, weak], 'firm');
check('批量只保留需要回写的', typeof merged === 'string' && merged.includes('C:\\a.txt') && !merged.includes('C:\\c.txt'));
check('没有需要回写的 → null', buildFeedback([ok], 'firm') === null);

check('block 档在未通过时阻断', shouldBlock([bad], 'block') === true);
check('firm 档不阻断', shouldBlock([bad], 'firm') === false);
check('只有 supported 时不阻断', shouldBlock([ok], 'block') === false);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
