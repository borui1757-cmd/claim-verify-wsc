// dsl.js —— 「自然语言断言 → 受限检查表达式」的 DSL：定义、校验、执行。
//
// 设计原则（为什么这样做）：
//  1. 模型只负责"翻译"，不负责"判断"——翻译成下面这些**只读原语**，再由程序执行，精度仍在程序侧。
//  2. 白名单 + 严格 schema：出现未知原语、多余字段、越界参数，一律拒绝，不执行。
//  3. 全部只读：不写文件、不删东西、不执行任意命令（cmd 历史查询只读已有记录，不重跑）。
//
// 一条断言 = 若干检查的合取：
//   { all: [ { prim: 'port', args: { port: 8700 }, expect: true }, ... ] }
// 结果：supported（全部命中）/ contradicted（有检查与预期相反）/ insufficient（无法评估）

import fs from 'node:fs';
import { exitCodeAttributable } from './exit-attr.js';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkPlan } from './policy.js';
import { pidAlive } from './platform/index.js';
import { isAbsPath } from './paths.js';
import { readGitHead, gitIsClean, httpStatus } from './vcs-http.js';

const MAX_CHECKS = 6;
const MAX_TEXT = 200;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function probePort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}

/** 只允许四则运算与括号的表达式求值（不 eval）。 */
export function safeMath(expr) {
  const s = String(expr).replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(s))
    throw new Error('表达式含非法字符');
  // 简易递归下降
  let i = 0;
  const peek = () => s[i];
  function number() {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i]))
      i += 1;
    if (start === i)
      throw new Error('缺少数字');
    return Number(s.slice(start, i));
  }
  function factor() {
    if (peek() === '(') {
      i += 1;
      const v = expr0();
      if (peek() !== ')')
        throw new Error('括号不匹配');
      i += 1;
      return v;
    }
    if (peek() === '-')
      { i += 1; return -factor(); }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i];
      i += 1;
      const b = factor();
      v = op === '*' ? v * b : v / b;
    }
    return v;
  }
  function expr0() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i];
      i += 1;
      const b = term();
      v = op === '+' ? v + b : v - b;
    }
    return v;
  }
  const value = expr0();
  if (i !== s.length)
    throw new Error('表达式尾部多余字符');
  return value;
}

/** 原语表：名字 → { params: {名: 校验}, run }。run 返回 { value, detail }。 */
export const PRIMS = {
  port: {
    transient: true,
    params: {
      port: (v) => Number.isInteger(v) && v >= 1 && v <= 65535,
    },
    async run({ port }) {
      const open = await probePort(port);
      return { value: open, detail: open ? `127.0.0.1:${port} 在监听` : `127.0.0.1:${port} 没有监听` };
    },
  },
  exists: {
    params: {
      path: (v) => isAbsPath(v),
    },
    async run({ path }) {
      const ok = fs.existsSync(path);
      return { value: ok, detail: ok ? `存在：${path}` : `不存在：${path}` };
    },
  },
  file_contains: {
    params: {
      path: (v) => isAbsPath(v),
      text: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT,
    },
    async run({ path, text }) {
      let content = '';
      try {
        const st = fs.statSync(path);
        if (st.size > 2 * 1024 * 1024)
          return { value: null, detail: '文件过大，跳过' };
        content = fs.readFileSync(path, 'utf8');
      }
      catch {
        return { value: null, detail: `读不到文件：${path}` };
      }
      const ok = content.includes(text);
      return { value: ok, detail: ok ? `文件里包含「${text}」` : `文件里没有「${text}」` };
    },
  },
  proc_alive: {
    transient: true,
    params: {
      pid: (v) => Number.isInteger(v) && v > 0,
    },
    async run({ pid }) {
      const alive = pidAlive(pid);
      if (alive === null)
        return { value: null, detail: `无法判断 PID ${pid}（平台或权限限制）` };
      return { value: alive, detail: alive ? `PID ${pid} 存在` : `PID ${pid} 不存在` };
    },
  },
  math_eq: {
    params: {
      expr: (v) => typeof v === 'string' && v.length <= 120,
      value: (v) => typeof v === 'number' && Number.isFinite(v),
    },
    async run({ expr, value }) {
      const v = safeMath(expr);
      return { value: Math.abs(v - value) < 1e-9, detail: `${expr} = ${v}（声称 ${value}）` };
    },
  },
  reachable: {
    transient: true,
    params: {
      host: (v) => typeof v === 'string' && /^(?:127\.0\.0\.1|localhost)$/.test(v),
      port: (v) => Number.isInteger(v) && v >= 1 && v <= 65535,
    },
    async run({ host, port }) {
      // 只允许本机：越界主机会被参数校验挡掉
      const open = await probePort(port);
      return { value: open, detail: open ? `${host}:${port} 可以连上` : `${host}:${port} 连不上` };
    },
  },
  git_head: {
    transient: false,
    params: {
      dir: (v) => isAbsPath(v),
      sha: (v) => typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v),
    },
    async run({ dir, sha }) {
      const head = readGitHead(dir);
      if (head === null)
        return { value: null, detail: `读不到 ${dir}/.git/HEAD` };
      const want = String(sha).toLowerCase();
      return { value: head.startsWith(want), detail: `HEAD=${head.slice(0, 12)}…（声称 ${want.slice(0, 12)}）` };
    },
  },
  git_clean: {
    transient: true,
    params: {
      dir: (v) => isAbsPath(v),
    },
    async run({ dir }) {
      const clean = gitIsClean(dir);
      if (clean === null)
        return { value: null, detail: 'git 不可用或该目录不是仓库' };
      return { value: clean, detail: clean ? '工作区干净' : '工作区有未提交改动' };
    },
  },
  http_status: {
    transient: true,
    params: {
      url: (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 500,
      status: (v) => Number.isInteger(v) && v >= 100 && v <= 599,
    },
    async run({ url, status }) {
      const r = await httpStatus(url);
      if (r === null)
        return { value: null, detail: `请求 ${url} 失败或超时` };
      return { value: r.status === status, detail: `${url} 返回 ${r.status}（声称 ${status}）` };
    },
  },
  trace_write_ok: {
    transient: false,
    params: {
      path: (v) => isAbsPath(v),
    },
    async run({ path: target, __evidence }) {
      const ev = __evidence;
      if (!ev || !Array.isArray(ev.writes))
        return { value: null, detail: '没有轨迹证据可查' };
      const norm = (p) => String(p || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
      const hit = ev.writes.filter((w) => norm(w.path) === norm(target));
      if (!hit.length)
        return { value: false, detail: `本轮没有写入 ${target} 的记录` };
      const ok = hit.some((w) => !(w.isError || w.textFailed === true));
      return { value: ok, detail: `轨迹里有 ${hit.length} 次写入 ${target}，${ok ? '有成功' : '全部失败'}` };
    },
  },
  trace_cmd_ok: {
    transient: false,
    params: {
      cmd: (v) => typeof v === 'string' && v.length > 0 && v.length <= 500,
    },
    async run({ cmd, __evidence }) {
      const ev = __evidence;
      if (!ev || !Array.isArray(ev.cmds))
        return { value: null, detail: '没有轨迹证据可查' };
      const target = String(cmd).trim();
      const hit = ev.cmds.filter((c) => {
        const c2 = String(c.cmd || '').trim();
        return c2 === target || c2.includes(target.slice(0, 40));
      });
      if (!hit.length)
        return { value: false, detail: '本轮没有执行该命令的记录' };
      // 退出码归属：多语句命令的 [exit code] 属于最后一条，不能代表这条命令
      const attributed = hit.filter((c) => exitCodeAttributable(c.cmd));
      if (!attributed.length)
        return { value: null, detail: '命令由多条语句包装，退出码无法归属，弃权' };
      const ok = attributed.some((c) => !(c.isError || c.textFailed === true));
      return { value: ok, detail: `轨迹里有 ${hit.length} 次该命令（可归属 ${attributed.length} 次），${ok ? '有成功' : '全部失败'}` };
    },
  },
  write_file: {
    effect: 'write',
    params: {
      path: (v) => isAbsPath(v),
      content: (v) => typeof v === 'string' && v.length <= 4000,
    },
    async run(args) {
      const target = args.path;
      const content = args.content;
      const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
      let beforeHash = null;
      let backup = null;
      try {
        const orig = fs.readFileSync(target);
        beforeHash = sha(orig);
        // 先备份再写：出事了能人工恢复（v1 不自动回滚）
        const trashDirs = [
          path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'trash'),
          path.join(os.tmpdir(), 'cv-trash'),
        ];
        for (const trashDir of trashDirs) {
          try {
            fs.mkdirSync(trashDir, { recursive: true });
            const candidate = path.join(trashDir, `${Date.now()}-${path.basename(target)}`);
            fs.writeFileSync(candidate, orig);
            backup = candidate;
            break;
          }
          catch { /* 换下一个位置 */ }
        }
      }
      catch { /* 文件不存在 = 新建，无需备份 */ }

      // ── 原子写：临时文件 → 校验内容 → 原子改名（失败从不落地）
      const tmp = `${target}.cv-tmp-${process.pid}-${Date.now()}`;
      const wantHash = sha(Buffer.from(content, 'utf8'));
      try {
        fs.writeFileSync(tmp, content, 'utf8');
        const gotHash = sha(fs.readFileSync(tmp));
        if (gotHash !== wantHash)
          throw new Error('临时文件内容校验失败');
        fs.renameSync(tmp, target);
      }
      catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* 没有就算了 */ }
        return { value: false, detail: `写入未生效（已回退，目标未改动）：${String(e && e.message).slice(0, 60)}`, meta: { beforeHash, afterHash: null, backup, aborted: true } };
      }

      const afterHash = sha(Buffer.from(content, 'utf8'));
      return {
        value: true,
        detail: `已写入 ${target}（${content.length} 字符${backup ? '，原文件已备份' : ''}；原子提交）`,
        meta: { beforeHash, afterHash, backup, atomic: true },
      };
    },
  },
  restore_file: {
    effect: 'write',
    params: {
      path: (v) => isAbsPath(v),
      backup: (v) => isAbsPath(v),
    },
    async run({ path: target, backup }) {
      const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
      let orig;
      try {
        orig = fs.readFileSync(backup);
      }
      catch {
        return { value: false, detail: `备份不可读：${backup}` };
      }
      const tmp = `${target}.cv-undo-${process.pid}-${Date.now()}`;
      try {
        fs.writeFileSync(tmp, orig);
        const got = sha(fs.readFileSync(tmp));
        if (got !== sha(orig))
          throw new Error('备份内容校验失败');
        fs.renameSync(tmp, target);
      }
      catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
        return { value: false, detail: `恢复未生效：${String(e && e.message).slice(0, 60)}` };
      }
      return { value: true, detail: `已从备份恢复 ${target}（${orig.length} 字节）`, meta: { restoredFrom: backup } };
    },
  },
  dir_count: {
    params: {
      dir: (v) => isAbsPath(v),
      ext: (v) => typeof v === 'string' && /^\.[A-Za-z0-9]{1,8}$/.test(v),
      count: (v) => Number.isInteger(v) && v >= 0 && v <= 100000,
    },
    async run({ dir, ext, count }) {
      let files;
      try {
        files = fs.readdirSync(dir);
      }
      catch {
        return { value: null, detail: `读不到目录：${dir}` };
      }
      const n = files.filter((f) => f.toLowerCase().endsWith(ext.toLowerCase())).length;
      return { value: n === count, detail: `${dir} 下有 ${n} 个 ${ext} 文件（声称 ${count}）` };
    },
  },
  time_near: {
    transient: true,
    params: {
      hhmm: (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v),
      toleranceMin: (v) => Number.isInteger(v) && v >= 0 && v <= 720,
    },
    async run({ hhmm, toleranceMin }) {
      const now = new Date();
      const [h, m] = hhmm.split(':').map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      const diff = Math.abs(now - target) / 60000;
      return { value: diff <= toleranceMin, detail: `现在 ${now.toTimeString().slice(0, 5)}，声称 ${hhmm}（差 ${Math.round(diff)} 分钟）` };
    },
  },
};

/**
 * 校验一个检查计划。不接受任何未登记的键（防参数注入/误用）。
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validatePlan(plan) {
  const errors = [];
  if (!isPlainObject(plan) || !Array.isArray(plan.all))
    return { ok: false, errors: ['计划必须是 { all: [...] }'] };
  if (plan.all.length === 0 || plan.all.length > MAX_CHECKS)
    errors.push(`检查条数必须在 1..${MAX_CHECKS} 之间`);
  const extraKeys = Object.keys(plan).filter((k) => k !== 'all');
  if (extraKeys.length)
    errors.push('计划里有多余字段：' + extraKeys.join(','));
  plan.all.forEach((c, i) => {
    const tag = `#${i}`;
    if (!isPlainObject(c)) {
      errors.push(`${tag} 不是对象`);
      return;
    }
    const keys = Object.keys(c);
    for (const k of keys)
      if (!['prim', 'args', 'expect'].includes(k))
        errors.push(`${tag} 有多余字段 ${k}`);
    const def = PRIMS[c.prim];
    if (!def) {
      errors.push(`${tag} 未知原语 ${JSON.stringify(c.prim)}`);
      return;
    }
    if (typeof c.expect !== 'boolean')
      errors.push(`${tag} expect 必须是布尔`);
    if (!isPlainObject(c.args)) {
      errors.push(`${tag} args 必须是对象`);
      return;
    }
    const argNames = Object.keys(c.args);
    for (const name of argNames) {
      if (!def.params[name]) {
        errors.push(`${tag} 原语 ${c.prim} 不接受参数 ${name}`);
        continue;
      }
      if (!def.params[name](c.args[name]))
        errors.push(`${tag} 参数 ${name} 不合法：${JSON.stringify(c.args[name])}`);
    }
    for (const name of Object.keys(def.params)) {
      if (!(name in c.args))
        errors.push(`${tag} 缺少参数 ${name}`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/**
 * 执行检查计划。
 * @param {object} plan
 * @param {{policy?:object}} [opts] policy 不传则全放行；deny/pending 一律不执行
 * @returns {Promise<{verdict:'supported'|'contradicted'|'insufficient', results:Array, reason?:string, policy?:object}>}
 */
export async function runPlan(plan, opts = {}) {  const v = validatePlan(plan);
  if (!v.ok)
    return { verdict: 'insufficient', results: [], reason: '计划不合法：' + v.errors.join('; ') };

  // 执行前授权：策略不允许就不跑（对标 SOF 的 authorization boundary）
  const gate = checkPlan(plan, opts.policy);
  if (gate.blocked) {
    return {
      verdict: 'insufficient',
      results: [],
      reason: '策略未放行：' + gate.decisions.filter((d) => d.decision !== 'allow').map((d) => `${d.prim}=${d.decision}`).join(', '),
      policy: { hash: gate.hash, decisions: gate.decisions },
      plan,
    };
  }

  const results = [];
  for (const c of plan.all) {
    const def = PRIMS[c.prim];
    let r;
    try {
      r = await def.run({ ...c.args, __evidence: opts.evidence });
    }
    catch (e) {
      r = { value: null, detail: '执行失败：' + String(e && e.message).slice(0, 80) };
    }
    results.push({ prim: c.prim, args: c.args, expect: c.expect, actual: r.value, detail: r.detail, ...(r.meta ? { meta: r.meta } : {}) });
    if (r.value === null)
      return { verdict: 'insufficient', results, reason: '有检查无法评估：' + r.detail };
  }
  const contradicted = results.filter((r) => r.actual !== r.expect);
  if (contradicted.length) {
    // 时序对时：断言说的是过去，而检查读的是现在。瞬态原语（端口/进程/连通）不能拿"现在"否定"过去"。
    const claimTurn = Number.isInteger(opts.claimTurn) ? opts.claimTurn : undefined;
    const currentTurn = Number.isInteger(opts.currentTurn) ? opts.currentTurn : undefined;
    if (claimTurn !== undefined && currentTurn !== undefined && claimTurn < currentTurn) {
      const stale = contradicted.filter((r) => PRIMS[r.prim]?.transient === true);
      if (stale.length)
        return {
          verdict: 'insufficient',
          results,
          checkedAt: new Date().toISOString(),
          reason: `状态可能已变：${stale.map((r) => r.prim).join(',')} 是瞬态，不能据当前状态否定第 ${claimTurn} 轮的断言`,
        };
    }
    return { verdict: 'contradicted', results, checkedAt: new Date().toISOString(), reason: contradicted.map((r) => r.detail).join('；') };
  }
  return { verdict: 'supported', results, checkedAt: new Date().toISOString(), reason: results.map((r) => r.detail).join('；') };
}
