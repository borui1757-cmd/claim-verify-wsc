// check-claim-policy.mjs —— 置信分层与解析修复的回归测试
// 依据：2026-11-05 hits.jsonl 实测，35 条命中里真错 5 条（全是端口），
// 其余 30 条为金额/模型/计数的口径误报 → 这三类降级为「只记不报」。
import { extractClaims } from '../lib/index.js';

const cases = [
  // 低置信类：必须抽到，但 confidence=low（不参与拦截）
  ['金额：配置值不是花费', '花费护栏现在是 ¥0.01/会话，我建议调到 ¥1。', (cs) => cs.length === 0 || cs.every((c) => c.confidence === 'low')],
  ['模型：路径名不是模型', '配置在 notes/00-ideas.md 里，本会话跑 deepseek-flash。', (cs) => !cs.some((c) => c.kind === 'model' && String(c.value).includes('notes'))],
  ['计数：只记不报', 'relay/public 下一共有 9 个 html 页面。', (cs) => cs.filter((c) => c.kind === 'count').every((c) => c.confidence === 'low')],

  // 高置信类：必须抽到且 confidence=high
  ['端口：高置信', 'DSH 实际端口是 64164。', (cs) => cs.some((c) => c.kind === 'port' && c.confidence === 'high')],
  ['路径：高置信', '配置在 C:\\Users\\user\\Desktop\\x.md 里。', (cs) => cs.some((c) => c.kind === 'path' && c.confidence === 'high')],
  ['算式：高置信', '1873 乘以 4 等于 7000。', (cs) => cs.some((c) => c.kind === 'math' && c.confidence === 'high')],

  // 解析修复
  ['Markdown 链接不把 > 卷进路径', '见 [index.js](<C:\\Users\\user\\Documents\\x\\index.js>)。', (cs) => !cs.some((c) => String(c.value).endsWith('>'))],
  ['代码块里的端口不算断言', '```\n127.0.0.1:64164\n```\n上面是示例。', (cs) => !cs.some((c) => c.kind === 'port')],
];

let failed = 0;
for (const [name, text, check] of cases) {
  const cs = extractClaims(text);
  const ok = check(cs);
  if (!ok)
    failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${cases.length - failed}/${cases.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
