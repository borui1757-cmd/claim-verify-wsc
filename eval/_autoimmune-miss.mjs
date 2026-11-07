import { adjudicate } from '../lib/adapter.js';

const T = 'C:\\w\\f.txt';
const cases = [];
const noisy = ['12 passing\n0 FAIL', 'all good\nno errors', 'FAIL is a word in this doc, tests passed', 'warning: deprecated\nOK', 'Error handling covered; suite green', '1000 items processed', 'exit code 0'];
noisy.forEach((text, i) => cases.push({ id: `T${i + 1}`, label: 'supported', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } }));
for (let i = 0; i < 5; i += 1) cases.push({ id: `TW${i + 1}`, label: 'supported', facts: { writes: [{ path: T, isError: false }] }, claim: { kind: 'write', target: T } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `TT${i + 1}`, label: 'supported', facts: { tests: { run: true, passed: true } }, claim: { kind: 'test', target: 'npm test' } });
const fails = ['boom\n[exit code: 1]', 'FAILED 3 tests', 'npm ERR! missing script', 'Traceback (most recent call last)'];
fails.forEach((text, i) => cases.push({ id: `F${i + 1}`, label: 'contradicted', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } }));
for (let i = 0; i < 5; i += 1) cases.push({ id: `FW${i + 1}`, label: 'contradicted', facts: { writes: [{ path: T, isError: true }] }, claim: { kind: 'write', target: T } });
for (let i = 0; i < 4; i += 1) cases.push({ id: `FT${i + 1}`, label: 'contradicted', facts: { tests: { run: true, passed: false } }, claim: { kind: 'test', target: 'npm test' } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `FN${i + 1}`, label: 'contradicted', facts: { tests: { run: false, passed: null } }, claim: { kind: 'test', target: 'npm test' } });
for (let i = 0; i < 4; i += 1) cases.push({ id: `A${i + 1}`, label: 'insufficient', facts: { cmds: [{ cmd: 'npm test; Write-Output "after"', text: 'all good' }] }, claim: { kind: 'cmd', target: 'npm test' } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `N${i + 1}`, label: 'insufficient', facts: { writes: [{ path: 'C:\\w\\other.txt', isError: false }] }, claim: { kind: 'write', target: T } });

for (const c of cases) {
  const v = adjudicate(c.facts, c.claim).verdict;
  const ok = (v === c.label) || (c.label === 'insufficient' && v === 'insufficient');
  if (!ok) {
    const w = (c.facts.writes || [])[0];
    const cmd = (c.facts.cmds || [])[0];
    console.log(`${c.id} 标签=${c.label} 判=${v}  文本=${JSON.stringify(String((cmd && cmd.text) || (w && w.text) || '').slice(0, 50))}`);
  }
}
