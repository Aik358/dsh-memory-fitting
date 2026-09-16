/**
 * 发布助手：bump → 构建 → 测试 → 提交 → 推送 → 打 tag → 发 npm。
 * 用法：node scripts/release.mjs <version> "<commit message>"
 * 凭据从本机记忆文件读取，绝不写入任何仓库文件。
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const VERSION = process.argv[2]
const MSG = process.argv[3] || ('release v' + VERSION)
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) {
  console.error('用法: node scripts/release.mjs <x.y.z> "<message>"')
  process.exit(1)
}

const CRED = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh_debug--/MEMORY.md'
const credText = readFileSync(CRED, 'utf8')
const PAT = credText.match(/github_pat_[A-Za-z0-9_]{20,}/)[0]
const NPM = credText.match(/npm_ViUq[A-Za-z0-9]+/)[0]

const R = 'D:/dsh-memory-fitting'
const run = (c, opts = {}) => {
  try {
    return { ok: true, out: (execSync(c, { cwd: R, stdio: 'pipe', encoding: 'utf8', ...opts }) || '').trim() }
  } catch (e) {
    return { ok: false, out: ((e.stderr || '') + (e.stdout || '')).toString().trim() }
  }
}
const mask = (s) => s.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@').replace(new RegExp(NPM, 'g'), 'npm_***')
const step = (n, r, show = 0) => {
  console.log((r.ok ? '  [ok] ' : '  [FAIL] ') + n)
  if (!r.ok || show) console.log('        ' + mask(r.out).split('\n').slice(0, show || 4).join('\n        '))
  return r.ok
}

// 1) 版本号
let pkg = JSON.parse(readFileSync(R + '/package.json', 'utf8'))
if (pkg.version === VERSION) {
  console.log('版本已是 ' + VERSION + '，跳过 bump')
} else {
  pkg.version = VERSION
  const fs = await import('node:fs')
  fs.writeFileSync(R + '/package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log('  [ok] bump -> ' + VERSION)
}

// 2) 构建 + 测试
console.log('== 构建 ==')
if (!step('build', run('node build.mjs'))) process.exit(1)
if (!step('smoke', run('node scripts/smoke.mjs'), 2)) process.exit(1)

// 3) 提交
console.log('== 提交 ==')
run('git add -A')
const commit = run('git commit -q -m "' + MSG.replace(/"/g, '') + '" 2>&1')
if (!commit.ok && !/nothing to commit/.test(commit.out)) {
  console.log('  [FAIL] commit: ' + mask(commit.out).slice(0, 200)); process.exit(1)
}
console.log('  [ok] commit')

// 4) 推送 + tag
console.log('== 推送 ==')
run('git remote set-url origin https://x-access-token:' + PAT + '@github.com/Aik358/dsh-memory-fitting.git')
if (!step('push main', run('git push origin main 2>&1'), 1)) process.exit(1)
run('git tag -a v' + VERSION + ' -m "v' + VERSION + '" 2>&1')
if (!step('push tag', run('git push origin v' + VERSION + ' 2>&1'), 1)) process.exit(1)

// 5) 发 npm
console.log('== 发布 npm ==')
const fs2 = await import('node:fs')
const npmrc = process.env.TEMP + '/mf-rel-npmrc'
fs2.writeFileSync(npmrc, 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=' + NPM + '\n', 'ascii')
const pub = run('npm --userconfig="' + npmrc + '" publish --access public --registry=https://registry.npmjs.org/ 2>&1')
console.log((pub.ok ? '  [ok] ' : '  [FAIL] ') + 'npm publish')
console.log('        ' + mask(pub.out).split('\n').slice(-5).join('\n        '))
try { fs2.unlinkSync(npmrc) } catch {}

console.log('')
console.log('完成 v' + VERSION)
