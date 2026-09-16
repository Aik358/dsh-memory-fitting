/**
 * 记忆插件写入适配器 —— 三级降级链，且【默认关闭】。
 *
 * ① dsh-auto-memory 在？ → 走它的官方写入口 POST /api/dsh-auto-memory-pre/note
 * ② 其它记忆插件     → 各自适配器（当前未实现，预留）
 * ③ 都没有           → 只写插件自己的 JSONL（永远可用）
 *
 * 注意：本模块只负责"往外部记忆插件写"，插件自己的本地留档在 store.js。
 * 用户要求：外部写入默认关闭，本地留档默认可开。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { guard } from './sanitize.js'

const PROFILE_MANIFEST = join(homedir(), '.dsh', 'profiles', 'web', 'package.json')

/**
 * 探测 dsh-auto-memory 是否安装。
 * 证据来源：profile 清单的 dependencies + dsh.profile.bundles。
 * ⚠️ 该 JSON 历史上出现过 BOM 问题，读取必须容忍（用户硬性规则）。
 */
export async function detectMemoryPlugins() {
  const found = { autoMemory: false, bundles: [], dependencies: [] }
  try {
    const raw = await readFile(PROFILE_MANIFEST, 'utf8')
    const pkg = JSON.parse(raw.replace(/^\uFEFF/, ''))
    const deps = Object.keys(pkg.dependencies || {})
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    found.dependencies = deps
    found.bundles = bundles
    found.autoMemory = deps.includes('@a9i5k4/dsh-auto-memory') || bundles.includes('@a9i5k4/dsh-auto-memory')
  } catch {
    // 探测失败 = 当作没装。绝不因此阻断插件自身功能。
  }
  return found
}

/** 判 auto-memory 实例是否活着（HTTP /state）。 */
export async function autoMemoryAlive(port = 3080) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch('http://127.0.0.1:' + port + '/api/dsh-auto-memory-pre/state', { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

/**
 * 把拟合结论写进 auto-memory（唯一的写入口）。
 *
 * 强制安全：内容先过 guard()，命中保留序列则改写措辞。
 * 历史教训：反引号/代码块包裹【无效】，必须改写。
 */
export async function writeToAutoMemory(content, port = 3080) {
  const g = guard(String(content || ''))
  if (!g.text.trim()) return { ok: false, reason: 'empty' }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch('http://127.0.0.1:' + port + '/api/dsh-auto-memory-pre/note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: g.text }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return { ok: res.ok, status: res.status, sanitized: g.hits, reason: res.ok ? null : 'http-' + res.status }
  } catch (e) {
    return { ok: false, reason: 'network: ' + (e && e.message ? e.message : String(e)) }
  }
}

/**
 * 拟合并结论 → 可写入的记忆条目文本。
 * 所有来自用户的文本（原话、问题、答案）都必须过 guard()。
 */
export function buildConclusionNote(sess, extra = {}) {
  const safe = (s) => guard(String(s == null ? '' : s)).text
  const lines = []
  lines.push('### ' + (safe(sess.anchor && sess.anchor.node) || '意图拟合结论'))
  lines.push('')
  if (sess.utterance) lines.push('- 触发语：「' + safe(sess.utterance) + '」')
  if (sess.workspace) lines.push('- 工作区：' + safe(sess.workspace))
  if (sess.anchor && sess.anchor.node) lines.push('- 节点：' + safe(sess.anchor.node))
  if (sess.conclusion) {
    lines.push('- 收敛方向：**' + safe(sess.conclusion.winner) + '**')
    if (typeof sess.conclusion.confidence === 'number') {
      lines.push('- 置信度：' + sess.conclusion.confidence.toFixed(2))
    }
  }
  if (sess.directions && sess.directions.length) {
    lines.push('- 拟合方向：' + sess.directions.map((d) => safe(d.label || d.id)).join(' / '))
  }
  const rounds = sess.rounds || []
  if (rounds.length) {
    lines.push('- 问答轨迹：')
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i]
      lines.push('  ' + (i + 1) + '. ' + safe(r.summary || (r.questions || []).map((q) => q.question).join('；')))
    }
  }
  if (extra.note) lines.push('- ' + safe(extra.note))
  return lines.join('\n')
}
