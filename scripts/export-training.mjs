/**
 * 训练数据导出：把拟合留档导出为偏好对格式。
 *
 * 用法：
 *   node scripts/export-training.mjs                  # 导出全部
 *   node scripts/export-training.mjs --intent-only    # 只导出 scope=intent（推荐用于训练）
 *   node scripts/export-training.mjs --out data.jsonl
 *
 * 输出：JSONL，每行一个偏好对
 *   { prompt, chosen, rejected, verdict, scope, meta }
 *
 * 设计依据见 docs/TRAINING.md：训练时必须只取 scope=intent，
 * 否则会把用户的事实性错误学成偏好（谄媚）。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const intentOnly = args.includes('--intent-only')
const outIdx = args.indexOf('--out')
const outFile = outIdx >= 0 ? args[outIdx + 1] : 'training-pairs.jsonl'

const dir = join(homedir(), '.dsh', 'memory-fitting', 'sessions')

async function loadAll() {
  let names = []
  try { names = await readdir(dir) } catch { return [] }
  const sessions = []
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    try {
      const raw = await readFile(join(dir, n), 'utf8')
      const events = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      sessions.push({ file: n, events })
    } catch { /* skip */ }
  }
  return sessions
}

/** 从一次会话的事件流里重建 (轮次 → 模型做了什么 / 用户说了什么)。 */
function pairsFromSession(s) {
  const out = []
  let utterance = ''
  let directions = []
  const rounds = []
  let conclusion = null
  let finish = null

  for (const ev of s.events) {
    if (ev.type === 'fit/start') utterance = ev.utterance || ''
    if (ev.type === 'fit/directions') directions = ev.directions || []
    if (ev.type === 'fit/ask') rounds.push({ index: ev.round, questions: ev.questions || [], answers: null })
    if (ev.type === 'fit/answer') {
      const r = rounds.find((x) => x.index === ev.round)
      if (r) r.answers = ev.answers || []
    }
    if (ev.type === 'fit/propose') conclusion = ev.conclusion
    if (ev.type === 'fit/finish') finish = ev
  }

  // 每一轮：prompt = 触发语 + 已答历史；chosen = 用户实际作答；rejected = 「AI 若要问别的」
  // 这里采用更直接可用的形态：把「AI 提的问题」当 prompt，把「用户的选择」当 chosen。
  rounds.forEach((r) => {
    if (!r.answers || !r.answers.length) return
    for (let i = 0; i < r.questions.length; i++) {
      const q = r.questions[i]
      const a = r.answers.find((x) => x.id === q.id)
      if (!a) continue
      const chosen = a.custom || (a.selected || []).join('、')
      if (!chosen) continue
      const rejected = (q.options || []).map((o) => o.label).filter((l) => l !== chosen)
      if (!rejected.length) continue
      out.push({
        prompt: utterance + (r.index > 1 ? ' [第' + r.index + '轮]' : '') + '\n问：' + q.question,
        chosen,
        rejected,
        verdict: 'accepted',
        scope: 'intent',
        meta: { session: s.file, round: r.index, questionId: q.id, directions: directions.map((d) => d.label) },
      })
    }
  })

  // 收敛结论：prompt = 触发语；chosen = 收敛方向；rejected = 落选方向
  if (conclusion && conclusion.winner && directions.length > 1) {
    out.push({
      prompt: utterance + '\n（请判断用户最终想要哪一个方向）',
      chosen: conclusion.winner,
      rejected: directions.map((d) => d.label).filter((l) => l !== conclusion.winner),
      verdict: finish && finish.accepted ? 'accepted' : 'rejected',
      scope: 'intent',
      meta: { session: s.file, final: true, confidence: conclusion.confidence ?? null },
    })
  }
  return out
}

const sessions = await loadAll()
console.log('扫描到 ' + sessions.length + ' 个拟合会话')

let all = []
for (const s of sessions) all = all.concat(pairsFromSession(s))
if (intentOnly) all = all.filter((p) => p.scope === 'intent')

console.log('生成 ' + all.length + ' 条偏好对' + (intentOnly ? '（已过滤 scope=intent）' : ''))
if (!all.length) {
  console.log('')
  console.log('提示：偏好对来自「用户的真实作答」与「收敛结论」。')
  console.log('     如果留档里还没答过题，导不出东西。')
  process.exit(0)
}

const verdictCounts = {}
for (const p of all) verdictCounts[p.verdict] = (verdictCounts[p.verdict] || 0) + 1
console.log('verdict 分布: ' + JSON.stringify(verdictCounts))
const corrected = verdictCounts.corrected || 0
console.log('纠正率: ' + ((corrected / all.length) * 100).toFixed(1) + '%  ← 这个数字越高，样本越有信息量')

await writeFile(outFile, all.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8')
console.log('')
console.log('已写出 -> ' + outFile)
