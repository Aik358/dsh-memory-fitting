/**
 * 记忆写入安全带 —— 本插件最重要的一个模块。
 *
 * 背景（2026-09-16 本机实测，附代码证据）：
 *   dsh-auto-memory 的写入侧【不过滤】待写入正文。appendAnchoredRecord()
 *   (lib/memory-writer-pre.js:95-111) 只对【已有文件内容】跑 parseAnchors，
 *   从不检查 text 参数；text 仅做行尾转换后原样拼接落盘。
 *   于是正文里一旦出现保留 marker 起始序列，该文件其后【所有】记忆写入
 *   全部被 fail closed 拒绝（conflict:orphan-content），写入能力整体中断。
 *
 *   parseAnchors 没有任何转义机制：反引号 / 代码块 / HTML 实体都不认，
 *   只要字面序列出现就触发（lib/memory-anchor-pre.js:177-186，MARKER_OPEN 的
 *   startsWith / includes 判定）。
 *
 * 因此本插件的铁律：
 *   【用户原话永远不直接进记忆插件】—— 必须经过本模块的字符级改写。
 *   注意：是"改写措辞"，不是"转义"。转义无效。
 */

// 保留序列按片段拼接，避免本文件自身包含完整字面串
const LT = String.fromCharCode(60)   // <
const BANG = '!'
const DASH2 = '--'
const KEYWORD = 'memory'
const COLON = ':'
const RESERVED_OPEN = LT + BANG + DASH2 + ' ' + KEYWORD + COLON

/** 供其它模块/测试使用（不要在正文里直接写完整串）。 */
export function reservedOpenSequence() {
  return RESERVED_OPEN
}

/** 一个字符串里是否含保留序列。 */
export function containsReserved(text) {
  return typeof text === 'string' && text.includes(RESERVED_OPEN)
}

/**
 * 字符级改写：把保留序列替换为不含它的描述性表述。
 * 只改这一个序列，其余内容逐字保留（含换行、缩进）。
 */
export function sanitizeForMemory(text) {
  if (typeof text !== 'string') return ''
  if (!containsReserved(text)) return text
  return text.split(RESERVED_OPEN).join('［记忆锚点起始标记］')
}

/**
 * 通用净化：写进任何"会被 dsh-auto-memory 解析"的位置之前都要过一遍。
 * @returns {{ok: boolean, text: string, hits: number}}
 */
export function guard(text) {
  const hits = typeof text === 'string' ? text.split(RESERVED_OPEN).length - 1 : 0
  return { ok: hits === 0, text: sanitizeForMemory(text), hits }
}

/**
 * 自检：验证改写确实有效（供 doctor / 回归脚本调用）。
 * 不依赖任何外部文件，纯函数验证。
 */
export function selfTest() {
  const dirty = 'x ' + RESERVED_OPEN + ' y'
  const clean = sanitizeForMemory(dirty)
  return {
    detectionWorks: containsReserved(dirty),
    cleanHasNoReserved: !containsReserved(clean),
    contentPreserved: clean.includes('x ') && clean.includes(' y'),
    noopOnClean: sanitizeForMemory('hello world') === 'hello world',
  }
}
