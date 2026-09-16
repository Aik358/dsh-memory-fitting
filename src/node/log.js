const PREFIX = '[memory-fitting]'

export function log(...args) { console.log(PREFIX, ...args) }
export function warn(...args) { console.warn(PREFIX, ...args) }
export function error(...args) { console.error(PREFIX, ...args) }

/**
 * 本插件与整个 dsh web 共享进程：任何逃逸的异常都可能打穿宿主的请求处理。
 * 所有路由/工具回调都必须包在 guard 里。
 */
export function guard(label, fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      error(label + ' failed:', e && e.stack ? e.stack : e)
      return undefined
    }
  }
}
