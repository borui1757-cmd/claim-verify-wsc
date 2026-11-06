// 用 Node 直接打 API（避开 PowerShell 的 UTF-8 问题）
const cases = [
  { name: '存在的文件', claims: [{ kind: 'path', value: 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/package.json', expect: 'exists' }] },
  { name: '不存在的文件', claims: [{ kind: 'path', value: 'C:/__nope__.txt', expect: 'exists' }] },
  { name: '端口 3080 在听', claims: [{ kind: 'port', value: '3080', expect: 'listening' }] },
  { name: '端口 59999 没听', claims: [{ kind: 'port', value: '59999', expect: 'not_listening' }] },
  { name: '算术 12×12=143（错）', claims: [{ kind: 'math', value: { a: 12, op: '×', b: 12, claimed: 143 } }] },
  { name: '算术 12×12=144（对）', claims: [{ kind: 'math', value: { a: 12, op: '×', b: 12, claimed: 144 } }] },
  { name: '一条自相矛盾', claims: [
    { kind: 'lines', value: { path: 'C:/tmp/a.txt', n: 3 } },
    { kind: 'lines', value: { path: 'C:/tmp/a.txt', n: 5 } },
  ] },
];

for (const c of cases) {
  const r = await fetch('http://127.0.0.1:8600/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claims: c.claims }),
  });
  const j = await r.json();
  const brief = j.results.map((x) => x.verdict + (x.expect ? '（' + x.expect + '）' : '')).join(' | ');
  console.log(`${c.name.padEnd(22)} ok=${j.ok}  ${brief}${j.contradictions ? '  矛盾=' + j.contradictions : ''}`);
}
