// citation.mjs —— 引文核验自测（知识区入口）。
//
// 守住的边界：CITATION_OK 只证明「引用忠实于来源」，**不证明来源正确**。
// 所以这里不测"这句话对不对"，只测"这句话是否真的在它声称的出处里"。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { verifyCitation, normalizeWs, renderCitation } from '../lib/citation.js'
import { PRIMS, validatePlan } from '../lib/dsl.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cite-'))
const src = path.join(dir, 'paper.md')
const body = '# 论文\n\n我们的做法是\n先冻结承诺清单，让遗漏变得可见。\n\n第二段：与本文无关。\n'
fs.writeFileSync(src, body, 'utf8')
const sha = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')

// ① 引文确实在出处里（含跨行/多空格归一）
const ok = verifyCitation({ path: src, quote: '先冻结承诺清单' })
check('引文命中 → supported / CITATION_OK', ok.verdict === 'supported' && ok.code === 'CITATION_OK', ok)
// 引文里带换行/多空格，出处里是单个换行 → 归一后应当命中
const multi = verifyCitation({ path: src, quote: '我们的做法是\n\n    先冻结承诺清单' })
check('空白/换行归一后仍命中', multi.verdict === 'supported', multi)

// ② 出处不存在（幻觉的典型形态）
const missing = verifyCitation({ path: path.join(dir, 'nope.md'), quote: '随便什么引文' })
check('出处不存在 → contradicted / SOURCE_MISSING', missing.verdict === 'contradicted' && missing.code === 'SOURCE_MISSING', missing)

// ③ 出处存在但没有这句（最该抓的一类）
const notFound = verifyCitation({ path: src, quote: '这句话根本不在文件里' })
check('引文与出处不符 → contradicted / QUOTE_NOT_FOUND', notFound.verdict === 'contradicted' && notFound.code === 'QUOTE_NOT_FOUND', notFound)

// ④ 哈希对不上（出处被改过）
const badHash = verifyCitation({ path: src, quote: '先冻结承诺清单', sha256: 'a'.repeat(64) })
check('哈希不符 → contradicted / HASH_MISMATCH', badHash.verdict === 'contradicted' && badHash.code === 'HASH_MISMATCH', badHash)
const goodHash = verifyCitation({ path: src, quote: '先冻结承诺清单', sha256: sha })
check('哈希一致 + 引文命中 → supported', goodHash.verdict === 'supported', goodHash)

// ⑤ 读不到 → insufficient（弃权，不当成"它不存在"）
const asDir = verifyCitation({ path: dir, quote: '先冻结承诺清单' })
check('出处是目录 → insufficient / SOURCE_UNREACHABLE', asDir.verdict === 'insufficient' && asDir.code === 'SOURCE_UNREACHABLE', asDir)

// ⑥ 太短的引文不判（避免"的"这种词到处命中）
const tooShort = verifyCitation({ path: src, quote: '的' })
check('引文太短 → insufficient / QUOTE_TOO_SHORT', tooShort.verdict === 'insufficient' && tooShort.code === 'QUOTE_TOO_SHORT', tooShort)

// ⑦ 没给路径 → insufficient
check('没路径 → insufficient', verifyCitation({ quote: '先冻结承诺清单' }).verdict === 'insufficient')

// ⑧ 渲染必须带边界声明（防止后人当成"事实正确"）
check('渲染含"不证明来源正确"', /不证明来源正确/.test(renderCitation(ok)), renderCitation(ok))

// ⑨ DSL 接线：原语登记 + 参数校验 + 三态映射
check('DSL 里注册了 cite_contains', Boolean(PRIMS.cite_contains), Object.keys(PRIMS).includes('cite_contains'))
const plan = { all: [{ prim: 'cite_contains', args: { path: src, quote: '先冻结承诺清单' }, expect: true }] }
const v = validatePlan(plan)
check('合法计划通过校验', v.ok === true, v.errors)
const runResult = await PRIMS.cite_contains.run({ path: src, quote: '先冻结承诺清单' })
check('原语执行 → value=true（成立）', runResult.value === true, runResult)
const runMiss = await PRIMS.cite_contains.run({ path: src, quote: '文件里没有这句' })
check('原语执行 → value=false（被反驳）', runMiss.value === false, runMiss)

check('normalizeWs 折叠全角空格', normalizeWs('a\u3000\u3000b') === 'a b')

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
