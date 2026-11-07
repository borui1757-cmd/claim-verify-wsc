import fs from 'node:fs';

const t = fs.readFileSync('lib/index.js', 'utf8');
const hooks = [...t.matchAll(/ctx\.on\(\s*['"]([\w/-]+)['"]/g)].map((m) => m[1]);
console.log('注册的钩子:', JSON.stringify(hooks));
const tryCount = (t.match(/try\s*\{/g) || []).length;
const catchCount = (t.match(/catch\s*[({]/g) || []).length;
console.log('try 次数:', tryCount, 'catch 次数:', catchCount);

// 粗查：每个 ctx.on 之后 600 字符内是否有 try
for (const m of t.matchAll(/ctx\.on\(\s*['"]([\w/-]+)['"]/g)) {
  const after = t.slice(m.index, m.index + 600);
  console.log(`  ${m[1]}: 附近有 try = ${/try\s*\{/.test(after)}`);
}
