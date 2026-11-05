// dry.mjs —— 不联网、不打模型的核验自测：抽词 → 核验 → 拼接，全部用注入的假真值。
// 用法：node test/dry.mjs      （退出码 0 = 全过）

import { extractClaims, verifyClaims, buildNote } from '../lib/index.js';

const cfg = { portTimeoutMs: 50, moneyTolerance: 0.3, annotate: true };

// 假真值：和 2026-11-05 现场一致
const deps = {
  probePort: async (port) => [3080, 8700, 8800, 5099, 3100].includes(port),
  pathExists: (p) => p.toLowerCase().startsWith('c:\\users\\user\\desktop') && !p.toLowerCase().includes('nope'),
  lastSessionModel: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
  todaySpendUsd: () => 0.0757,
  dshPort: () => 3080,
  nowMs: Date.parse('2026-11-05T06:05:00+08:00'),
  countHtmlPages: () => 7,
  countButtons: () => 3,
};

const cases = [
  {
    name: '端口说错（DSH 实际 3080，说成 64164）',
    text: 'DSH 实际端口是 64164，桥接已经指过去了。',
    wantBad: 1,
  },
  {
    name: '模型说错（本会话 deepseek-flash，说成 zhipu/glm-4-flash）',
    text: '本会话我跑在 zhipu/glm-4-flash 上，所以回答不太行。',
    wantBad: 1,
  },
  {
    name: '金额说错（今天 $0.0757，说成 $0.58）',
    text: '今天累计花了 $0.58，比昨天贵。',
    wantBad: 1,
  },
  {
    name: '路径不存在',
    text: '配置文件在 C:\\Users\\user\\Desktop\\nope.md 里。',
    wantBad: 1,
  },
  {
    name: '全对（不该误伤）',
    text: 'DSH 实际端口是 3080，本会话跑 deepseek-flash，配置在 C:\\Users\\user\\Desktop 下。',
    wantBad: 0,
  },
  {
    name: '举例/假设（不该误伤）',
    text: '比如 127.0.0.1:9999 这种地址，或者端口 8080 的写法，都算常见。',
    wantBad: 0,
  },
  {
    name: 'URL 里的端口（不该误伤）',
    text: '登录链接是 https://www.trae.cn/authorization?auth_callback_url=http%3A%2F%2F127.0.0.1%3A18080%2Fauthorize ，点开即可。',
    wantBad: 0,
  },
  {
    name: '否定式（18080 本机没服务在监听，不该误伤）',
    text: '正常现象：回调地址 `127.0.0.1:18080` 本机没有服务在监听，所以浏览器只会显示无法访问。',
    wantBad: 0,
  },
  {
    name: '否定式说错（3080 明明在监听，说成没有）',
    text: '127.0.0.1:3080 上没有任何服务在监听。',
    wantBad: 1,
  },
  {
    name: '路径否定式（说不存在，确实不存在，不该误伤）',
    text: '备份在 C:\\Users\\user\\Desktop\\nope 这个目录，不存在。',
    wantBad: 0,
  },
  {
    name: '目录名当模型（不该误伤）',
    text: '本轮改动都在 plugins/dsh-claim-verify 里，本会话跑 deepseek-flash。',
    wantBad: 0,
  },
  {
    name: '配置值不是花费（不该误伤）',
    text: '花费护栏现在是 ¥0.01/会话，我建议调到 ¥1。',
    wantBad: 0,
  },
  {
    name: '时间说错（现在 06:05，说成 05:30）',
    text: '现在时间是 05:30，我刚看完日志。',
    wantBad: 1,
  },
  {
    name: '星期说错（今天周四，说成星期三）',
    text: '今天是星期三，机器人在线。',
    wantBad: 1,
  },
  {
    name: '页面数说错（实际 7 个，说成 9 个）',
    text: 'relay/public 下一共有 9 个 html 页面。',
    wantBad: 1,
  },
  {
    name: '算式说错（1873×4=7492，说成 7000）',
    text: '1873 乘以 4 等于 7000。',
    wantBad: 1,
  },
];

let failed = 0;
for (const c of cases) {
  const claims = extractClaims(c.text);
  const result = await verifyClaims(claims, 'session-test', cfg, deps);
  const note = buildNote(result);
  const ok = result.bad.length === c.wantBad;
  if (!ok)
    failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  [claims=${claims.length} bad=${result.bad.length} want=${c.wantBad}]`);
  if (note)
    console.log(note.split('\n').map((l) => '      ' + l).join('\n'));
}

console.log(`\n${cases.length - failed}/${cases.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
