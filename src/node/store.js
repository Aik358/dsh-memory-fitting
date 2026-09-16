/**
 * 记忆拟合 — 本地存储层
 *
 * 设计原则（用户要求）：
 *   - 上下文注入与记忆写入都是【独立开关】，默认关闭
 *   - 插件自己的存储（本地 JSONL 留档）是插件的根本，用户选择处就要能打开
 *   - 不与其它插件造成耦合 bug
 *
 * 目录布局（全部在 ~/.dsh/memory-fitting/）：
 *   config.json                    插件配置
 *   sessions/<yyyyMMdd-HHmmss>-<id>.jsonl   拟合会话全过程（append-only）
 *   sessions/index.json            会话索引（供悬窗列表快速渲染）
 */
import { readFile, writeFile, mkdir, readdir, appendFile, rename, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

/**
 * 数据根目录。
 * 默认 ~/.dsh/memory-fitting，可用环境变量 MEMORY_FITTING_ROOT 覆盖 ——
 * 既方便用户换位置，也让自动化测试指向临时目录（不污染真实留档）。
 */
export function rootDir() {
  const override = process.env.MEMORY_FITTING_ROOT
  if (override && String(override).trim()) return String(override).trim()
  return join(homedir(), '.dsh', 'memory-fitting')
}
export function sessionsDir() {
  return join(rootDir(), 'sessions')
}
export function configPath() {
  return join(rootDir(), 'config.json')
}
export function indexPath() {
  return join(sessionsDir(), 'index.json')
}

/**
 * 默认配置。
 * ⚠️ 两个"污染面"开关一律默认 false —— 这是用户明确要求的默认值。
 */
export const DEFAULT_CONFIG = {
  // 是否允许把拟合状态注入到会话上下文（污染面 1）
  injectContext: false,
  // 是否把收敛结论写入记忆插件（污染面 2）
  writeMemory: false,
  // 是否注册模型可见的工具（注册即每轮占 tool schema 上下文）
  exposeTools: false,
  // 插件自己的本地留档（用户选择处可开）
  localArchive: true,
  // 悬窗 UI
  panelOpenByDefault: false,
  // 记住悬窗上次的开合状态（关掉则每次重启都收起）
  persistPanelOpen: true,
  // 每轮最多几个问题 / 整场最多几轮
  maxQuestionsPerRound: 4,
  maxRounds: 4,
}

let cachedConfig = null
let cachedFor = null

export async function readConfig() {
  // 缓存按根目录区分 —— 否则测试与真实环境会串用同一份缓存
  const dir = rootDir()
  if (cachedConfig && cachedFor === dir) return cachedConfig
  cachedFor = dir
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG }
  }
  return cachedConfig
}

export async function writeConfig(patch) {
  const cur = await readConfig()
  const next = { ...cur, ...patch }
  await mkdir(rootDir(), { recursive: true })
  await writeFile(configPath(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  cachedConfig = next
  cachedFor = rootDir()
  return next
}

export function newSessionId() {
  return 'fit_' + randomBytes(6).toString('hex')
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  )
}

/** 开一条会话：创建 JSONL 文件并写入首帧。 */
export async function createSession(meta) {
  await mkdir(sessionsDir(), { recursive: true })
  const id = meta.id || newSessionId()
  const file = join(sessionsDir(), stamp() + '-' + id + '.jsonl')
  const sess = {
    id,
    file,
    createdAt: new Date().toISOString(),
    workspace: meta.workspace || null,
    utterance: meta.utterance || '',
    anchor: meta.anchor || null,
    rounds: [],
    directions: [],
    status: 'fitting',
    conclusion: null,
  }
  await appendEvent(sess, { type: 'fit/start', workspace: sess.workspace, utterance: sess.utterance, anchor: sess.anchor })
  return sess
}

/** append-only 追加一帧。绝不重写整个文件。 */
export async function appendEvent(sess, event) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n'
  await appendFile(sess.file, line, 'utf8')
}

/** 更新索引（供悬窗列表渲染）。索引本身可重建，损坏不影响会话文件。 */
export async function upsertIndex(sess) {
  const idx = await listSessions()
  const prev = idx.find((x) => x.id === sess.id) || {}
  const entry = {
    id: sess.id,
    file: sess.file,
    createdAt: sess.createdAt,
    updatedAt: new Date().toISOString(),
    workspace: sess.workspace,
    utterance: sess.utterance,
    status: sess.status,
    rounds: sess.rounds.length,
    conclusion: sess.conclusion,
    // 保留用户手动补的标题（拟合后回填节点名）
    title: prev.title || null,
  }
  const i = idx.findIndex((x) => x.id === sess.id)
  if (i >= 0) idx[i] = entry
  else idx.unshift(entry)
  await writeIndex(idx)
  return idx
}

/** 原子写索引：先写 .tmp 再 rename，避免半截文件。 */
export async function writeIndex(idx) {
  await mkdir(sessionsDir(), { recursive: true })
  const trimmed = (Array.isArray(idx) ? idx : []).slice(0, 200)
  const tmp = indexPath() + '.tmp'
  await writeFile(tmp, JSON.stringify(trimmed, null, 2) + '\n', 'utf8')
  await rename(tmp, indexPath())
  return trimmed
}

/** 删除一条留档（会话文件 + 索引项）。索引损坏时也尽力删文件。 */
export async function deleteSession(id) {
  if (!id) return { ok: false, reason: 'missing-id' }
  const idx = await listSessions()
  const entry = idx.find((x) => x.id === id)
  if (!entry) return { ok: false, reason: 'not-found' }
  try {
    if (entry.file && existsSync(entry.file)) await unlink(entry.file)
  } catch (e) {
    return { ok: false, reason: 'unlink-failed: ' + (e && e.message) }
  }
  await writeIndex(idx.filter((x) => x.id !== id))
  return { ok: true, id }
}

export async function listSessions() {
  try {
    const idx = JSON.parse((await readFile(indexPath(), 'utf8')).replace(/^\uFEFF/, ''))
    return Array.isArray(idx) ? idx : []
  } catch {
    return []
  }
}

/** 读一条会话的完整事件流（悬窗详情用）。 */
export async function readSession(file) {
  try {
    const raw = await readFile(file, 'utf8')
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function sessionsOnDisk() {
  try {
    const names = await readdir(sessionsDir())
    return names.filter((n) => n.endsWith('.jsonl'))
  } catch {
    return []
  }
}

export { existsSync }
