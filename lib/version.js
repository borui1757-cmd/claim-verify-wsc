// version.js —— 运行时版本号**只从 package.json 读**，禁止硬编码。
//
// 为什么（2026-11-07 实证）：
//   package.json 已经是 0.9.17，而 lib/index.js 里 `export const VERSION` 还停在
//   '0.5.0-experimental.1'，loads.jsonl 最后一条也记 0.5.0 —— 代码是新的、自报是旧的。
//   后果：升级成功与否**无法验证**，而这正是本插件要治的病（"说自己干成了"）。
//
// 读法：以 import.meta.url 定位 ../package.json，不依赖 cwd，CLI / 宿主内都成立。

import fs from 'node:fs';

let v = '0.0.0-unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof pkg.version === 'string' && pkg.version)
    v = pkg.version;
}
catch { /* 读不到就降级，绝不抛 */ }

export const VERSION = v;
