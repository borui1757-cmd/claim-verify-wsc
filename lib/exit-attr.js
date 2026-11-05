// exit-attr.js —— 退出码归属：这个 [exit code: N] 到底是不是这条命令的？
//
// 背景（实测）：DSH 的 [exit code: N] 是 **shell 宿主进程**的退出码。
// 在 Windows PowerShell 里，那是**最后一条语句**的退出码，所以：
//
//   npm test; Write-Output "after"        → 0（失败被掩盖）
//   npm test; exit $LASTEXITCODE          → 1（透传，可归属）
//   npm test                              → 1（单语句，可归属）
//
// 不可归属时不能断言成功，也不能断言失败 —— 只能弃权（unknown）。

/** 按语句切分（粗粒度：去掉引号内容后按 ; 和换行切） */
function statementsOf(command) {
  const s = String(command || '');
  // 先把引号内的内容替换成占位符，避免把字符串里的分号当分隔符
  let masked = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) { quote = null; masked += ch; }
      else masked += '_';
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; masked += ch; continue; }
    masked += ch;
  }
  return masked.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * 这条命令的退出码能否归属给它自己？
 * @returns {boolean}
 */
export function exitCodeAttributable(command) {
  const parts = statementsOf(command);
  if (parts.length <= 1)
    return true;
  const last = parts[parts.length - 1];
  // 显式透传：exit $LASTEXITCODE / exit $LASTEXITCODE 形式
  return /^exit\s+\$?LASTEXITCODE\b/i.test(last)
    || /^\$?LASTEXITCODE\s*;?\s*exit\b/i.test(last);
}

export { statementsOf };
