import { h } from './dom'

// 液态玻璃 tab 的滑动指示器：容器随页面整体重建，靠记录上一活跃 tab 的位置，
// 让指示器从上一位置滑到当前位置（FLIP 入场），形成跨页面切换仍连续的效果。
// 首次进入无动画（prev === current）。
//
// 同一次渲染可能同时出现多个带指示器的容器（如桌面顶栏 tab + 移动端 dock 并存，
// CSS 按断点显隐），它们必须各自记忆自己的上一位置，故按 namespace 区分记忆，
// 否则后渲染的容器会因 prevKey 已被抢占而丢失滑入动画。

const prevByNs = new Map<string, string>()

// withDockIndicator 把指示器放进 nav，返回 nav（调用方负责把返回值当容器用）。
// ns：该容器专属命名空间（如 'visitor-dock' / 'visitor-view' / 'admin-nav' / 'admin-dock'）。
// activeKey 与 item 的 data-tab 一致。
export function withDockIndicator(
  nav: HTMLElement,
  ns: string,
  activeKey: string,
  itemSelector: string,
  place: (indicator: HTMLElement, el: HTMLElement) => void,
): HTMLElement {
  const indicator = h('span', { class: 'dock-indicator', 'aria-hidden': 'true' })
  nav.prepend(indicator)

  requestAnimationFrame(() => {
    const active = nav.querySelector<HTMLElement>(`${itemSelector}.is-active`)
    const prevKey = prevByNs.get(ns)
    const prevEl = prevKey ? nav.querySelector<HTMLElement>(`${itemSelector}[data-tab="${prevKey}"]`) : null
    if (!active) return
    const apply = (el: HTMLElement) => place(indicator, el)
    if (prevEl && prevEl !== active) {
      indicator.style.transition = 'none'
      apply(prevEl)
      void indicator.offsetWidth // 强制回流：先让"无过渡"定位生效
      indicator.style.transition = ''
    }
    apply(active)
    prevByNs.set(ns, activeKey)
  })

  return nav
}
