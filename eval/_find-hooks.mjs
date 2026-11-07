import fs from 'node:fs';
const lines = fs.readFileSync('lib/index.js', 'utf8').split('\n');
lines.forEach((l, i) => {
  if (l.includes('ctx.on'))
    console.log(`${i + 1}: ${l.trim()}`);
});
