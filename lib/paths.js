// paths.js —— 绝对路径判定（跨平台）。
//
// 早期校验只接受 `C:\...` 形式的 Windows 绝对路径，导致在 Linux/macOS 上
// 所有基于 os.tmpdir() 的测试与真实用例都被判"相对路径"而拒绝。
// 这里统一为：Windows 盘符路径 或 POSIX 以 / 开头的路径。

/** 是否是绝对路径（跨平台）。 */
export function isAbsPath(p) {
  if (typeof p !== 'string' || !p.length || p.length > 300)
    return false;
  if (/^[A-Za-z]:[\\/]/.test(p))
    return true; // Windows：C:\... 或 C:/...
  if (p.startsWith('/'))
    return true; // POSIX：/tmp/...、/proc/...
  if (p.startsWith('\\\\'))
    return true; // UNC：\\server\share
  return false;
}

/** 归一化用于比较：统一分隔符、小写（与 receipt/dsl 的既有口径一致）。 */
export function normPathLike(p) {
  return typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null;
}
