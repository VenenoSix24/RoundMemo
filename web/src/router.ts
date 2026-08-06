// 极简 history 路由，无依赖。路由形如 '/a/:albumId'，注册后按路径分发。
type Handler = (params: Record<string, string>) => void

interface Entry {
  pattern: RegExp
  names: string[]
  handler: Handler
}

const entries: Entry[] = []

// 页面级清理钩子：路由切换前执行，用于移除滚动/鼠标监听、取消 rAF、复位滚动。
let teardown: (() => void) | null = null

export function setTeardown(fn: (() => void) | null): void {
  teardown = fn
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function route(pattern: string, handler: Handler): void {
  const names: string[] = []
  const src = pattern
    .split('/')
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith(':')) {
        names.push(p.slice(1))
        return '([^/]+)'
      }
      return escapeRe(p)
    })
    .join('/')
  entries.push({ pattern: new RegExp(`^/${src}/?$`), names, handler })
}

export function navigate(path: string): void {
  if (location.pathname === path) {
    dispatch()
    return
  }
  history.pushState(null, '', path)
  dispatch()
}

export function startRouter(): void {
  window.addEventListener('popstate', dispatch)
  dispatch()
}

function dispatch(): void {
  // 先清理上一页的监听，避免跨页泄漏（如入口页的滚动 scrubber）
  if (teardown) {
    teardown()
    teardown = null
  }
  for (const e of entries) {
    const m = location.pathname.match(e.pattern)
    if (m) {
      const params: Record<string, string> = {}
      e.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])))
      e.handler(params)
      return
    }
  }
  // 未匹配路径统一回口令页，避免白屏
  navigate('/')
}
