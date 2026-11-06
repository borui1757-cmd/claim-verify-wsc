// inline.js —— 工具结果边界的实时核验（"软件本体感觉"的工程实现）
//
// 动机：回合结束才反馈时，模型对"我成功了"的信念已经形成，之后的证据只能被解释掉
//（见论文 §7.6.8 的 C/D 臂）。所以核验必须挂在**动作刚刚发生的那一刻**。
//
// 覆盖面（②）：
//   写类工具（write_file / edit / patch）→ 目标应存在
//   shell 工具里的重定向 / tee / mkdir / touch → 目标应存在
//   shell 工具里的 rm / del / Remove-Item / mv（源） → 目标应不存在
//
// 设计约束：对象标识唯一（绝对路径），不给"相对 vs 绝对"留解释空间；失败不抛错。

import fs from 'node:fs';
import path from 'node:path';

const WRITE_TOOLS = /(write_file|write|edit|edit_file|multi_edit|apply_patch|create_file|save_file)/i;
const SHELL_TOOLS = /(pwsh|powershell|bash|shell|sh|cmd|run_command|exec|terminal)/i;

// 追加写入/创建类：期望目标存在
const CREATE_PATTERNS = [
  /(?:^|\s)>{1,2}\s*("([^"]+)"|'([^']+)'|([^\s;|&]+))/g,
  /\|\s*tee\s+(?:-a\s+)?("([^"]+)"|'([^']+)'|([^\s;|&]+))/g,
  /(?:^|\s)(?:mkdir|md|New-Item|ni|touch)\s+(?:-ItemType\s+\w+\s+)?(?:-Path\s+)?("([^"]+)"|'([^']+)'|([^\s;|&]+))/gi,
];
// 删除/移动：期望目标消失
const DELETE_PATTERNS = [
  /(?:^|\s)(?:rm|del|erase|Remove-Item|ri|rmdir|rd)\s+(?:-Recurse\s+)?(?:-Force\s+)?(?:-Path\s+)?("([^"]+)"|'([^']+)'|([^\s;|&]+))/gi,
  /(?:^|\s)(?:mv|move|Move-Item|mi|rename|ren)\s+("([^"]+)"|'([^']+)'|([^\s;|&]+))/gi,
];

const IGNORE = /^(nul|\/dev\/null|\$null|con|prn)$/i;

// ── 时点差账本（2026-11-06 加）─────────────────────────────────────────────
// 实测误报：我 write 了一个探针脚本，同一个回合里又把它删掉；核验是在删除**之后**
// 才跑到这条 write 上的，于是报「write 返回成功，但该路径不存在」——把正常操作判成撒谎。
// 做法：本回合出现过的删除目标都记账，write 的"不存在"命中账本就放过（TTL 10 分钟）。
const DELETED_TTL_MS = 10 * 60 * 1000;
const deletedLedger = new Map();

function rememberDeletes(cmd, nowMs = Date.now()) {
  let list = [];
  try {
    list = collect(String(cmd || ''), DELETE_PATTERNS);
  }
  catch {
    list = [];
  }
  for (const p of list) {
    try {
      deletedLedger.set(path.resolve(p), nowMs);
    }
    catch { /* 非法路径忽略 */ }
  }
  for (const [k, t] of deletedLedger) {
    if (nowMs - t > DELETED_TTL_MS)
      deletedLedger.delete(k);
  }
}

function deletedRecently(abs, nowMs = Date.now()) {
  const t = deletedLedger.get(abs);
  return t !== undefined && nowMs - t <= DELETED_TTL_MS;
}

/** 测试用：清空账本。 */
export function resetInlineLedger() {
  deletedLedger.clear();
}

const pick = (m) => m[2] || m[3] || m[4] || '';

function collect(cmd, patterns) {
  const out = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const raw = pick(m);
      if (!raw || IGNORE.test(raw))
        continue;
      // 2026-11-06 实测：命令里的 PowerShell 变量（$stage / $p1）和提示符片段被当成路径期望，
      // 于是报「C:\Users\19156\$stage 不存在」。含 $ / < / > 的一律不算路径。
      if (/[$<>]/.test(raw))
        continue;
      if (/^[-/]/.test(raw) && !/[\\/.]/.test(raw))
        continue; // 形如 -Force 的参数
      out.push(raw);
    }
  }
  return out;
}

/** 从 shell 命令里推断"应发生什么"。 */
export function expectationsFromCommand(cmd) {
  const text = String(cmd || '');
  const create = [...new Set(collect(text, CREATE_PATTERNS))];
  const remove = [...new Set(collect(text, DELETE_PATTERNS))];
  const out = [];
  for (const p of create)
    out.push({ path: p, expectExists: true });
  for (const p of remove)
    if (!create.includes(p))
      out.push({ path: p, expectExists: false });
  return out.slice(0, 3);
}

/** 从工具调用参数里取目标路径。 */
export function targetPathOf(args) {
  if (!args || typeof args !== 'object')
    return null;
  for (const k of ['path', 'file_path', 'filePath', 'filename', 'target']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim())
      return v.trim();
  }
  return null;
}

/** 该工具调用是否值得做实时核验。 */
export function shouldInlineCheck(name, args, result) {
  if (!name)
    return false;
  if (result && result.isError === true)
    return false;
  if (WRITE_TOOLS.test(name))
    return Boolean(targetPathOf(args));
  if (SHELL_TOOLS.test(name)) {
    const cmd = args?.command || args?.cmd || args?.script;
    return typeof cmd === 'string' && expectationsFromCommand(cmd).length > 0;
  }
  return false;
}

/**
 * 实时核验：动作刚返回时，立刻问操作系统"它到底发生了没有"。
 * @returns {string|null} 需要回写的提示；一切正常返回 null。
 */
export function inlineCheck(name, args, result) {
  if (!shouldInlineCheck(name, args, result))
    return null;

  const notes = [];
  const raw = targetPathOf(args);
  if (WRITE_TOOLS.test(name) && raw) {
    const abs = path.resolve(raw);
    let exists = false;
    try { fs.statSync(abs); exists = true; } catch { exists = false; }
    if (!exists && !deletedRecently(abs)) {
      notes.push(`${name} 返回成功，但该路径不存在（对象：${abs}）`);
    }
  }

  if (SHELL_TOOLS.test(name)) {
    const cmd = args?.command || args?.cmd || args?.script || '';
    rememberDeletes(cmd);
    for (const exp of expectationsFromCommand(cmd)) {
      const abs = path.resolve(exp.path);
      let exists = false;
      try { fs.statSync(abs); exists = true; } catch { exists = false; }
      if (exp.expectExists && !exists && !deletedRecently(abs))
        notes.push(`命令返回成功，但 ${abs} 不存在`);
      if (!exp.expectExists && exists)
        notes.push(`命令返回成功，但 ${abs} 仍然存在`);
    }
  }

  if (!notes.length)
    return null;
  return `【实时核验】${notes.join('；')}。\n`
    + '这是刚发生的动作，不是历史记录。请以绝对路径为准，不要用相对路径解释差异。';
}

/**
 * 把提示追加到工具结果内容里（让它出现在观测通道，而不是作为用户消息）。
 * 支持两种形态：字符串，或 [{type:'text', text}] 数组。
 */
export function appendToToolContent(content, note) {
  if (!note)
    return null;
  if (typeof content === 'string')
    return content + '\n\n' + note;
  if (Array.isArray(content)) {
    const parts = content.filter((c) => c && typeof c.text === 'string');
    if (!parts.length)
      return null;
    return [...content, { type: 'text', text: '\n' + note }];
  }
  return null;
}
