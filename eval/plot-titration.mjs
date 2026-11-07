#!/usr/bin/env node
// 证据滴定曲线：把三档披露画成"翻转点"曲线（SVG + 文本）
//
// 数据来自 7.6.14（两次独立复现）：
//   ok           → 20/20 谎报
//   +size        → 19/20
//   +mismatch    → 0/20
//
// 输出：docs/figs/titration.svg + 控制台文本图

import fs from 'node:fs';
import path from 'node:path';

const points = [
  { label: 'ok', value: 100, note: '20/20' },
  { label: '+ size', value: 95, note: '19/20' },
  { label: '+ intent/mismatch', value: 0, note: '0/20' },
];

// ── 文本图 ──
const W = 46;
function bar(v) {
  const filled = Math.round((v / 100) * W);
  return '█'.repeat(filled) + '·'.repeat(W - filled);
}
console.log('证据滴定曲线（纵轴：无保留谎报率）\n');
for (const p of points)
  console.log(`${p.label.padEnd(20)} ${bar(p.value)} ${String(p.value).padStart(3)}%  (${p.note})`);
console.log('\n翻转点：加 mismatch 那一滴（95% → 0%）');

// ── SVG ──
const w = 560;
const h = 260;
const pad = 48;
const xs = points.map((_, i) => pad + (i * (w - pad * 2)) / (points.length - 1));
const ys = points.map((p) => h - pad - (p.value / 100) * (h - pad * 2));

const poly = points.map((p, i) => `${xs[i]},${ys[i]}`).join(' ');
const dots = points.map((p, i) => `<circle cx="${xs[i]}" cy="${ys[i]}" r="4.5" fill="#c0392b"/>`).join('\n  ');
const labels = points.map((p, i) => `<text x="${xs[i]}" y="${ys[i] - 10}" font-size="11" fill="#333" text-anchor="middle">${p.value}%</text>`).join('\n  ');
const xlabels = points.map((p, i) => `<text x="${xs[i]}" y="${h - pad + 18}" font-size="11" fill="#333" text-anchor="middle">${p.label}</text>`).join('\n  ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="${w / 2}" y="20" font-size="13" fill="#111" text-anchor="middle">证据滴定曲线：加入更多证据后，谎报率在第 3 滴翻转</text>
  <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#999"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#999"/>
  <text x="12" y="${pad}" font-size="10" fill="#666" transform="rotate(-90 12 ${pad})">谎报率 100%</text>
  <text x="12" y="${h - pad}" font-size="10" fill="#666" transform="rotate(-90 12 ${h - pad})">0%</text>
  <polyline points="${poly}" fill="none" stroke="#2c3e50" stroke-width="2"/>
  ${dots}
  ${labels}
  ${xlabels}
  <text x="${w / 2}" y="${h - 8}" font-size="10" fill="#666" text-anchor="middle">披露的核验信息量（滴定）</text>
</svg>`;

const outDir = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/docs/figs';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'titration.svg'), svg);
console.log('\n已写入 docs/figs/titration.svg');
