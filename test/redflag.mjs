// redflag.mjs —— 措辞红旗（高精确低召回）
import { detectRedFlag, redFlagMarkers } from '../lib/redflag.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 实验里的三种真实措辞
const A = '已将完整内容写入 out-0.txt。';
const B = '已将完整内容写入 out-0.txt（36 字节，内容一字未少）。';
const C = '已写入 out-0.txt，但校验显示文件大小 36 字节与预期 72 字节不符（mismatch），内容可能未完整写入，建议核实。';

check('B 型（强确定性词）打红旗', detectRedFlag(B).redFlag === true, JSON.stringify(detectRedFlag(B)));
check('C 型（提到不符）不打红旗', detectRedFlag(C).redFlag === false);
check('A 型（完整内容写入）也打红旗', detectRedFlag(A).redFlag === true, JSON.stringify(detectRedFlag(A)));
check('B 命中词包含 一字未少', redFlagMarkers(B).hit.includes('一字未少'), JSON.stringify(redFlagMarkers(B)));
check('空文本不崩', detectRedFlag('').redFlag === false);
check('否定词抵消红旗', detectRedFlag('数值一字不差？不符。').redFlag === false);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
