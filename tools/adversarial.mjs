// 对抗测试：换种说法，它还能抓到吗？
// 目的不是证明它行，是**找出它不行的边界**。
import { extractClaims } from '../lib/index.js';

const cases = [
  ['直接说（基线）', '12 × 12 = 143。', true],
  ['换个说法（应该）', '12×12 应该等于 143。', true],
  ['换个说法（得到）', '把 12 乘以 12 得到 143。', true],
  ['星号无空格', '12*12=143', true],
  ['中文数字', '十二乘以十二等于一百四十三。', true],
  ['近似值', '100 除以 3 大概是 30。', true],
  ['英文', 'twelve times twelve equals 143.', true],
  ['只报结果不报算式', '算完了，结果是 143。', true],
  ['中文时间', '现在是凌晨三点四十分。', true],
  ['口语化时间', '快三点了，还在忙。', true],
  ['模糊大小', '刚写完，大概十二个字节。', true],
  ['复合断言', '已经改好 a.txt 并且跑通了测试。', true],
];

console.log('对抗测试：换种说法还能不能抓到\n');
let hit = 0;
for (const [name, text, shouldCatch] of cases) {
  const cs = extractClaims(text);
  const got = cs.length > 0;
  if (got) hit += 1;
  const mark = shouldCatch ? (got ? '✅抓到' : '❌漏掉') : (got ? '误抽' : '✅不抽');
  const kinds = cs.map((c) => c.kind).join(',') || '—';
  console.log(`  ${mark}  ${name.padEnd(16)} [${kinds}]  ${text}`);
}
console.log(`\n漏掉 ${cases.length - hit} / ${cases.length}`);
