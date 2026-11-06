import {
  DEFAULT_TTL, stamp, isFresh, remainingMs, revalidateIfStale, staleCount,
} from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/freshness.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// 盖章与默认保质期
const p = stamp('port', 'PASS', { nowMs: 1000 })
check('port 保质期取默认 5s', p.ttlMs === 5000, p.ttlMs)
check('刚盖章是新鲜的', isFresh(p, 1000) === true)
check('过期后不新鲜', isFresh(p, 7000) === false)
check('剩余时间正确', remainingMs(p, 3000) === 3000, remainingMs(p, 3000))
check('已过期剩余为 0', remainingMs(p, 99999) === 0)

// 内容寻址：哈希永久新鲜
const h = stamp('hash', 'PASS', { nowMs: 0 })
check('hash 保质期 0（永久）', h.ttlMs === 0)
check('hash 一万年后仍新鲜', isFresh(h, 10 ** 12) === true)
check('hash 剩余时间为 Infinity', remainingMs(h, 10 ** 12) === Infinity)

// 自定义 TTL
const custom = stamp('path', 'PASS', { nowMs: 0, ttlMs: 100 })
check('自定义 TTL 生效', isFresh(custom, 99) === true && isFresh(custom, 101) === false)

// 过期才重验
let called = 0
const revalidate = async () => { called += 1; return stamp('port', 'INVALID', { nowMs: 20_000 }) }

const fresh = await revalidateIfStale(p, revalidate, 2000)
check('新鲜时复用旧结论', fresh.reused === true && called === 0, { reused: fresh.reused, called })

const stale = await revalidateIfStale(p, revalidate, 20_000)
check('过期时重验', stale.reused === false && called === 1, { reused: stale.reused, called })
check('重验拿到新结论', stale.verdict === 'INVALID')

// 统计新鲜度缺口
const recs = [stamp('port', 'PASS', { nowMs: 0 }), stamp('hash', 'PASS', { nowMs: 0 }), stamp('port', 'PASS', { nowMs: 19_000 })]
check('staleCount 正确', staleCount(recs, 20_000) === 1, staleCount(recs, 20_000))

// 默认保质期表完整性
check('默认表覆盖 service', DEFAULT_TTL.service === 3000)
check('默认表覆盖 filecount', DEFAULT_TTL.filecount === 30000)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
