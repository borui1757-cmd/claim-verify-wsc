// decide-alt.js —— 独立实现（差分测试用）。
//
// 刻意与 lib/isolated-audit.js 不同：
//   · 自己从原始 pairs 里扫，不复用 extractEvidence
//   · 自己做路径归一，不复用 normPath
//   · 用「有没有成功命中 / 有没有失败命中」的两段式，而不是「先找成功再找失败」
// 目的：如果两套实现结论一致，说明判定不是某个写法带来的偶然。

function norm(p) {
  return String(p || '').split('/').join('\\').toLowerCase().trim();
}

function looksFailed(p) {
  if (p.isError === true)
    return true;
  const t = String(p.text || '');
  return /(?:^|\n)\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|\[exit code: [1-9]\d*\]|exit code:? [1-9]\d*)/.test(t);
}

export function decideAlt(claim, pairs) {
  const writes = [];
  const cmds = [];
  for (const p of pairs || []) {
    const a = p.args || {};
    const f = a.file_path || a.path;
    const c = a.command || a.cmd;
    const failed = looksFailed(p);
    const seen = p.resultSeen !== false;
    if (typeof f === 'string' && f)
      writes.push({ path: norm(f), failed, seen });
    if (typeof c === 'string' && c)
      cmds.push({ cmd: String(c), failed, seen });
  }

  const target = claim.target == null ? '' : String(claim.target);

  if (claim.kind === 'write') {
    const hits = writes.filter((w) => w.path === norm(target));
    if (hits.length === 0)
      return 'insufficient';
    if (hits.some((h) => !h.failed && h.seen))
      return 'supported';
    if (hits.some((h) => h.failed))
      return 'contradicted';
    return 'insufficient';
  }

  if (claim.kind === 'test') {
    const tests = cmds.filter((x) => /(?:pytest|jest|vitest|mocha|npm\s+(?:run\s+)?test|go\s+test|cargo\s+test)/i.test(x.cmd));
    if (tests.length === 0)
      return 'insufficient';
    if (tests.every((x) => x.failed))
      return 'contradicted';
    if (tests.some((x) => x.failed))
      return 'insufficient';
    return 'supported';
  }

  const hits = cmds.filter((x) => target && x.cmd.includes(target));
  if (hits.length === 0)
    return 'insufficient';
  if (hits.some((h) => !h.failed && h.seen))
    return 'supported';
  if (hits.some((h) => h.failed))
    return 'contradicted';
  return 'insufficient';
}
