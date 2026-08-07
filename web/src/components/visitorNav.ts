import { h } from './dom'
import { icon } from './icons'
import { state, rememberGroup } from '../state'
import { navigate } from '../router'
import { openModal } from './modal'
import { withDockIndicator } from './dockIndicator'
import { api } from '../api/client'
import type { VisitorView } from './viewToggle'

// 访客导航：移动端底部悬浮 dock（液态玻璃，含滑动指示器）、顶栏分组品牌切换（圆忆·xxx▾）、
// 首页/彻底退出按钮。三页共用，保证顶栏视觉一致。

export interface VisitorNavCtx {
  // 「相册」tab 的目标：从相册照片页进入时间线时回该照片页，否则回相册列表。
  albumsHref?: string
}

// 移动端底部悬浮 dock（液态玻璃 + 滑动指示器）。
export function visitorDock(current: VisitorView, ctx: VisitorNavCtx = {}): HTMLElement {
  const item = (view: VisitorView, label: string, iconName: string, opts?: { disabled?: boolean; onClick?: () => void }) =>
    h(
      'button',
      {
        class: 'dock-item' + (current === view ? ' is-active' : ''),
        type: 'button',
        disabled: opts?.disabled ? 'disabled' : undefined,
        dataset: { tab: view },
        onClick: opts?.onClick,
        title: opts?.disabled ? '地图视图开发中' : undefined,
      },
      [icon(iconName, 20), h('span', {}, label)],
    )
  const nav = h('nav', { class: 'visitor-dock', 'aria-label': '底部导航' }, [
    item('albums', '相册', 'grid', { onClick: () => navigate(ctx.albumsHref ?? '/albums') }),
    item('timeline', '时间线', 'list', { onClick: () => navigate(timelineHref()) }),
    item('map', '地图', 'pin', { onClick: () => navigate('/map') }),
  ])
  return withDockIndicator(nav, 'visitor-dock', current, '.dock-item', (indicator, el) => {
    indicator.style.width = `${el.offsetWidth}px`
    indicator.style.transform = `translateX(${el.offsetLeft}px)`
  })
}

// 时间线带来源参数：让返回按钮/「相册」tab 能回到来源页（如某个相册的照片页）。
function timelineHref(): string {
  return `/timeline?from=${encodeURIComponent(location.pathname)}`
}

// 顶栏品牌 + 分组切换：「圆忆 · {分组名} [▾]」整行可点，无背景，点击弹层切换分组。
export function groupBrand(): HTMLElement {
  return h(
    'button',
    {
      class: 'group-brand',
      type: 'button',
      'aria-label': '切换分组',
      title: '切换分组',
      onClick: () => groupChooser(),
    },
    [
      h('span', { class: 'group-brand-name font-accent' }, '圆忆'),
      h('span', { class: 'group-brand-sep' }, '·'),
      h('span', { class: 'group-brand-group' }, activeGroupName()),
      h('span', { class: 'group-brand-chev' }, icon('chevron-down', 14)),
    ],
  )
}

// 分组切换弹层：列出已有分组，点选即切换并回相册列表。
function groupChooser(): void {
  const items = state.groups.map((gr) =>
    h(
      'button',
      {
        class: 'chooser-item' + (gr.id === state.activeGroupId ? ' is-current' : ''),
        type: 'button',
        onClick: () => {
          rememberGroup(gr.id)
          close()
          navigate('/albums')
        },
      },
      [h('span', { class: 'chooser-name' }, gr.name), gr.id === state.activeGroupId ? h('span', { class: 'chooser-tag' }, '当前') : null],
    ),
  )
  const { close } = openModal(h('div', { class: 'modal-body entry-chooser' }, [
    h('h3', { class: 'modal-title' }, '切换分组'),
    ...items,
  ]))
}

export function activeGroupName(): string {
  return state.groups.find((g) => g.id === state.activeGroupId)?.name ?? ''
}

// 顶栏右侧：返回首页 + 彻底退出。
export function homeExitButtons(): HTMLElement[] {
  const homeBtn = h('button', {
    class: 'icon-btn',
    'aria-label': '返回首页',
    title: '返回首页（保留当前访问）',
    onClick: () => navigate('/'),
  }, icon('home'))

  const exitBtn = h('button', {
    class: 'icon-btn view-exit',
    'aria-label': '彻底退出',
    title: '彻底退出（清空当前访问，下次需重新输入口令）',
    onClick: async () => {
      try {
        await api.revoke()
      } catch {
        /* 无会话时忽略 */
      }
      state.groups = []
      state.activeGroupId = 0
      navigate('/')
    },
  }, icon('logout'))

  return [homeBtn, exitBtn]
}
