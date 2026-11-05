// offline-claims.mjs —— 离线加宽抽取（三类：写入/命令/存在）
import { extractOfflineClaims } from '../lib/offline-claims.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const pairs = [
  { name: 'write', callId: 'w1', args: { file_path: 'C:\\a\\ok.txt' }, isError: false, resultSeen: true },
  { name: 'write', callId: 'w2', args: { file_path: 'C:\\a\\bad.txt' }, isError: true, resultSeen: true },
  { name: 'mcp__cgp__cgp_exec', callId: 'c1', args: { cmd: 'npm test' }, isError: false, resultSeen: true },
  { name: 'pwsh', callId: 'c2', args: { command: 'node build.js' }, isError: true, resultSeen: true },
];

const report = [
  '我已经写入了 C:\\a\\ok.txt 这个文件',
  '我写了 C:\\a\\bad.txt',
  '我跑了 npm test',
  '执行了 node build.js',
  'C:\\a\\ok.txt 存在',
  'C:\\a\\unknown.txt 存在',
  '这个方案更好',
].join('\n');

const got = extractOfflineClaims(report, pairs);
const find = (kw) => got.find((g) => g.sentence.includes(kw));

check('成功写入 → supported', find('ok.txt 这个文件')?.verdict === 'supported', JSON.stringify(find('ok.txt 这个文件')));
check('失败写入 → contradicted', find('bad.txt')?.verdict === 'contradicted');
check('成功命令 → supported', find('npm test')?.verdict === 'supported');
check('失败命令 → contradicted', find('node build.js')?.verdict === 'contradicted');
check('存在类：有成功写入 → supported', find('ok.txt 存在')?.verdict === 'supported');
check('存在类：没证据 → 跳过', find('unknown.txt') === undefined);
check('主观句不产生标签', find('方案更好') === undefined);
check('带 callId', got.every((g) => typeof g.callId === 'string'));

const dedup = extractOfflineClaims('我写了 C:\\a\\ok.txt\n我写了 C:\\a\\ok.txt', pairs);
check('同句去重', dedup.length === 1);

const none = extractOfflineClaims('我写了 C:\\zzz\\no.txt', pairs);
check('轨迹里没有的动作 → 不产生标签', none.length === 0);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
