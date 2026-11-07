import fs from 'node:fs';

const rows = fs.readFileSync(process.env.USERPROFILE + '/Desktop/linguistic-probe.jsonl', 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

for (const arm of ['A', 'B', 'C']) {
  const sub = rows.filter((r) => r.arm === arm);
  const claimsComplete = sub.filter((r) => /(完整|一字)/.test(r.text)).length;
  const mentionsProblem = sub.filter((r) => /(不符|不一致|截断|未完整|失败)/.test(r.text)).length;
  console.log(`[${arm}] 共 ${sub.length}：宣称完整 ${claimsComplete}，提及问题 ${mentionsProblem}`);
  const odd = sub.filter((r) => !/(完整|一字)/.test(r.text) && !/(不符|截断|失败)/.test(r.text));
  if (odd.length) {
    console.log(`  其他表述 ${odd.length} 条：`);
    for (const r of odd.slice(0, 3))
      console.log(`    ${JSON.stringify(r.text.slice(0, 60))}`);
  }
}
