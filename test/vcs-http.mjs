// vcs-http.mjs —— 新增两类 oracle：git 与 HTTP
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { readGitHead, gitIsClean, httpStatus } from '../lib/vcs-http.js';
import { runPlan, validatePlan } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── git_head：构造一个假仓库（.git/HEAD → refs/heads/main）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-git-'));
const sha = crypto.randomBytes(20).toString('hex');
fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'main'), sha + '\n');

check('readGitHead 读出 40 位 sha', readGitHead(dir) === sha, String(readGitHead(dir)));
check('非仓库返回 null', readGitHead(path.join(dir, 'nope')) === null);

const okPlan = await runPlan({ all: [{ prim: 'git_head', args: { dir, sha: sha.slice(0, 12) }, expect: true }] });
check('git_head 前缀匹配 → supported', okPlan.verdict === 'supported', JSON.stringify(okPlan));
const badPlan = await runPlan({ all: [{ prim: 'git_head', args: { dir, sha: 'deadbeefdead' }, expect: true }] });
check('git_head 不匹配 → contradicted', badPlan.verdict === 'contradicted');

// ── git_clean：用注入的 runner 模拟（不依赖本机 git）
check('gitIsClean 注入：干净', gitIsClean(dir, { run: () => '' }) === true);
check('gitIsClean 注入：有改动', gitIsClean(dir, { run: () => ' M a.txt\n' }) === false);
check('gitIsClean 注入：git 不可用 → null', gitIsClean(dir, { run: () => null }) === null);
const cleanUnknown = await runPlan({ all: [{ prim: 'git_clean', args: { dir: path.join(dir, 'nope') }, expect: true }] });
check('git_clean 在非仓库 → insufficient', cleanUnknown.verdict === 'insufficient', JSON.stringify(cleanUnknown));

// ── http_status：起一个本地小服务
const srv = http.createServer((req, res) => {
  if (req.url === '/ok') { res.writeHead(200); res.end('ok'); }
  else { res.writeHead(404); res.end('no'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;

const r200 = await httpStatus(base + '/ok');
check('httpStatus 拿到 200', r200 && r200.status === 200, JSON.stringify(r200));
const r404 = await httpStatus(base + '/missing');
check('httpStatus 拿到 404', r404 && r404.status === 404, JSON.stringify(r404));

const plan200 = await runPlan({ all: [{ prim: 'http_status', args: { url: base + '/ok', status: 200 }, expect: true }] });
check('http_status 声称为 200 → supported', plan200.verdict === 'supported', JSON.stringify(plan200));
const planWrong = await runPlan({ all: [{ prim: 'http_status', args: { url: base + '/ok', status: 500 }, expect: true }] });
check('http_status 声称 500 实际 200 → contradicted', planWrong.verdict === 'contradicted');

check('非 http(s) 协议被拒', validatePlan({ all: [{ prim: 'http_status', args: { url: 'file:///etc/passwd', status: 200 }, expect: true }] }).ok === false);

srv.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
