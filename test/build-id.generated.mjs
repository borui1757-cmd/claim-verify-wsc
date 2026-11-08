// 自动生成：性质测试（不猜期望值）。模型只选了性质，壳由工厂生成。
import { computeBuildId } from '../lib/build-id.js';

const FNS = { computeBuildId };
const CASES = [
  {
    "fn": "computeBuildId",
    "property": "deterministic",
    "samples": [
      "lib",
      ".",
      "/tmp/project/lib",
      "C:\\project\\lib"
    ]
  }
];

let seed = Number(process.env.SEED || 42);
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const ALPHA = ['/', '\\', '.', '..', 'a', 'B', 'C:', 'x', '0', ' '];
const genStr = () => { let s = ''; const len = 1 + rnd(6); for (let i = 0; i < len; i++) s += ALPHA[rnd(ALPHA.length)]; return s; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const N = 60;

let fail = 0, total = 0, shown = 0;
for (const c of CASES) {
  const f = FNS[c.fn];
  const samples = Array.isArray(c.samples) && c.samples.length ? c.samples : Array.from({ length: N }, genStr);
  for (const s of samples) {
    total += 1;
    let ok = true, detail = '';
    try {
      if (c.property === 'idempotent') { ok = eq(f(f(s)), f(s)); detail = 'f(f(x)) !== f(x)'; }
      else if (c.property === 'deterministic') { ok = eq(f(s), f(s)); detail = 'f(x) 两次不同'; }
      else if (c.property === 'separator_agnostic') { const a = s.replace(/\\/g, '/'), b = s.replace(/\//g, '\\'); ok = eq(f(a), f(b)); detail = 'f(a) 与 f(b) 不一致（仅分隔符不同）'; }
      else if (c.property === 'case_insensitive') { ok = eq(f(s), f(String(s).toUpperCase())); detail = '大小写敏感'; }
    } catch (e) { ok = false; detail = 'threw ' + (e && e.message || e); }
    if (!ok) { fail += 1; if (shown++ < 6) console.error(`✗ ${c.property} ${c.fn}(${JSON.stringify(s)}) — ${detail}`); }
  }
}
console.log(`${total - fail}/${total} 通过`);
process.exit(fail ? 1 : 0);