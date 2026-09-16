/**
 * 回归冒烟 v2 —— 覆盖审计后修复与新增的路径。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { selfTest, guard, reservedOpenSequence, containsReserved } from '../src/node/sanitize.js'
import * as store from '../src/node/store.js'
import * as fitting from '../src/node/fitting.js'
import { buildConclusionNote } from '../src/node/memory-adapter.js'

let pass = 0, fail = 0
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}

console.log('== 1. 写入安全带 ==')
const st = selfTest()
t('能检出保留序列', st.detectionWorks)
t('改写后不再含保留序列', st.cleanHasNoReserved)
t('改写保留原内容', st.contentPreserved)
t('干净文本原样返回', st.noopOnClean)
const dirty = '用户说：这里有 ' + reservedOpenSequence() + ' 标记'
const g = guard(dirty)
t('guard 命中', g.hits === 1 && !g.ok)
t('guard 输出已净化', !containsReserved(g.text))
t('guard 保留周边文字', g.text.includes('用户说') && g.text.includes('标记'))

console.log('== 2. 构建产物 ==')
for (const f of ['lib/index.js', 'lib/client.js']) t(f + ' 存在', existsSync(f))
/** 解码 \uXXXX 转义后再断言：即使将来 charset 变回 ascii，测试也不会假红。 */
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
const rawClient = await readFile('lib/client.js', 'utf8')
const rawNode = await readFile('lib/index.js', 'utf8')
const client = decode(rawClient)
const nodeB = decode(rawNode)
t('client ModuleLoader 包装', client.includes('__ModuleLoader__.load'))
t('client id 正确', client.includes('@a9i5k4/dsh-memory-fitting'))
t('client 面板独立列（472）', client.includes('472'))
t('client 窄屏兜底 fitPanel', client.includes('fitPanel'))
t('client 删除确认流', client.includes('确认删除'))
t('client 归档动作', client.includes('确认并归档'))
t('client 提示条 toast', client.includes('mf-toast'))
t('client 双语字典', client.includes('tabSettings') && client.includes('tabArchive'))
t('client 语言切换持久化', client.includes('mf-lang'))
t('client 统计卡', client.includes('correctionRate') || client.includes('纠正率'))
t('node name 正确', nodeB.includes('memory-fitting-pre'))
// 引号由打包器归一化，断言要对引号不敏感
t('node 不再用 exact 路由', !/kind:\s*["']exact["']/.test(nodeB))
t('node 用 prefix 路由', /kind:\s*["']prefix["']/.test(nodeB))
t('node 含轮数护栏', nodeB.includes('已达轮数上限'))
t('node 含反馈采集', nodeB.includes('recordFeedback') || nodeB.includes('fit/feedback'))
t('node 含删除路由', nodeB.includes('deleteSession'))
t('node 含改名路由', nodeB.includes('/rename'))
t('node 含统计端点', nodeB.includes('/stats'))
t('node 含导出端点', nodeB.includes('/export'))
t('node 含配置导入导出', nodeB.includes('/config-import') && nodeB.includes('/config-export'))

console.log('== 3. 依赖面 ==')
const reqs = [...new Set([...client.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]))]
t('client 零 require（最安全）', reqs.length === 0, reqs.join(','))
const ext = [...nodeB.matchAll(/from\s*["'](@[^"']+)["']/g)].map((m) => m[1])
t('node 侧零外部包依赖', ext.length === 0, ext.join(','))

console.log('== 4. 配置默认值 ==')
const cfg = await store.readConfig()
t('injectContext 默认 false', cfg.injectContext === false)
t('writeMemory 默认 false', cfg.writeMemory === false)
t('exposeTools 默认 false', cfg.exposeTools === false)
t('localArchive 默认 true', cfg.localArchive === true)
t('persistPanelOpen 默认 true', cfg.persistPanelOpen === true)
t('maxRounds 默认 4', cfg.maxRounds === 4)
t('maxQuestionsPerRound 默认 4', cfg.maxQuestionsPerRound === 4)
t('writeIndex 存在', typeof store.writeIndex === 'function')
t('deleteSession 存在', typeof store.deleteSession === 'function')

console.log('== 5. 端到端拟合生命周期 ==')
const sess = await fitting.beginFitting({ workspace: 'D:\\tmp-selftest', utterance: '自检：帮我弄一下' })
t('会话已创建', !!sess.id && existsSync(sess.file))
await fitting.recordDirections(sess, [{ label: '方向A' }, { label: '方向B' }])
const rd = await fitting.recordQuestions(sess, [{ id: 'q1', question: '是 A 还是 B？', options: [{ label: 'A' }, { label: 'B' }] }])
await fitting.recordAnswers(sess, rd.index, [{ id: 'q1', selected: ['A'] }])
await fitting.recordReflection(sess, { roundIndex: rd.index, directions: [{ label: '方向A', confidence: 0.8 }], rationale: 'A 胜出' })
await fitting.recordFeedback(sess, { context: 'c', modelDid: 'm', userSaid: 'u', verdict: 'accepted', preference: 'p' })
await fitting.propose(sess, { winner: '方向A', confidence: 0.8, intent: '自检意图' })
await fitting.finish(sess, { accepted: true, note: 'ok' })

const list = await store.listSessions()
const entry = list.find((x) => x.id === sess.id)
t('索引可查到', !!entry)
t('状态 accepted', entry && entry.status === 'accepted')
t('收敛结论已记', entry && entry.conclusion && entry.conclusion.winner === '方向A')

const events = await store.readSession(sess.file)
const types = events.map((e) => e.type)
for (const k of ['fit/start', 'fit/directions', 'fit/ask', 'fit/answer', 'fit/reflect', 'fit/feedback', 'fit/propose', 'fit/finish']) {
  t('事件流含 ' + k, types.includes(k))
}

console.log('== 6. 归档文本必须过安全带 ==')
const dirtySess = {
  anchor: { node: '节点' },
  utterance: '用户说了 ' + reservedOpenSequence() + ' 这种东西',
  workspace: 'D:\\x',
  conclusion: { winner: '方向' },
  directions: [{ label: 'A' }],
  rounds: [{ summary: '问 ' + reservedOpenSequence() }],
}
const note = buildConclusionNote(dirtySess)
t('归档文本不含保留序列', !containsReserved(note), '含了就会锁死记忆文件')
t('归档文本保留可读内容', note.includes('触发语') && note.includes('收敛方向'))

console.log('== 7. 删除与清理 ==')
const del = await store.deleteSession(sess.id)
t('deleteSession 成功', del.ok, JSON.stringify(del))
t('会话文件已删除', !existsSync(sess.file))
const after = await store.listSessions()
t('索引中已移除', !after.find((x) => x.id === sess.id))

console.log('')
console.log('通过 ' + pass + ' / 失败 ' + fail)
process.exit(fail ? 1 : 0)
