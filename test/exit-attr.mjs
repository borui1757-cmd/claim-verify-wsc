// exit-attr.mjs —— 退出码归属
import { exitCodeAttributable, statementsOf } from '../lib/exit-attr.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('单条命令可归属', exitCodeAttributable('npm test') === true);
check('分号包装不可归属', exitCodeAttributable('npm test; Write-Output "after"') === false);
check('exit $LASTEXITCODE 可归属', exitCodeAttributable('npm test; exit $LASTEXITCODE') === true);
check('换行包装不可归属', exitCodeAttributable('npm test\nWrite-Output "done"') === false);
check('字符串里的分号不算分隔', statementsOf('node -e "a;b"').length === 1, String(statementsOf('node -e "a;b"').length));
check('空命令不崩', exitCodeAttributable('') === true);
check('三条语句末条无透传', exitCodeAttributable('cd x; npm test; echo ok') === false);
check('三条语句末条透传', exitCodeAttributable('cd x; npm test; exit $LASTEXITCODE') === true);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
