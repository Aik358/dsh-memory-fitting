/**
 * 记忆拟合 — 拟合循环（node 侧核心逻辑）
 *
 * 定稿机制（DESIGN.md §2.6）：
 *   ① 预判    AI 先写下 3-5 个"你可能想要的方向"
 *   ② 出题    针对"方向的差异"设计本轮 2-4 个问题
 *   ③ 问一批  ctx.userQuestions.ask({questions:[...]}) 一次问一批
 *   ④ 思考    消化本轮全部回答 → 更新方向（升降/淘汰/新增/合并），并展示
 *   ⑤ 提案    "我理解你要的是 X"，附落选方向
 *   ⑥ 确认 → 归档
 *
 * 本模块只做【状态推进与留档】，不直接调用模型；模型交互由工具/路由层驱动。
 * 这样保证：即使模型侧失败，已答内容也不丢（append-only）。
 */
import * as store from './store.js'

/** 新建一个拟合会话（尚未开始提问）。 */
export async function beginFitting({ workspace, utterance, anchor }) {
  const sess = await store.createSession({ workspace, utterance, anchor })
  await store.upsertIndex(sess)
  return sess
}

/** 记录「预判方向」这一步。 */
export async function recordDirections(sess, directions) {
  sess.directions = (directions || []).map((d, i) => ({
    id: d.id || 'd' + (i + 1),
    label: String(d.label || '').slice(0, 120),
    detail: d.detail ? String(d.detail).slice(0, 400) : '',
    confidence: typeof d.confidence === 'number' ? d.confidence : null,
  }))
  await store.appendEvent(sess, { type: 'fit/directions', directions: sess.directions })
  await store.upsertIndex(sess)
  return sess.directions
}

/** 记录本轮提出的问题。 */
export async function recordQuestions(sess, questions) {
  const round = {
    index: sess.rounds.length + 1,
    questions: (questions || []).map((q, i) => ({
      id: q.id || 'q' + (i + 1),
      question: String(q.question || '').slice(0, 500),
      options: Array.isArray(q.options) ? q.options.slice(0, 8).map((o) => ({ label: String(o.label || o).slice(0, 120) })) : [],
      multiSelect: !!q.multi_select,
    })),
    answers: null,
    summary: '',
  }
  sess.rounds.push(round)
  await store.appendEvent(sess, { type: 'fit/ask', round: round.index, questions: round.questions })
  await store.upsertIndex(sess)
  return round
}

/** 记录本轮的回答（ctx.userQuestions.ask 的返回）。 */
export async function recordAnswers(sess, roundIndex, answers) {
  const round = sess.rounds.find((r) => r.index === roundIndex) || sess.rounds[sess.rounds.length - 1]
  if (!round) return null
  round.answers = (answers || []).map((a) => ({
    id: a.id,
    selected: Array.isArray(a.selected) ? a.selected.map(String) : [],
    custom: a.custom ? String(a.custom).slice(0, 500) : null,
  }))
  round.summary = round.questions
    .map((q) => {
      const a = round.answers.find((x) => x.id === q.id)
      const picked = a ? (a.custom || (a.selected || []).join('、')) : '（未答）'
      return q.question + ' → ' + picked
    })
    .join('；')
  await store.appendEvent(sess, { type: 'fit/answer', round: roundIndex, answers: round.answers, summary: round.summary })
  await store.upsertIndex(sess)
  return round
}

/** 记录轮间思考对方向列表的更新。 */
export async function recordReflection(sess, { roundIndex, directions, rationale }) {
  if (Array.isArray(directions) && directions.length) {
    sess.directions = directions.map((d, i) => ({
      id: d.id || 'd' + (i + 1),
      label: String(d.label || '').slice(0, 120),
      detail: d.detail ? String(d.detail).slice(0, 400) : '',
      confidence: typeof d.confidence === 'number' ? d.confidence : null,
    }))
  }
  await store.appendEvent(sess, {
    type: 'fit/reflect',
    round: roundIndex,
    directions: sess.directions,
    rationale: rationale ? String(rationale).slice(0, 1000) : '',
  })
  await store.upsertIndex(sess)
  return sess.directions
}

/** 收敛提案。 */
export async function propose(sess, conclusion) {
  sess.conclusion = {
    winner: String(conclusion.winner || '').slice(0, 200),
    confidence: typeof conclusion.confidence === 'number' ? conclusion.confidence : null,
    intent: conclusion.intent ? String(conclusion.intent).slice(0, 500) : '',
    action: conclusion.action ? String(conclusion.action).slice(0, 500) : '',
    text: conclusion.text ? String(conclusion.text).slice(0, 800) : '',
  }
  sess.status = 'proposed'
  await store.appendEvent(sess, { type: 'fit/propose', conclusion: sess.conclusion })
  await store.upsertIndex(sess)
  return sess.conclusion
}

/** 收尾：确认 / 放弃。 */
export async function finish(sess, { accepted, note }) {
  sess.status = accepted ? 'accepted' : 'dismissed'
  await store.appendEvent(sess, { type: 'fit/finish', accepted: !!accepted, note: note ? String(note).slice(0, 500) : '' })
  await store.upsertIndex(sess)
  return sess
}

/**
 * fit/feedback —— 训练就绪的三元组（DESIGN.md §10.7）。
 * 将来端侧模型可训练时直接可用；现在只采集。
 */
export async function recordFeedback(sess, { context, modelDid, userSaid, verdict, preference }) {
  await store.appendEvent(sess, {
    type: 'fit/feedback',
    context: String(context || '').slice(0, 800),
    modelDid: String(modelDid || '').slice(0, 800),
    userSaid: String(userSaid || '').slice(0, 800),
    verdict: ['accepted', 'corrected', 'rejected'].includes(verdict) ? verdict : 'accepted',
    preference: String(preference || '').slice(0, 400),
  })
  return true
}
