import { serviceState, clearServiceCache } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/host.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

clearServiceCache()

// 第一次真实查询
const a = serviceState('Spooler', null, 1000)
check('取到服务状态', a && typeof a.found === 'boolean', a)

// TTL 内（3s）→ 命中缓存，返回同一个对象
const b = serviceState('Spooler', null, 1500)
check('TTL 内命中缓存（同一对象）', a === b)

// 超过 TTL → 重新查询，得到新对象
const c = serviceState('Spooler', null, 100000)
check('超过 TTL 重新查询（新对象）', a !== c)

// 值仍然一致
check('重查后状态一致', JSON.stringify(a) === JSON.stringify(c), [a, c])

// 不存在的服务
const ghost = serviceState('__cv_no_such_service__', null, 200000)
check('不存在的服务返回 found:false', ghost && ghost.found === false, ghost)

clearServiceCache()
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
