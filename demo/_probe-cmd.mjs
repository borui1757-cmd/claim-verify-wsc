import { expectationsFromCommand, shouldInlineCheck, inlineCheck } from '../lib/inline.js';

const cmd = [
  '$f = "C:\\Users\\19156\\Desktop\\cv-probe-delete.txt"',
  'Remove-Item "C:\\Users\\19156\\Desktop\\cv-probe-delete.txt" -WhatIf',
  'Write-Output ("文件仍在：" + (Test-Path $f))',
].join('\n');

console.log('命令:', JSON.stringify(cmd));
console.log('期望:', JSON.stringify(expectationsFromCommand(cmd)));
console.log('should:', shouldInlineCheck('pwsh', { command: cmd }, {}));
const note = inlineCheck('pwsh', { command: cmd }, {});
console.log('提示:', note);

// 再试一个最简单的
const simple = 'Remove-Item "C:\\Users\\19156\\Desktop\\cv-probe-delete.txt" -WhatIf';
console.log('\n简单命令期望:', JSON.stringify(expectationsFromCommand(simple)));
