/**
 * HTTP 路由 —— 单 prefix 入口。
 *
 * 为什么不用多条 exact 路由：
 *   WebRoute 的契约是 { path, handler }，**没有 method 字段**
 *   （dsh-host-webserver/lib/types/index.d.ts:33-38）。
 *   注册多条 exact 需要每个 URL 一个独立 path，且无法按 method 区分。
 *   对齐参考实现（dsh-literature routes.js:548）改用一个 prefix，
 *   在内部自行做 method + path 分发。
 *
 * 所有 handler 都只读/写插件自己的目录，不触碰宿主或其它插件状态。
 */
import { readFile } from 'node:fs/promises'
import { guard, log, warn } from './log.js'
import * as store from './store.js'
import * as fitting from './fitting.js'
import { detectMemoryPlugins, autoMemoryAlive, writeToAutoMemory, buildConclusionNote } from './memory-adapter.js'
import { selfTest as sanitizeSelfTest } from './sanitize.js'

const PREFIX = '/api/memory-fitting'

function pathOf(req) {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1')
  return u.pathname
}

function writeJson(res, code, body) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) req.destroy()
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export function registerRoutes(ctx, deps) {
  const { syncSwitches } = deps
  const handler = guard('route', async (req, res) => {
    const path = pathOf(req)
    const method = req.method || 'GET'
    const rel = path.slice(PREFIX.length) || '/'

    // GET /state —— 悬窗一次性拉取
    if (method === 'GET' && rel === '/state') {
      const [config, sessions, detected, alive] = await Promise.all([
        store.readConfig(),
        store.listSessions(),
        detectMemoryPlugins(),
        autoMemoryAlive(),
      ])
      return writeJson(res, 200, {
        ok: true, config, sessions, detected,
        autoMemoryAlive: alive,
        sanitize: sanitizeSelfTest(),
        version: '0.1.0',
      })
    }

    // GET /sessions
    if (method === 'GET' && rel === '/sessions') {
      return writeJson(res, 200, { ok: true, sessions: await store.listSessions() })
    }

    // GET /session?id=...
    if (method === 'GET' && rel === '/session') {
      const url = new URL(req.url, 'http://127.0.0.1')
      const id = url.searchParams.get('id')
      const list = await store.listSessions()
      const entry = list.find((s) => s.id === id)
      if (!entry) return writeJson(res, 404, { ok: false, error: 'not-found' })
      const events = await store.readSession(entry.file)
      return writeJson(res, 200, { ok: true, entry, events })
    }

    // GET /detect
    if (method === 'GET' && rel === '/detect') {
      return writeJson(res, 200, { ok: true, detected: await detectMemoryPlugins(), alive: await autoMemoryAlive() })
    }

    // POST /config
    if (method === 'POST' && rel === '/config') {
      const body = await readBody(req)
      const allowed = ['injectContext', 'writeMemory', 'exposeTools', 'localArchive', 'panelOpenByDefault', 'persistPanelOpen', 'maxQuestionsPerRound', 'maxRounds']
      const patch = {}
      for (const k of allowed) if (k in body) patch[k] = body[k]
      const next = await store.writeConfig(patch)
      await syncSwitches()
      log('config updated:', JSON.stringify(patch))
      return writeJson(res, 200, { ok: true, config: next })
    }

    // POST /start —— 从悬窗直接开一次拟合
    if (method === 'POST' && rel === '/start') {
      const body = await readBody(req)
      const sess = await fitting.beginFitting({
        workspace: String(body.workspace || ''),
        utterance: String(body.utterance || ''),
        anchor: body.node ? { node: String(body.node) } : null,
      })
      if (Array.isArray(body.directions) && body.directions.length) {
        await fitting.recordDirections(sess, body.directions)
      }
      log('fit started from panel:', sess.id)
      return writeJson(res, 200, { ok: true, session: { id: sess.id, file: sess.file, createdAt: sess.createdAt } })
    }

    // POST /archive
    if (method === 'POST' && rel === '/archive') {
      const body = await readBody(req)
      const sess = await loadSession(String(body.sessionId || ''))
      if (!sess) return writeJson(res, 404, { ok: false, error: 'not-found' })
      await fitting.propose(sess, { winner: body.winner, confidence: body.confidence, intent: body.intent, text: body.note })
      await fitting.finish(sess, { accepted: body.accepted !== false, note: body.note })
      const cfg = await store.readConfig()
      let external = { ok: false, reason: 'disabled' }
      if (cfg.writeMemory) external = await writeToAutoMemory(buildConclusionNote(sess, { note: body.note }))
      return writeJson(res, 200, { ok: true, local: true, external, writeMemory: cfg.writeMemory })
    }

    // POST /rename —— 给留档补一个可读标题（拟合后回填节点名，DESIGN.md §4.2 方案③）
    if (method === 'POST' && rel === '/rename') {
      const body = await readBody(req)
      const list = await store.listSessions()
      const entry = list.find((s) => s.id === String(body.sessionId || ''))
      if (!entry) return writeJson(res, 404, { ok: false, error: 'not-found' })
      entry.title = String(body.title || '').slice(0, 120)
      await store.writeIndex(list)
      return writeJson(res, 200, { ok: true, entry })
    }

    // DELETE /session?id=... —— 删除一条留档
    if (method === 'DELETE' && rel === '/session') {
      const url = new URL(req.url, 'http://127.0.0.1')
      const id = url.searchParams.get('id')
      const res2 = await store.deleteSession(id)
      return writeJson(res2.ok ? 200 : 404, res2)
    }

    return writeJson(res, 404, { ok: false, error: 'unknown-route', path: rel, method })
  })

  try {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler })
    log('routes registered at', PREFIX)
    return typeof dispose === 'function' ? [dispose] : []
  } catch (e) {
    warn('route registration failed:', e && e.message)
    return []
  }
}

/* ── 会话按 id 载入 ── */
async function loadSession(id) {
  const list = await store.listSessions()
  const entry = list.find((s) => s.id === id)
  if (!entry) return null
  const events = await store.readSession(entry.file)
  const sess = {
    id: entry.id, file: entry.file, createdAt: entry.createdAt,
    workspace: entry.workspace, utterance: entry.utterance,
    anchor: null, rounds: [], directions: [], status: entry.status, conclusion: entry.conclusion,
  }
  for (const ev of events) {
    if (ev.type === 'fit/start') { sess.anchor = ev.anchor; sess.workspace = ev.workspace ?? sess.workspace }
    if (ev.type === 'fit/directions') sess.directions = ev.directions || []
    if (ev.type === 'fit/ask') sess.rounds.push({ index: ev.round, questions: ev.questions || [], answers: null, summary: '' })
    if (ev.type === 'fit/answer') {
      const r = sess.rounds.find((x) => x.index === ev.round)
      if (r) { r.answers = ev.answers; r.summary = ev.summary || '' }
    }
    if (ev.type === 'fit/propose') sess.conclusion = ev.conclusion
  }
  return sess
}
