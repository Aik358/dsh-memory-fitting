/* dsh-memory-fitting — browser half v0.2.0
 *
 * 界面：右下角悬窗（设置页为默认页）+ 留档浏览 + 发起拟合。
 *
 * ── 位置策略（审计后重写）────────────────────────────────────────────
 * 右下角实测是一个"摞"：
 *   dsh-cua FAB    right:16 bottom:96   z-9998   (dsh-cua-pre/lib/client.js:1008)
 *   dsh-cua 面板   right:16 bottom:152  z-9997   (:746)
 *   Ark9 FAB       right:16 bottom:96|148 z-9998 (ark9canvas/lib/client.js:986,941)
 *   Ark9 面板      right:16 bottom:152|204 z-9997 (:950,942)
 * 它们彼此用「探测对方 FAB 是否存在」来栈叠，但**互不感知**，位置已经很挤。
 *
 * 本插件策略：不加入那个摞，改为【独立列】——
 *   FAB   right:16  bottom:16   z-9996   ← 摞的最底部，压不到任何人的 FAB
 *   面板  right:472 bottom:16   z-9995   ← 停在右侧那一列的【左边】，纵向拉满
 * 面板从底部 16px 起、高度 min(78vh,660px)，因此与 right:16 那一列完全错开，
 * 无论对方开不开面板都不会重叠。
 *
 * ── 其它 ─────────────────────────────────────────────────────────
 * 零 require：不碰宿主 seed 表，彻底规避"漏一个 require 整个插件加载失败"。
 */
var API = {
  state: '/api/memory-fitting/state',
  stats: '/api/memory-fitting/stats',
  config: '/api/memory-fitting/config',
  session: '/api/memory-fitting/session',
  deleteSession: '/api/memory-fitting/session',
  start: '/api/memory-fitting/start',
  export: '/api/memory-fitting/export',
  configExport: '/api/memory-fitting/config-export',
  configImport: '/api/memory-fitting/config-import',
  archive: '/api/memory-fitting/archive',
  rename: '/api/memory-fitting/rename',
}

function req(path, opts) {
  return fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}))
    .then(function (r) { return r.json() })
}

var CHANNEL = 'memory-fitting'

/* ───────────────── 双语 UI ─────────────────
 * 与 README / USER-GUIDE 的双语体系对齐。语言选择持久化在 localStorage，
 * 与插件配置解耦（改 UI 语言不应触发服务端写盘）。
 */
var STR = {
  zh: {
    title: '记忆拟合', tabSettings: '设置', tabArchive: '留档', tabFit: '开始拟合',
    inject: '注入', mem: '记忆', on: '开', off: '关', loading: '加载中…',
    err: '错误：', refresh: '刷新', export: '导出偏好对', exporting: '导出中…',
    swInject: '注入会话上下文', swInjectD: '每轮注入一段极短说明，让模型知道可主动发起拟合。开启才有 token 开销',
    swMem: '写入记忆插件', swMemD: '把收敛结论写进 dsh-auto-memory。默认关闭以避免耦合',
    swTools: '向模型暴露工具', swToolsD: '模型可见 memory_fit_* 工具。注册即占每轮 tool 上下文',
    swArch: '本地留档', swArchD: '拟合全过程写入 ~/.dsh/memory-fitting/sessions/（隔离于其它插件）',
    swPersist: '记住悬窗开合', swPersistD: '关闭则每次启动都收起悬窗',
    secSurface: '污染面开关 · 默认关闭', secStore: '本插件自己的存储', secParams: '拟合参数', secEnv: '环境自检',
    pQ: '每轮问题数上限', pQD: '一轮最多问几个问题',
    pR: '整场轮数上限', pRD: '防止"问上瘾"，默认 4 轮封顶',
    amName: 'dsh-auto-memory', amNone: '未检测到（不影响本地留档）',
    amAlive: '已检测到 · 实例存活', amDead: '已检测到 · 实例未响应',
    sbName: '写入安全带', sbDesc: '归档前对用户原话做字符级改写，防止锚点击穿记忆文件',
    ok: '通过', bad: '异常', okShort: 'OK', none: '—',
    empty: '还没有留档。\n到「开始拟合」页发起一次。',
    back: '← 返回列表', confirmArch: '确认并归档', archiving: '归档中…',
    rename: '改标题', renamePrompt: '给这条留档起个可读标题（拟合后回填节点名）',
    del: '删除', delQ: '删除这条留档？会话文件与索引项都会被移除，不可恢复。',
    delYes: '确认删除', delNo: '取消', deleting: '删除中…',
    stAccepted: '已确认', stProposed: '待确认', stFitting: '进行中', stDismissed: '已放弃',
    fitTitle: '发起一次拟合', fitHint: '写下触发语 → 开始 → 到聊天窗口回答模型提出的问题。',
    fitPh: '例如：帮我把记忆这部分弄好一点，感觉不太行。',
    fitStart: '立即开始', fitStartD: '在本地建立拟合会话并记入留档', fitGo: '开始', fitCreating: '创建中…',
    fitViaAi: '让 AI 主动发起',
    fitViaAiOn: '已开启工具暴露：直接对 AI 说「我还没想清楚，帮我拟合一下意图」即可。',
    fitViaAiOff: '工具暴露当前关闭（默认）。到设置页打开「向模型暴露工具」，或直接在本页发起。',
    flow: '拟合流程',
    flowText: '① AI 预定 3-5 个方向（预测你的意图）\n② 每轮针对"分不开的方向"提 2-4 个问题\n③ 一次问一批，你逐个作答\n④ 轮间思考并展示方向可信度\n⑤ 收敛后提案，你确认 → 归档',
    statLine: function (a, r) { return '已答 ' + a + ' 题 · 纠正率 ' + r + '%' },
    statGood: '样本有信息量（纠正率越高越值得训练）',
    statLow: '纠正率偏低 —— 说明模型大多猜对了，样本信息量有限',
    evCount: '事件流 · ', evFrames: ' 帧', evEmpty: '（空）',
    needUtterance: '请先写下触发语', createFail: '创建失败', netErr: '网络错误',
    saveFail: '设置保存失败', copied: ' 条偏好对到剪贴板', clipboardNo: '剪贴板不可用',
    noPairs: '还没有可导出的偏好对（需要先答过题）',
    tooltipOpen: '记忆拟合', tooltipClose: '关闭面板（留档不受影响）', tooltipSwitch: '点击切换',
    posReset: '面板位置已复位', dragHint: '拖动标题栏可移动 · 双击复位',
  },
  en: {
    title: 'Memory Fitting', tabSettings: 'Settings', tabArchive: 'Archive', tabFit: 'New fitting',
    inject: 'Inject', mem: 'Memory', on: 'on', off: 'off', loading: 'Loading…',
    err: 'Error: ', refresh: 'Refresh', export: 'Export pairs', exporting: 'Exporting…',
    swInject: 'Inject session context', swInjectD: 'One short note per turn so the model knows it may start a fitting. Costs tokens only when on.',
    swMem: 'Write to memory plugin', swMemD: 'Write the converged conclusion into dsh-auto-memory. Off by default to avoid coupling.',
    swTools: 'Expose tools to the model', swToolsD: 'The model can see the memory_fit_* tools. Registration costs tool-schema context every turn.',
    swArch: 'Local archive', swArchD: 'Write the whole fitting to ~/.dsh/memory-fitting/sessions/ (isolated from other plugins)',
    swPersist: 'Remember panel state', swPersistD: 'Off means the panel starts collapsed every launch',
    secSurface: 'Contamination surface · all off by default', secStore: 'This plugin\'s own storage', secParams: 'Fitting parameters', secEnv: 'Environment check',
    pQ: 'Max questions per round', pQD: 'How many questions one round may contain',
    pR: 'Max rounds', pRD: 'Guards against asking forever; 4 by default',
    amName: 'dsh-auto-memory', amNone: 'not detected (local archive unaffected)',
    amAlive: 'detected · instance alive', amDead: 'detected · instance not responding',
    sbName: 'Write seatbelt', sbDesc: 'Character-level rewriting of user text before archiving, so the memory file cannot be locked',
    ok: 'pass', bad: 'FAIL', okShort: 'OK', none: 'n/a',
    empty: 'No archives yet.\nStart one from the "New fitting" tab.',
    back: '← Back to list', confirmArch: 'Confirm and archive', archiving: 'Archiving…',
    rename: 'Rename', renamePrompt: 'Give this archive a readable title (a work-node name works well)',
    del: 'Delete', delQ: 'Delete this archive? The session file and index entry are removed. Irreversible.',
    delYes: 'Confirm delete', delNo: 'Cancel', deleting: 'Deleting…',
    stAccepted: 'confirmed', stProposed: 'pending', stFitting: 'in progress', stDismissed: 'abandoned',
    fitTitle: 'Start a fitting', fitHint: 'Write a trigger line → Start → answer the questions in the chat window.',
    fitPh: 'e.g. Just make that memory part better, it feels off.',
    fitStart: 'Start now', fitStartD: 'Create the fitting session locally and record it in the archive', fitGo: 'Start', fitCreating: 'Creating…',
    fitViaAi: 'Let the agent start it',
    fitViaAiOn: 'Tool exposure is on: just say "I have not figured out what I want — fit my intent."',
    fitViaAiOff: 'Tool exposure is off (default). Turn on "Expose tools" in Settings, or start from this tab.',
    flow: 'How it works',
    flowText: '1. The agent predicts 3-5 directions\n2. Each round asks 2-4 questions about what still cannot be told apart\n3. One batch of questions, you answer each\n4. It thinks between rounds and shows direction confidence\n5. On convergence it proposes; you confirm → archive',
    statLine: function (a, r) { return a + ' answered · ' + r + '% corrected' },
    statGood: 'The samples carry signal (higher correction rate = more worth training on)',
    statLow: 'Low correction rate — the model mostly guessed right, so samples carry limited signal',
    evCount: 'Event stream · ', evFrames: ' frames', evEmpty: '(empty)',
    needUtterance: 'Write a trigger line first', createFail: 'Create failed', netErr: 'network error',
    saveFail: 'Failed to save settings', copied: ' preference pairs copied to clipboard', clipboardNo: 'Clipboard unavailable',
    noPairs: 'No exportable pairs yet (answer some questions first)',
    tooltipOpen: 'Memory Fitting', tooltipClose: 'Close panel (archiving is unaffected)', tooltipSwitch: 'Click to toggle',
    posReset: 'Panel position reset', dragHint: 'Drag the title bar to move · double-click to reset',
  },
}

function detectLang() {
  try {
    var saved = localStorage.getItem('mf-lang')
    if (saved === 'zh' || saved === 'en') return saved
    var nav = (navigator.language || '').toLowerCase()
    if (nav.indexOf('zh') === 0) return 'zh'
    return 'en'
  } catch (e) { return 'zh' }
}
var LANG = detectLang()
function T() { return STR[LANG] || STR.zh }
function setLang(l) {
  LANG = (l === 'en') ? 'en' : 'zh'
  try { localStorage.setItem('mf-lang', LANG) } catch (e) {}
  render(); renderHeaderLang()
}

var state = {
  config: null, sessions: [], detected: null, alive: false, sanitize: null, stats: null,
  tab: 'settings', detail: null, loading: true, error: null, toast: null,
  lastUtterance: '', confirmingDelete: null, editingTitle: null, open: false,
}

/** 把当前工作区路径注入到 options，供拟合锚点使用。 */
var hostCtx = { workspace: '' }

/* ───────────────── 样式 ───────────────── */

var CSS_ID = 'mf-style'
function ensureStyle() {
  if (document.getElementById(CSS_ID)) return
  var s = document.createElement('style')
  s.id = CSS_ID
  s.textContent = [
    '.mf-fab{position:fixed;right:16px;bottom:16px;z-index:9996;display:flex;align-items:center;gap:7px;',
    'padding:8px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.16);cursor:pointer;',
    'background:rgba(28,30,36,.74);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
    'color:#e8eaed;font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);',
    'user-select:none;transition:background .15s}',
    '.mf-fab:hover{background:rgba(40,44,52,.86)}',
    '.mf-fab .mf-dot{width:7px;height:7px;border-radius:50%;background:#6b7280;transition:background .2s}',
    '.mf-fab.mf-on .mf-dot{background:#34d399}',
    '.mf-panel{position:fixed;right:472px;bottom:16px;z-index:9995;width:420px;max-width:calc(100vw - 508px);',
    'height:min(78vh,660px);display:none;flex-direction:column;overflow:hidden;border-radius:16px;',
    'border:1px solid rgba(255,255,255,.14);background:rgba(24,26,32,.88);backdrop-filter:blur(22px) saturate(1.3);',
    '-webkit-backdrop-filter:blur(22px) saturate(1.3);color:#e6e8ec;box-shadow:0 18px 50px rgba(0,0,0,.45);',
    'font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.mf-hd{display:flex;align-items:center;gap:6px;padding:9px 11px;border-bottom:1px solid rgba(255,255,255,.09);flex-shrink:0;',
    'cursor:move;user-select:none;-webkit-user-select:none;touch-action:none}',
    '.mf-hd b{font-size:13px;font-weight:700;flex:1;min-width:0;letter-spacing:.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mf-hd .mf-grip{opacity:.4;font-size:11px;flex-shrink:0;letter-spacing:-1px}',
    '.mf-hd .mf-badge{flex-shrink:0}',
    '.mf-x{cursor:pointer;opacity:.62;padding:4px 8px;border-radius:7px;font-size:12.5px;line-height:1;flex-shrink:0}',
    '.mf-x:hover{opacity:1;background:rgba(255,255,255,.1)}',
    '.mf-close{cursor:pointer;flex-shrink:0;width:22px;height:22px;border-radius:6px;border:1px solid rgba(255,255,255,.18);',
    'background:rgba(255,255,255,.08);color:#e6e8ec;font-size:12px;line-height:20px;text-align:center;padding:0;font-family:inherit}',
    '.mf-close:hover{background:rgba(239,68,68,.34);border-color:rgba(239,68,68,.55);color:#fff}',
    '.mf-panel.mf-dragging{box-shadow:0 26px 64px rgba(0,0,0,.58)}',
    '.mf-tabs{display:flex;gap:3px;padding:9px 13px 0;flex-shrink:0}',
    '.mf-tab{cursor:pointer;padding:6px 11px;border-radius:8px;font-size:12px;opacity:.6;font-weight:600;transition:all .13s}',
    '.mf-tab:hover{background:rgba(255,255,255,.06);opacity:.85}',
    '.mf-tab.on{background:rgba(96,165,250,.17);color:#bfdbfe;opacity:1}',
    '.mf-body{flex:1;overflow:auto;padding:11px 13px 16px;min-height:0}',
    '.mf-body::-webkit-scrollbar{width:8px}.mf-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.11);border-radius:4px}',
    '.mf-sec{margin-bottom:15px}',
    '.mf-sec h4{margin:0 0 7px;font-size:11.5px;font-weight:700;opacity:.62;letter-spacing:.4px;text-transform:uppercase}',
    '.mf-row{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:10px;background:rgba(255,255,255,.035);margin-bottom:6px;transition:background .13s}',
    '.mf-row:hover{background:rgba(255,255,255,.055)}',
    '.mf-row .mf-t{flex:1;min-width:0}',
    '.mf-row .mf-t b{display:block;font-size:12.5px;font-weight:600;margin-bottom:1px}',
    '.mf-row .mf-t i{display:block;font-size:11px;opacity:.55;font-style:normal;line-height:1.45}',
    '.mf-sw{width:38px;height:21px;border-radius:11px;background:#3f4350;position:relative;cursor:pointer;flex-shrink:0;transition:background .16s}',
    '.mf-sw.on{background:#2563eb}',
    '.mf-sw i{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .16s;box-shadow:0 1px 3px rgba(0,0,0,.3)}',
    '.mf-sw.on i{left:19px}',
    '.mf-btn{cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(96,165,250,.16);color:#dbeafe;font-size:12px;font-weight:600;white-space:nowrap;user-select:none;transition:background .13s}',
    '.mf-btn:hover{background:rgba(96,165,250,.28)}',
    '.mf-btn:active{transform:translateY(1px)}',
    '.mf-btn.sec{background:rgba(255,255,255,.05);color:#cbd0d8}',
    '.mf-btn.sec:hover{background:rgba(255,255,255,.11)}',
    '.mf-btn.danger{background:rgba(239,68,68,.16);color:#fecaca;border-color:rgba(239,68,68,.3)}',
    '.mf-btn.danger:hover{background:rgba(239,68,68,.28)}',
    '.mf-btn[disabled]{opacity:.5;cursor:default}',
    '.mf-in{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.14);',
    'background:rgba(0,0,0,.26);color:#e6e8ec;font:12.5px/1.55 inherit;resize:vertical;outline:none;transition:border-color .13s}',
    '.mf-in:focus{border-color:rgba(96,165,250,.55)}',
    '.mf-item{padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.035);margin-bottom:7px;cursor:pointer;transition:background .13s}',
    '.mf-item:hover{background:rgba(255,255,255,.08)}',
    '.mf-item b{font-size:12.5px;display:block;margin-bottom:2px}',
    '.mf-item i{font-size:11px;opacity:.55;font-style:normal;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mf-badge{display:inline-block;padding:1.5px 7px;border-radius:5px;font-size:10px;font-weight:600;background:rgba(255,255,255,.1);margin-left:6px;vertical-align:middle}',
    '.mf-badge.ok{background:rgba(52,211,153,.18);color:#6ee7b7}',
    '.mf-badge.warn{background:rgba(251,191,36,.18);color:#fcd34d}',
    '.mf-badge.mut{opacity:.6}',
    '.mf-mut{opacity:.55;font-size:11.5px;line-height:1.6}',
    '.mf-ev{padding:7px 9px;border-left:2px solid rgba(255,255,255,.14);margin-bottom:6px;font-size:11.5px;line-height:1.6;background:rgba(255,255,255,.02);border-radius:0 6px 6px 0}',
    '.mf-ev.time{opacity:.45;font-size:10.5px}',
    '.mf-err{color:#fca5a5;font-size:12px;padding:8px 10px;background:rgba(239,68,68,.1);border-radius:8px;margin-bottom:10px}',
    '.mf-empty{text-align:center;opacity:.45;font-size:12px;padding:34px 12px;line-height:1.7}',
    '.mf-toast{position:fixed;right:16px;bottom:60px;z-index:9999;padding:7px 13px;border-radius:9px;',
    'background:rgba(37,99,235,.94);color:#fff;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:320px}',
    '.mf-toast.err{background:rgba(220,38,38,.94)}',
    '.mf-flex{display:flex;gap:7px;align-items:center}',
    '.mf-sp{flex:1}',
    '.mf-confirm{padding:9px 10px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.22);margin-bottom:7px}',
    '.mf-confirm .q{font-size:12px;margin-bottom:7px}',
    '.mf-ico{font-size:13px;opacity:.8;flex-shrink:0}',
  ].join('')
  document.head.appendChild(s)
}

function el(tag, cls, text) {
  var d = document.createElement(tag)
  if (cls) d.className = cls
  if (text != null) d.textContent = text
  return d
}

/* ───────────────── 提示条 ───────────────── */

var toastTimer = null
function toast(msg, isErr) {
  var old = document.getElementById('mf-toast')
  if (old) old.remove()
  var d = el('div', 'mf-toast' + (isErr ? ' err' : ''), msg)
  d.id = 'mf-toast'
  document.body.appendChild(d)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(function () { d.remove() }, 3200)
}

/* ───────────────── 数据 ───────────────── */

function refresh() {
  return req(API.state).then(function (s) {
    if (s && s.ok) {
      state.config = s.config
      state.sessions = s.sessions || []
      state.detected = s.detected
      state.alive = !!s.autoMemoryAlive
      state.sanitize = s.sanitize
      state.error = null
    } else {
      state.error = (s && s.error) || 'state 读取失败'
    }
    state.loading = false
    render()
    req(API.stats).then(function (st) { if (st && st.ok) { state.stats = st; render() } }).catch(function () {})
  }).catch(function (e) {
    state.loading = false
    state.error = String(e && e.message ? e.message : e)
    render()
  })
}

/**
 * 乐观回显：开关必须即时翻面（用户界面偏好：写盘成功但界面无变化 = 功能坏了）。
 * 失败时回滚并提示。
 */
function setConfig(patch) {
  var prev = Object.assign({}, state.config)
  Object.assign(state.config, patch)
  render()
  return req(API.config, { method: 'POST', body: JSON.stringify(patch) }).then(function (r) {
    if (r && r.ok) { state.config = r.config; render() }
    else { state.config = prev; render(); toast('设置保存失败', true) }
  }).catch(function () {
    state.config = prev; render(); toast('设置保存失败：网络错误', true)
  })
}

/* ───────────────── 渲染 ───────────────── */

var panelRoot = null, panelHost = null, fabRoot = null

/** 内嵌模式（DSH 设置页内）：只渲染内容，不渲染标题栏/关闭按钮/标签页 ——
 *  那些属于浮动面板的窗口装饰，在设置页里出现会造成"关闭按钮关了别的东西"的困惑。 */
var renderInline = false

function render() {
  if (!panelRoot || !panelHost) return
  panelHost.innerHTML = ''
  if (!renderInline) {
    panelHost.appendChild(renderHeader())
    panelHost.appendChild(renderTabs())
  }
  var body = el('div', 'mf-body')
  if (renderInline) body.style.cssText = 'overflow:visible;padding:0;max-height:none'
  if (state.loading) body.appendChild(el('div', 'mf-empty', T().loading))
  else {
    if (state.error) body.appendChild(el('div', 'mf-err', '错误：' + state.error))
    if (state.tab === 'settings') renderSettings(body)
    else if (state.tab === 'archive') state.detail ? renderDetail(body) : renderArchive(body)
    else renderFit(body)
  }
  panelHost.appendChild(body)
  if (!renderInline) mountDrag()
}

function renderHeader() {
  var h = el('div', 'mf-hd')
  h.title = T().dragHint
  var t = T()
  h.appendChild(el('span', 'mf-grip', '⋮⋮'))
  h.appendChild(el('b', null, t.title))
  var c = state.config || {}
  h.appendChild(el('span', 'mf-badge ' + (c.injectContext ? 'ok' : 'mut'), t.inject + (c.injectContext ? t.on : t.off)))
  h.appendChild(el('span', 'mf-badge ' + (c.writeMemory ? 'ok' : 'mut'), t.mem + (c.writeMemory ? t.on : t.off)))
  // 语言切换
  var langBtn = el('span', 'mf-x', LANG === 'zh' ? 'EN' : '中')
  langBtn.title = 'Language / 语言'
  langBtn.onclick = function (e) { e.stopPropagation(); setLang(LANG === 'zh' ? 'en' : 'zh') }
  h.appendChild(langBtn)
  // 关闭：独立明显按钮，不再与语言按钮共用样式（原来两者视觉上难以区分，容易被忽略）
  var x = el('div', 'mf-close', '✕')
  x.title = t.tooltipClose
  x.onclick = function (e) { e.stopPropagation(); setOpen(false) }
  h.appendChild(x)
  // 拖动绑定（在 mountDrag 里做，避免每次 render 重复绑定）
  return h
}

function renderHeaderLang() {
  var fab = document.getElementById('mf-fab-root')
  if (fab && fab.lastChild) fab.lastChild.textContent = T().title
}

function renderTabs() {
  var wrap = el('div', 'mf-tabs')
  var L = T()
  ;[['settings', L.tabSettings], ['archive', L.tabArchive], ['fit', L.tabFit]].forEach(function (t) {
    var d = el('div', 'mf-tab' + (state.tab === t[0] ? ' on' : ''), t[1])
    d.onclick = function () { state.tab = t[0]; state.detail = null; state.confirmingDelete = null; render() }
    wrap.appendChild(d)
  })
  return wrap
}

function switchRow(title, desc, key, extra) {
  var row = el('div', 'mf-row')
  var t = el('div', 'mf-t')
  t.appendChild(el('b', null, title))
  if (desc) t.appendChild(el('i', null, desc))
  row.appendChild(t)
  var on = !!(state.config && state.config[key])
  var sw = el('div', 'mf-sw' + (on ? ' on' : ''))
  sw.appendChild(el('i'))
  sw.title = T().tooltipSwitch
  sw.onclick = function () { var p = {}; p[key] = !on; setConfig(p) }
  row.appendChild(sw)
  if (extra) row.appendChild(extra)
  return row
}

function numRow(title, desc, key, min, max) {
  var row = el('div', 'mf-row')
  var t = el('div', 'mf-t')
  t.appendChild(el('b', null, title))
  t.appendChild(el('i', null, desc))
  row.appendChild(t)
  var inp = el('input', 'mf-in')
  inp.type = 'number'; inp.min = String(min); inp.max = String(max)
  inp.value = String((state.config && state.config[key]) || min)
  inp.style.width = '66px'; inp.style.textAlign = 'center'
  inp.onchange = function () {
    var v = Math.max(min, Math.min(Number(inp.value) || min, max))
    inp.value = String(v)
    var p = {}; p[key] = v; setConfig(p)
  }
  row.appendChild(inp)
  return row
}

function renderSettings(body) {
  var s1 = el('div', 'mf-sec')
  s1.appendChild(el('h4', null, '污染面开关 · 默认关闭'))
  s1.appendChild(switchRow('注入会话上下文', '每轮注入一段极短说明，让模型知道可主动发起拟合。开启才有 token 开销', 'injectContext'))
  s1.appendChild(switchRow('写入记忆插件', '把收敛结论写进 dsh-auto-memory。默认关闭以避免耦合', 'writeMemory'))
  s1.appendChild(switchRow('向模型暴露工具', '模型可见 memory_fit_* 工具。注册即占每轮 tool 上下文', 'exposeTools'))
  body.appendChild(s1)

  var s2 = el('div', 'mf-sec')
  s2.appendChild(el('h4', null, '本插件自己的存储'))
  s2.appendChild(switchRow('本地留档', '拟合全过程写入 ~/.dsh/memory-fitting/sessions/（隔离于其它插件）', 'localArchive'))
  s2.appendChild(switchRow('记住悬窗开合', '关闭则每次启动都收起悬窗', 'persistPanelOpen'))
  body.appendChild(s2)

  var s3 = el('div', 'mf-sec')
  s3.appendChild(el('h4', null, '拟合参数'))
  s3.appendChild(numRow('每轮问题数上限', '一轮最多问几个问题', 'maxQuestionsPerRound', 1, 8))
  s3.appendChild(numRow('整场轮数上限', '防止"问上瘾"，默认 4 轮封顶', 'maxRounds', 1, 12))
  body.appendChild(s3)

  // 配置导入 / 导出
  var sCfg = el('div', 'mf-sec')
  sCfg.appendChild(el('h4', null, '配置迁移'))
  var cfgRow = el('div', 'mf-flex')
  var expCfg = el('div', 'mf-btn sec', '导出配置')
  expCfg.onclick = function () {
    req(API.configExport).then(function (r) {
      if (!r || !r.ok) { toast('导出失败', true); return }
      var txt = JSON.stringify(r.config, null, 2)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('配置已复制到剪贴板') }).catch(function () { toast(txt, false) })
      } else { toast('剪贴板不可用', true) }
    }).catch(function () { toast('导出失败', true) })
  }
  cfgRow.appendChild(expCfg)
  var impCfg = el('div', 'mf-btn sec', '导入配置')
  impCfg.onclick = function () {
    var raw = prompt('粘贴配置 JSON：')
    if (!raw) return
    var parsed
    try { parsed = JSON.parse(raw) } catch (e) { toast('JSON 解析失败', true); return }
    req(API.configImport, { method: 'POST', body: JSON.stringify({ config: parsed }) }).then(function (r) {
      if (r && r.ok) { state.config = r.config; render(); toast('已导入 ' + (r.applied || []).length + ' 项') }
      else { toast('导入失败', true) }
    }).catch(function () { toast('导入失败', true) })
  }
  cfgRow.appendChild(impCfg)
  sCfg.appendChild(el('div', 'mf-mut', '把开关状态导出成 JSON，换机器时不用重新点一遍。'))
  sCfg.appendChild(cfgRow)
  body.appendChild(sCfg)

  var s4 = el('div', 'mf-sec')
  s4.appendChild(el('h4', null, '环境自检'))
  var d = state.detected || {}
  var amText = d.autoMemory
    ? (state.alive ? '已检测到 · 实例存活' : '已检测到 · 实例未响应')
    : '未检测到（不影响本地留档）'
  var r1 = el('div', 'mf-row')
  var t1 = el('div', 'mf-t')
  t1.appendChild(el('b', null, 'dsh-auto-memory'))
  t1.appendChild(el('i', null, amText))
  r1.appendChild(t1)
  r1.appendChild(el('span', 'mf-badge ' + (state.alive ? 'ok' : 'mut'), state.alive ? 'OK' : '—'))
  s4.appendChild(r1)

  var st = state.sanitize
  if (st) {
    var good = st.detectionWorks && st.cleanHasNoReserved && st.contentPreserved && st.noopOnClean
    var r2 = el('div', 'mf-row')
    var t2 = el('div', 'mf-t')
    t2.appendChild(el('b', null, '写入安全带'))
    t2.appendChild(el('i', null, '归档前对用户原话做字符级改写，防止锚点击穿记忆文件'))
    r2.appendChild(t2)
    r2.appendChild(el('span', 'mf-badge ' + (good ? 'ok' : 'warn'), good ? '通过' : '异常'))
    s4.appendChild(r2)
  }
  body.appendChild(s4)
}

function statusBadge(s) {
  var map = { accepted: 'ok', proposed: 'warn', fitting: 'mut', dismissed: 'mut' }
  var label = { accepted: '已确认', proposed: '待确认', fitting: '进行中', dismissed: '已放弃' }
  return el('span', 'mf-badge ' + (map[s] || 'mut'), label[s] || s)
}

function renderArchive(body) {
  // 数据价值提示：这些留档不只是日志，是训练样本（见 docs/TRAINING.md）
  if (state.stats && state.stats.sessions > 0) {
    var card = el('div', 'mf-row')
    var t = el('div', 'mf-t')
    var answered = state.stats.answered || 0
    var rate = Math.round((state.stats.correctionRate || 0) * 100)
    t.appendChild(el('b', null, '已答 ' + answered + ' 题 · 纠正率 ' + rate + '%'))
    t.appendChild(el('i', null, rate >= 20
      ? '样本有信息量（纠正率越高越值得训练）'
      : '纠正率偏低 —— 说明模型大多猜对了，样本信息量有限'))
    card.appendChild(t)
    body.appendChild(card)
  }
  var top = el('div', 'mf-flex')
  top.style.marginBottom = '10px'
  var cnt = state.sessions.length
  top.appendChild(el('div', 'mf-mut', cnt ? '共 ' + cnt + ' 条留档' : ''))
  top.appendChild(el('div', 'mf-sp'))
  var exp = el('div', 'mf-btn sec', '导出偏好对')
  exp.title = '导出为训练可用的偏好对（JSONL），复制到剪贴板'
  exp.onclick = function () {
    exp.textContent = '导出中…'
    req(API.export).then(function (r) {
      exp.textContent = '导出偏好对'
      if (!r || !r.ok) { toast('导出失败', true); return }
      if (!r.count) { toast('还没有可导出的偏好对（需要先答过题）', true); return }
      var done = function () { toast('已复制 ' + r.count + ' 条偏好对到剪贴板') }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(r.jsonl).then(done).catch(function () { toast('剪贴板不可用', true) })
      } else { toast('剪贴板不可用', true) }
    }).catch(function () { exp.textContent = '导出偏好对'; toast('导出失败', true) })
  }
  top.appendChild(exp)
  var rb = el('div', 'mf-btn sec', '刷新')
  rb.onclick = function () { state.loading = true; render(); refresh() }
  top.appendChild(rb)
  body.appendChild(top)

  if (!state.sessions.length) {
    body.appendChild(el('div', 'mf-empty', '还没有留档。\n到「开始拟合」页发起一次。'))
    return
  }
  state.sessions.forEach(function (s) {
    var it = el('div', 'mf-item')
    var b = el('b', null, (s.title || (s.conclusion && s.conclusion.winner) || '（未收敛）'))
    b.appendChild(statusBadge(s.status))
    it.appendChild(b)
    var when = String(s.createdAt || '').slice(0, 16).replace('T', ' ')
    it.appendChild(el('i', null, when + ' · ' + String(s.utterance || '（无触发语）').slice(0, 44)))
    it.onclick = function () {
      state.loading = true; render()
      req(API.session + '?id=' + encodeURIComponent(s.id)).then(function (r) {
        state.loading = false
        state.detail = (r && r.ok) ? r : { error: (r && r.error) || '读取失败' }
        render()
      }).catch(function (e) { state.loading = false; state.detail = { error: String(e) }; render() })
    }
    body.appendChild(it)
  })
}

function renderDetail(body) {
  var back = el('div', 'mf-btn sec', '← 返回列表')
  back.style.marginBottom = '11px'
  back.onclick = function () { state.detail = null; state.confirmingDelete = null; render() }
  body.appendChild(back)

  var d = state.detail
  if (!d || d.error) {
    body.appendChild(el('div', 'mf-err', '读取失败：' + ((d && d.error) || 'unknown')))
    return
  }
  var e = d.entry || {}

  var head = el('div', 'mf-sec')
  var hb = el('div', 'mf-flex')
  hb.appendChild(el('b', null, e.title || ((e.conclusion && e.conclusion.winner) || '（未收敛）')))
  hb.appendChild(el('div', 'mf-sp'))
  hb.appendChild(statusBadge(e.status))
  head.appendChild(hb)
  if (e.utterance) head.appendChild(el('div', 'mf-mut', '触发语：「' + e.utterance + '」'))
  if (e.workspace) head.appendChild(el('div', 'mf-mut', '工作区：' + e.workspace))
  head.appendChild(el('div', 'mf-mut', '创建于 ' + String(e.createdAt || '').slice(0, 19).replace('T', ' ')))
  body.appendChild(head)

  // 归档动作
  var act = el('div', 'mf-flex')
  act.style.marginBottom = '13px'
  if (e.status !== 'accepted' && e.conclusion && e.conclusion.winner) {
    var okBtn = el('div', 'mf-btn', '确认并归档')
    okBtn.onclick = function () {
      okBtn.textContent = '归档中…'
      req(API.archive, { method: 'POST', body: JSON.stringify({ sessionId: e.id, winner: e.conclusion.winner, accepted: true }) })
        .then(function (r) {
          if (r && r.ok) {
            toast(r.writeMemory
              ? (r.external && r.external.ok ? '已归档（含写入记忆插件）' : '已本地归档；记忆插件写入失败：' + ((r.external && r.external.reason) || '未知'))
              : '已本地归档（记忆写入开关关闭）')
            state.detail = null; state.tab = 'archive'; refresh()
          } else { toast('归档失败', true); okBtn.textContent = '确认并归档' }
        })
        .catch(function () { toast('归档失败：网络错误', true); okBtn.textContent = '确认并归档' })
    }
    act.appendChild(okBtn)
  }
  var renBtn = el('div', 'mf-btn sec', '改标题')
  renBtn.onclick = function () {
    var t = prompt('给这条留档起个可读标题（拟合后回填节点名）', e.title || '')
    if (t == null) return
    req(API.rename, { method: 'POST', body: JSON.stringify({ sessionId: e.id, title: String(t).slice(0, 120) }) })
      .then(function () { state.detail = null; refresh(); toast('标题已更新') })
  }
  act.appendChild(renBtn)

  if (state.confirmingDelete === e.id) {
    var cf = el('div', 'mf-confirm')
    cf.appendChild(el('div', 'q', '删除这条留档？会话文件与索引项都会被移除，不可恢复。'))
    var cb = el('div', 'mf-flex')
    var y = el('div', 'mf-btn danger', '确认删除')
    y.onclick = function () {
      y.textContent = '删除中…'
      fetch(API.deleteSession + '?id=' + encodeURIComponent(e.id), { method: 'DELETE' })
        .then(function (r) { return r.json() })
        .then(function (r) {
          if (r && r.ok) { toast('已删除'); state.detail = null; state.confirmingDelete = null; refresh() }
          else { toast('删除失败：' + ((r && r.reason) || '未知'), true); render() }
        })
        .catch(function () { toast('删除失败', true); render() })
    }
    cb.appendChild(y)
    var n = el('div', 'mf-btn sec', '取消')
    n.onclick = function () { state.confirmingDelete = null; render() }
    cb.appendChild(n)
    cf.appendChild(cb)
    act.appendChild(el('div', 'mf-sp'))
    act.appendChild(cf)
    body.appendChild(act)
    return
  }
  var delBtn = el('div', 'mf-btn danger', '删除')
  delBtn.onclick = function () { state.confirmingDelete = e.id; render() }
  act.appendChild(delBtn)
  body.appendChild(act)

  // 事件流
  var events = d.events || []
  var sec = el('div', 'mf-sec')
  sec.appendChild(el('h4', null, '事件流 · ' + events.length + ' 帧'))
  if (!events.length) sec.appendChild(el('div', 'mf-mut', '（空）'))
  events.forEach(function (ev) {
    var line = el('div', 'mf-ev')
    var txt = ''
    if (ev.type === 'fit/start') txt = '▶ 开始 · 工作区 ' + (ev.workspace || '—')
    else if (ev.type === 'fit/directions') txt = '◇ 预定方向：' + (ev.directions || []).map(function (x) { return x.label }).join(' / ')
    else if (ev.type === 'fit/ask') txt = '？ 第' + ev.round + '轮提问：' + (ev.questions || []).map(function (q) { return q.question }).join('；')
    else if (ev.type === 'fit/answer') txt = '✓ 第' + ev.round + '轮作答：' + (ev.summary || '')
    else if (ev.type === 'fit/reflect') txt = '⟳ 轮间思考：' + ((ev.directions || []).map(function (x) { return x.label }).join(' / ') || ev.rationale || '')
    else if (ev.type === 'fit/propose') txt = '★ 收敛提案：' + ((ev.conclusion && ev.conclusion.winner) || '')
    else if (ev.type === 'fit/finish') txt = (ev.accepted ? '✔ 用户确认' : '✗ 用户放弃') + (ev.note ? ' · ' + ev.note : '')
    else if (ev.type === 'fit/feedback') txt = '◎ 反馈（' + ev.verdict + '）：' + (ev.preference || '')
    else txt = ev.type
    line.textContent = txt
    sec.appendChild(line)
  })
  body.appendChild(sec)
}

function renderFit(body) {
  var sec = el('div', 'mf-sec')
  sec.appendChild(el('h4', null, '发起一次拟合'))
  sec.appendChild(el('div', 'mf-mut', '写下触发语 → 开始 → 到聊天窗口回答模型提出的问题。'))
  var ta = el('textarea', 'mf-in')
  ta.rows = 3
  ta.placeholder = '例如：帮我把记忆这部分弄好一点，感觉不太行。'
  ta.value = state.lastUtterance || ''
  ta.oninput = function () { state.lastUtterance = ta.value }
  sec.appendChild(ta)
  body.appendChild(sec)

  var row = el('div', 'mf-row')
  var t = el('div', 'mf-t')
  t.appendChild(el('b', null, '立即开始'))
  t.appendChild(el('i', null, '在本地建立拟合会话并记入留档'))
  row.appendChild(t)
  var btn = el('div', 'mf-btn', '开始')
  btn.onclick = function () {
    var u = (ta.value || '').trim()
    if (!u) { toast('请先写下触发语', true); return }
    btn.textContent = '创建中…'
    btn.setAttribute('disabled', '1')
    req(API.start, { method: 'POST', body: JSON.stringify({ utterance: u, workspace: hostCtx.workspace || '' }) })
      .then(function (r) {
        btn.textContent = '开始'; btn.removeAttribute('disabled')
        if (r && r.ok) {
          toast('拟合会话已建立：' + (r.session && r.session.id))
          state.lastUtterance = ''
          state.tab = 'archive'; state.detail = null
          refresh()
        } else { toast('创建失败：' + ((r && r.error) || '未知'), true) }
      })
      .catch(function (e) { btn.textContent = '开始'; btn.removeAttribute('disabled'); toast('创建失败：' + e, true) })
  }
  row.appendChild(btn)
  body.appendChild(row)

  var hint = el('div', 'mf-sec')
  hint.appendChild(el('h4', null, '让 AI 主动发起'))
  var toolsOn = state.config && state.config.exposeTools
  hint.appendChild(el('div', 'mf-mut', toolsOn
    ? '已开启工具暴露：直接对 AI 说「我还没想清楚，帮我拟合一下意图」即可。'
    : '工具暴露当前关闭（默认）。到设置页打开「向模型暴露工具」，或直接在本页发起。'))
  body.appendChild(hint)

  var flow = el('div', 'mf-sec')
  flow.appendChild(el('h4', null, '拟合流程'))
  flow.appendChild(el('div', 'mf-mut', '① AI 预定 3-5 个方向（预测你的意图）\n② 每轮针对"分不开的方向"提 2-4 个问题\n③ 一次问一批，你逐个作答\n④ 轮间思考并展示方向可信度\n⑤ 收敛后提案，你确认 → 归档'))
  body.appendChild(flow)
}

/* ───────────────── 挂载 / 开合 ───────────────── */

function ensureMounted() {
  ensureStyle()
  if (!fabRoot || !document.getElementById('mf-fab-root')) {
    fabRoot = document.createElement('div')
    fabRoot.id = 'mf-fab-root'
    fabRoot.className = 'mf-fab'
    fabRoot.appendChild(el('span', 'mf-dot'))
    fabRoot.appendChild(el('span', null, T().title))
    fabRoot.title = T().tooltipOpen
    fabRoot.onclick = function () { setOpen(!state.open) }
    document.body.appendChild(fabRoot)
  }
  if (!panelRoot || !document.getElementById('mf-panel-root')) {
    panelRoot = document.createElement('div')
    panelRoot.id = 'mf-panel-root'
    panelRoot.className = 'mf-panel'
    panelHost = document.createElement('div')
    panelHost.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
    panelRoot.appendChild(panelHost)
    document.body.appendChild(panelRoot)
  }
}

function setOpen(v, silent) {
  ensureMounted()
  state.open = !!v
  panelRoot.style.display = v ? 'flex' : 'none'
  if (fabRoot) fabRoot.className = 'mf-fab' + (v ? ' mf-on' : '')
  if (v) { refresh(); applySavedPos() }
  if (!silent) {
    var c = state.config
    if (c && c.persistPanelOpen) setConfig({ panelOpenByDefault: !!v })
  }
}

/* ───────────────── 拖动与位置记忆 ─────────────────
 * 位置存在 localStorage（不进插件配置：挪个窗口不该触发服务端写盘）。
 * 拖动时切换到 left/top 定位，并把 right/bottom 置空，避免两套定位互相打架。
 */

var POS_KEY = 'mf-panel-pos'
var dragState = null

function readSavedPos() {
  try {
    var raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    var p = JSON.parse(raw)
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null
    return p
  } catch (e) { return null }
}

function savePos(x, y) {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })) } catch (e) {}
}

function clearSavedPos() {
  try { localStorage.removeItem(POS_KEY) } catch (e) {}
}

/** 把面板切成绝对定位（left/top），供拖动使用。 */
function useAbsolutePos(x, y) {
  panelRoot.style.right = 'auto'
  panelRoot.style.bottom = 'auto'
  panelRoot.style.left = x + 'px'
  panelRoot.style.top = y + 'px'
}

/** 恢复上次的位置；没有记录则回落到默认布局。 */
function applySavedPos() {
  if (!panelRoot) return
  var p = readSavedPos()
  if (!p) return
  var rect = panelRoot.getBoundingClientRect()
  // 窗口变小后旧位置可能跑到屏幕外，夹回可视区
  var maxX = Math.max(0, (window.innerWidth || 1200) - 80)
  var maxY = Math.max(0, (window.innerHeight || 800) - 40)
  var x = Math.min(Math.max(0, p.x), maxX)
  var y = Math.min(Math.max(0, p.y), maxY)
  if (rect.width) x = Math.min(x, Math.max(0, (window.innerWidth || 1200) - rect.width))
  if (rect.height) y = Math.min(y, Math.max(0, (window.innerHeight || 800) - rect.height))
  useAbsolutePos(x, y)
}

/** 把位置复位到默认（右侧那一列左边）。 */
function resetPos() {
  if (!panelRoot) return
  clearSavedPos()
  panelRoot.style.left = 'auto'
  panelRoot.style.top = 'auto'
  fitPanel()
}

function mountDrag() {
  var handle = panelHost && panelHost.querySelector('.mf-hd')
  if (!handle || handle.dataset.dragBound) return
  handle.dataset.dragBound = '1'

  var start = function (e) {
    // 只响应主键；点在按钮上不触发拖动
    if (e.button != null && e.button !== 0) return
    if (e.target && e.target.closest && e.target.closest('.mf-close, .mf-x, .mf-sw, .mf-btn, input, textarea, select')) return
    var rect = panelRoot.getBoundingClientRect()
    dragState = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      moved: false,
    }
    // 拖动期间切绝对定位，避免 right/bottom 与 left/top 打架
    useAbsolutePos(rect.left, rect.top)
    panelRoot.classList.add('mf-dragging')
    if (handle.setPointerCapture && e.pointerId != null) {
      try { handle.setPointerCapture(e.pointerId) } catch (err) {}
    }
    e.preventDefault()
  }

  var move = function (e) {
    if (!dragState) return
    var w = panelRoot.offsetWidth || 420
    var h = panelRoot.offsetHeight || 400
    var vw = window.innerWidth || 1200
    var vh = window.innerHeight || 800
    // 夹在可视区内，但至少留 60px 露头，避免拖丢
    var x = Math.min(Math.max(e.clientX - dragState.dx, 60 - w), vw - 60)
    var y = Math.min(Math.max(e.clientY - dragState.dy, 0), vh - 32)
    if (Math.abs(x - (e.clientX - dragState.dx)) > 0.5 || Math.abs(y - (e.clientY - dragState.dy)) > 0.5) {
      // 被夹住了
    }
    dragState.moved = true
    useAbsolutePos(x, y)
    e.preventDefault()
  }

  var end = function (e) {
    if (!dragState) return
    if (dragState.moved) {
      var rect = panelRoot.getBoundingClientRect()
      savePos(rect.left, rect.top)
    }
    dragState = null
    panelRoot.classList.remove('mf-dragging')
  }

  handle.addEventListener('pointerdown', start)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  // 双击标题栏复位
  handle.addEventListener('dblclick', function (e) {
    if (e.target && e.target.closest && e.target.closest('.mf-close, .mf-x')) return
    resetPos()
    toast(T().posReset || '面板位置已复位')
  })
}

/** 窄屏兜底：右侧那一列占满宽度时，面板改为居中浮层，避免负宽度。 */
function fitPanel() {
  if (!panelRoot) return
  // 用户手动挪过位置就别再自动摆布
  if (readSavedPos()) { applySavedPos(); return }
  var w = window.innerWidth || 1200
  if (w < 900) {
    panelRoot.style.left = 'auto'
    panelRoot.style.top = 'auto'
    panelRoot.style.right = '16px'
    panelRoot.style.width = 'min(420px, calc(100vw - 32px))'
  } else {
    panelRoot.style.left = 'auto'
    panelRoot.style.top = 'auto'
    panelRoot.style.right = '472px'
    panelRoot.style.width = '420px'
  }
}

/* ───────────────── apply ───────────────── */

function apply(ctx) {
  ensureMounted()
  mountDrag()
  fitPanel()

  // 工作区路径：从会话快照尽力获取（拿不到不报错，只影响锚点可读性）
  try {
    var sessions = (typeof ctx.get === 'function') ? ctx.get('sessions') : null
    if (sessions && typeof sessions.getSnapshot === 'function') {
      var snap = sessions.getSnapshot()
      var cur = snap && snap.current
      if (cur && cur.cwd) hostCtx.workspace = String(cur.cwd)
    }
  } catch (e) { /* 拿不到就算了，绝不影响插件加载 */ }

  window.addEventListener('resize', fitPanel)

  // 记住的开合状态在拿到配置后恢复
  refresh().then(function () {
    if (state.config && state.config.panelOpenByDefault) setOpen(true, true)
  })

  // settings.section 复用悬窗的渲染函数（同一套 UI，避免漂移）
  try {
    var slots = ctx.slots
    if (slots && typeof slots.inject === 'function') {
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'memory-fitting-pre', order: 33, label: '记忆拟合' },
          function () {
            var host = document.createElement('div')
            host.style.cssText = 'padding:4px 2px 12px;color:inherit'
            var saveHost = panelHost
            var saveInline = renderInline
            var tmp = document.createElement('div')
            tmp.className = 'mf-body'
            tmp.style.cssText = 'overflow:visible;padding:0;max-height:none'
            panelHost = tmp
            renderInline = true
            render()
            renderInline = saveInline
            panelHost = saveHost
            host.appendChild(tmp)
            return host
          }
        )
      })
    }
  } catch (e) {
    console.error('[memory-fitting] settings.section 注册失败:', e)
  }

  console.log('[memory-fitting] client ready')
}

module.exports = { apply: apply }
