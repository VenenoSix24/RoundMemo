// 轻量 DOM 构建辅助：h('div', {class, dataset, onClick, ...}, children)。
// dataset 传对象（如 { reveal: '' }）会映射成 data-* 属性，其余键按属性/事件处理。
type Attrs = Record<
  string,
  string | number | boolean | ((e: Event) => void) | Record<string, string> | undefined
>
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

export function mount(root: HTMLElement | null, node: Node | Node[]): void {
  if (!root) return
  root.replaceChildren(...(Array.isArray(node) ? node : [node]))
}

// 清空并替换 #app 内容。传数组时多个节点平级挂载——访客 dock 借此脱离 .page，
// 避免 .page 的入场动画 transform 把 position:fixed 的 dock 变成相对 .page 定位。
export function renderPage(node: Node | Node[]): void {
  const app = document.getElementById('app')
  mount(app, node)
}
