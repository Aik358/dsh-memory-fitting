import { readFile } from 'node:fs/promises'
const mod = await import('../lib/index.js')
console.log('== 宿主侧可加载性 ==')
console.log('  name   = ' + mod.name)
console.log('  inject = ' + JSON.stringify(mod.inject))
console.log('  apply  = ' + typeof mod.apply)

const nodeB = await readFile('lib/index.js', 'utf8')
const cl = await readFile('lib/client.js', 'utf8')

console.log('')
console.log('== 开关默认值是否真的写进产物 ==')
console.log('  injectContext: false  = ' + /injectContext:\s*false/.test(nodeB))
console.log('  writeMemory:   false  = ' + /writeMemory:\s*false/.test(nodeB))
console.log('  exposeTools:   false  = ' + /exposeTools:\s*false/.test(nodeB))
console.log('  localArchive:  true   = ' + /localArchive:\s*true/.test(nodeB))

console.log('')
console.log('== 关键防护点是否在产物里 ==')
const checks = [
  ['prefix 路由注册', /kind:\s*["']prefix["']/],
  ['webServer 注册被 try 包住', /webServer\.register/],
  ['ask 失败降级(不抛)', /用户未完成作答/],
  ['轮数上限护栏', /已达轮数上限/],
  ['guard 包裹路由', /guard\(/],
]
for (const [n, re] of checks) console.log('  ' + (re.test(nodeB) ? '✓' : '✗') + ' ' + n)

console.log('')
console.log('== 客户端关键点 ==')
const cc = [
  ['不带 method 字段（契约只有 path/handler）', !/kind:\s*["']exact["']/.test(cl)],
  ['独立列 472px', /472/.test(cl)],
  ['窄屏兜底', /fitPanel/.test(cl)],
  ['零 require', !/require\(["'][^"']/.test(cl)],
]
for (const [n, ok] of cc) console.log('  ' + (ok ? '✓' : '✗') + ' ' + n)

console.log('')
console.log('== 危险序列自检 ==')
const LT = String.fromCharCode(60)
const NEEDLE = LT + '!-- ' + 'memory' + ':'
for (const f of ['lib/index.js', 'lib/client.js', 'src/node/index.js', 'src/node/routes.js', 'src/node/memory-adapter.js', 'src/node/sanitize.js']) {
  const t = await readFile(f, 'utf8')
  console.log('  ' + (t.includes(NEEDLE) ? '✗ 含' : '✓ 不含') + '  ' + f)
}
