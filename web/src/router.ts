// 极简 history 路由，无依赖。路由形如 '/a/:albumId'，注册后按路径分发。
type Handler = (params: Record<string, string>) => void

interface Entry {
  pattern: RegExp
  names: string[]
  handler: Handler
}

const entries: Entry[] = []

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
