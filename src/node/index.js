/**
 * dsh-memory-fitting — node 半边（宿主进程）v0.2.0
 *
 * 设计要点（用户明确要求）：
 *   - 上下文注入、记忆写入、工具暴露 三个"污染面"各自独立开关，默认全关
 *   - 插件自己的本地留档默认开
 *   - 绝不与其它插件产生耦合 bug：任何探测失败一律降级，不抛异常
 *
 * 本文件不安装任何 process 级 handler —— 与宿主共享进程，绝不做全局副作用。
 */
import * as store from './store.js'
import * as fitting from './fitting.js'
import { registerRoutes } from './routes.js'
import { writeToAutoMemory, buildConclusionNote } from './memory-adapter.js'
import { log, warn } from './log.js'

export const name = 'memory-fitting-pre'

/**
 * 只声明真正必需的宿主能力。
 * userQuestions 刻意【不】写进 inject：它是可选能力，
 * 缺失时插件应当照常加载并在调用处降级，而不是整个加载失败。
 */
export const inject = ['webServer', 'tools']

export function apply(ctx, config) {
  let toolDisposers = []
  let contextDisposer = null

  /* ── 工具面（开关 3） ── */

  function mountTools() {
    if (toolDisposers.length) return
    const defs = toolDefs(ctx)
    for (const def of defs) {
      try {
        const d = ctx.tools.register(def)
        if (typeof d === 'function') toolDisposers.push(d)
      } catch (e) {
        warn('tool register failed:', def.name, e && e.message)
      }
    }
    log('tools mounted:', defs.map((d) => d.name).join(', '))
  }

  function unmountTools() {
    for (const d of toolDisposers) {
      try { d() } catch { /* ignore */ }
    }
    toolDisposers = []
    log('tools unmounted')
  }

  /* ── 上下文注入（开关 1，污染面） ── */

  /**
   * 注入的是【祈使式 + 触发条件】的极短规则，不是描述。
   * 依据：模型对"背景资料"与"必须执行的约束"处理深度不同，
   * 同样的 token 数后者对输出的影响大得多（DESIGN.md §10.3）。
   */
  function mountContextSection() {
    if (contextDisposer) return
    try {
      const d = ctx.systemPrompt.section({
        name: 'dsh:memory-fitting',
        order: 9950,
        text: () =>
          [
            '当用户需求模糊、反复改口、或说「你帮我看着办」时：',
            '调用 memory_fit_start 启动一次意图拟合（先预定方向，再批量提问，收敛后提案）。',
            '拟合阶段只做意图理解与澄清，禁止执行任何实际动作；只有用户确认后才动手。',
          ].join('\n'),
      })
      contextDisposer = typeof d === 'function' ? d : null
      log('context section mounted')
    } catch (e) {
      warn('systemPrompt unavailable:', e && e.message)
    }
  }

  function unmountContextSection() {
    if (!contextDisposer) return
    try { contextDisposer() } catch { /* ignore */ }
    contextDisposer = null
    log('context section unmounted')
  }

  /** 按配置同步三个开关（幂等）。 */
  async function syncSwitches() {
    const cfg = await store.readConfig()
    if (cfg.exposeTools) mountTools()
    else unmountTools()
    if (cfg.injectContext) mountContextSection()
    else unmountContextSection()
    return cfg
  }

  /* ── 启动 ── */

  ctx.effect(() => {
    syncSwitches().catch((e) => warn('initial sync failed:', e && e.message))
    return () => {
      unmountTools()
      unmountContextSection()
    }
  }, 'dsh-memory-fitting: switches')

  try {
    registerRoutes(ctx, { syncSwitches })
  } catch (e) {
    warn('routes registration failed:', e && e.message)
  }
}

/* ══════════════════════════ 工具 ══════════════════════════ */

function textResult() {
  return {
    schema: { type: 'string' },
    render: (_args, v) => [{ type: 'text', text: String(v) }],
  }
}

function toolDefs(ctx) {
  return [fitStartTool(ctx), fitAskTool(ctx), fitArchiveTool(), fitHistoryTool()]
}

/** 载入会话（与 routes.js 共用同一套重建逻辑）。 */
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

function fitStartTool() {
  return {
    name: 'memory_fit_start',
    description:
      '启动一次「记忆拟合」：当用户需求模糊、自己也说不清要什么时，先预定 3-5 个可能的方向（预测其意图），再通过批量提问逐步收敛。仅做意图理解，不执行任何实际操作。收敛后需用户确认。',
    parameters: {
      type: 'object',
      properties: {
        utterance: { type: 'string', description: '触发本次拟合的用户原话或需求描述' },
        workspace: { type: 'string', description: '当前工作区路径，用于归档锚点' },
        node: { type: 'string', description: '工作节点名（可留空，收敛后回填）' },
        directions: {
          type: 'array',
          description: '你预定的方向，3-5 个。每个含 label 与 detail（若成立会有什么表现）',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, detail: { type: 'string' } },
            required: ['label'],
          },
        },
      },
      required: ['utterance'],
    },
    output: textResult(),
    timeoutMs: 30000,
    async execute(args) {
      const cfg = await store.readConfig()
      if (!cfg.localArchive) {
        return '本地留档当前处于关闭状态（memory-fitting 设置页可开）。已忽略本次拟合启动，以免产生无处存放的会话。'
      }
      const sess = await fitting.beginFitting({
        workspace: String(args?.workspace || ''),
        utterance: String(args?.utterance || ''),
        anchor: { node: args?.node ? String(args.node) : null },
      })
      if (Array.isArray(args?.directions) && args.directions.length) {
        await fitting.recordDirections(sess, args.directions)
      }
      log('fit started:', sess.id)
      const d = (sess.directions || []).map((x, i) => (i + 1) + '. ' + x.label).join('\n')
      return [
        '拟合会话已建立：' + sess.id,
        d ? '你预定的方向：\n' + d : '（尚未预定方向，请先写下 3-5 个方向）',
        '',
        '下一步：调用 memory_fit_ask 提出本轮 2-4 个问题（会暂停等待用户作答）。',
      ].join('\n')
    },
  }
}

/**
 * 核心工具：一次问一批，等用户作答。
 * 走 ctx.userQuestions.ask()，不经过模型、不占 tool-call 轮次。
 * agent 作为可选透传：子代理场景交给全局 waterfall 兜底，不硬撞 DELEGATED_CALLER。
 */
function fitAskTool(ctx) {
  return {
    name: 'memory_fit_ask',
    description:
      '在拟合会话中提出一轮问题（2-4 个），暂停并等待用户作答，返回全部答案。答案会写入本地留档。若用户中途取消，返回未完成状态。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'memory_fit_start 返回的会话 id' },
        questions: {
          type: 'array',
          description: '本轮要问的问题，2-4 个',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              header: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, description: { type: 'string' } },
                  required: ['label'],
                },
              },
              multiSelect: { type: 'boolean' },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['sessionId', 'questions'],
    },
    output: textResult(),
    timeoutMs: 600000,
    async execute(args, exec) {
      const sessionId = String(args?.sessionId || '')
      const questions = Array.isArray(args?.questions) ? args.questions : []
      if (!sessionId) return '缺少 sessionId。请先调用 memory_fit_start。'
      if (!questions.length) return '本轮没有问题可问。'

      const cfg = await store.readConfig()
      if (!cfg.localArchive) return '本地留档已关闭，拟合流程暂停。请在 memory-fitting 设置页开启「本地留档」。'

      // 轮数上限护栏：防止"问上瘾"
      const sess = await loadSession(sessionId)
      if (!sess) return '找不到会话 ' + sessionId + '（可能已被清理）。'
      if (sess.rounds.length >= cfg.maxRounds) {
        return '已达轮数上限（' + cfg.maxRounds + ' 轮）。请直接收敛提案，或由用户在悬窗调高上限。'
      }

      const uq = typeof ctx.get === 'function' ? ctx.get('userQuestions') : null
      if (!uq || typeof uq.ask !== 'function') {
        return '宿主没有提供 userQuestions 能力，无法向用户提问。请检查 dsh-tool-ask-user 是否启用。'
      }

      const capped = questions.slice(0, Math.max(1, Math.min(cfg.maxQuestionsPerRound, 8)))
      const round = await fitting.recordQuestions(sess, capped)
      let answers
      try {
        const res = await uq.ask({
          questions: capped.map((q) => ({
            id: String(q.id),
            question: String(q.question),
            ...(q.header ? { header: String(q.header) } : {}),
            ...(Array.isArray(q.options) ? { options: q.options } : {}),
            ...(q.multiSelect ? { multiSelect: true } : {}),
          })),
          ...(exec && exec.agent ? { agent: exec.agent } : {}),
          ...(exec && exec.signal ? { signal: exec.signal } : {}),
        })
        answers = res && res.answers ? res.answers : []
      } catch (e) {
        warn('ask failed:', e && e.message)
        return '用户未完成作答（' + (e && e.message ? e.message : 'cancelled') + '）。已答内容保留在本地留档。'
      }

      await fitting.recordAnswers(sess, round.index, answers)
      // 训练就绪的反馈三元组（DESIGN.md §10.7）：先采集，将来端侧可训练时直接用
      await fitting.recordFeedback(sess, {
        context: sess.utterance,
        modelDid: capped.map((q) => q.question).join(' / '),
        userSaid: (answers || []).map((a) => a.custom || (a.selected || []).join('、')).join(' / '),
        verdict: 'accepted',
        preference: '',
      }).catch(() => {})

      const lines = capped.map((q) => {
        const a = answers.find((x) => x.id === q.id)
        const picked = a ? (a.custom || (a.selected || []).join('、')) : '（未答）'
        return 'Q: ' + q.question + '\nA: ' + picked
      })
      return [
        '本轮（第 ' + round.index + ' 轮 / 上限 ' + cfg.maxRounds + '）作答结果：',
        lines.join('\n'),
        '',
        '下一步：更新方向与可信度（展示给用户），然后决定继续提问还是收敛提案。',
      ].join('\n')
    },
  }
}

function fitArchiveTool() {
  return {
    name: 'memory_fit_archive',
    description:
      '把一个拟合会话的收敛结论归档。本地留档始终写入；写入外部记忆插件受 writeMemory 开关控制（默认关闭）。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        winner: { type: 'string', description: '收敛到的方向' },
        intent: { type: 'string', description: '清晰的用户目标' },
        confidence: { type: 'number' },
        accepted: { type: 'boolean', description: '用户是否确认了该结论' },
        note: { type: 'string' },
      },
      required: ['sessionId', 'winner'],
    },
    output: textResult(),
    timeoutMs: 30000,
    async execute(args) {
      const sess = await loadSession(String(args?.sessionId || ''))
      if (!sess) return '找不到该会话。'
      await fitting.propose(sess, {
        winner: args.winner, confidence: args.confidence, intent: args.intent, text: args.note,
      })
      await fitting.finish(sess, { accepted: args.accepted !== false, note: args.note })
      const cfg = await store.readConfig()
      if (!cfg.writeMemory) {
        return '会话 ' + sess.id + ' 已写入本地留档。记忆写入开关处于关闭状态，未写入外部记忆插件（默认值，可在悬窗设置里打开）。'
      }
      const external = await writeToAutoMemory(buildConclusionNote(sess, { note: args.note }))
      return external.ok
        ? '会话 ' + sess.id + ' 已归档并写入记忆插件' + (external.sanitized ? '（安全改写 ' + external.sanitized + ' 处）' : '') + '。'
        : '会话 ' + sess.id + ' 已本地归档；记忆插件写入失败：' + external.reason + '（本地留档不受影响）。'
    },
  }
}

function fitHistoryTool() {
  return {
    name: 'memory_fit_history',
    description: '查看历史记忆拟合留档（最近若干条收敛结论）。用户问「上次关于 X 拟合出什么了」时调用。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '返回条数，默认 8，最大 30' } },
      required: [],
    },
    output: textResult(),
    timeoutMs: 15000,
    async execute(args) {
      const limit = Math.max(1, Math.min(Number(args?.limit) || 8, 30))
      const list = await store.listSessions()
      if (!list.length) return '还没有任何拟合留档。'
      return list.slice(0, limit).map((s) => {
        const w = s.title || (s.conclusion && s.conclusion.winner) || '（未收敛）'
        return '- [' + String(s.createdAt || '').slice(0, 16).replace('T', ' ') + '] ' + w +
          ' ← 「' + String(s.utterance || '').slice(0, 40) + '」 (' + s.status + ')'
      }).join('\n')
    },
  }
}
