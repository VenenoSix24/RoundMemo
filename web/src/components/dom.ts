// 轻量 DOM 构建辅助：h('div', {class, onClick, ...}, children)。
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>
type Child = Node | string | null | undefined
type Children = Child | Child[]

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  children?: Children,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue
      if (k === 'class') {
        el.className = String(v)
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v as unknown as Record<string, string>)
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      } else {
        el.setAttribute(k, String(v))
      }
    }
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children]
    for (const c of list) {
      if (c == null) continue
      el.append(c)
    }
  }
  return el
}

export function mount(root: HTMLElement | null, node: Node): void {
  if (!root) return
  root.replaceChildren(node)
}

// 清空并替换 #app 内容。
export function renderPage(node: Node): void {
  const app = document.getElementById('app')
  mount(app, node)
}
