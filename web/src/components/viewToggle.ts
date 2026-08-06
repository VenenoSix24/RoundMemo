import { h } from './dom'
import { icon } from './icons'
import { navigate } from '../router'

// 视图切换：相册 / 时间线 / 地图（占位）。桌面端顶栏居中分段控件，移动端由 dock 承担。

export type VisitorView = 'albums' | 'timeline' | 'map'

export interface ViewToggleCtx {
  // 「相册」tab 的目标：从相册照片页进入时间线时回该照片页，否则回相册列表。
  albumsHref?: string
}

function timelineHref(): string {
  return `/timeline?from=${encodeURIComponent(location.pathname)}`
}

export function viewToggle(current: VisitorView, ctx: ViewToggleCtx = {}): HTMLElement {
  const item = (view: VisitorView, label: string, iconName: string, disabled = false, onClick?: () => void) =>
    h(
      'button',
      {
        class: 'view-seg-btn' + (current === view ? ' is-active' : ''),
        type: 'button',
        disabled: disabled ? 'disabled' : undefined,
        'aria-pressed': current === view ? 'true' : 'false',
        onClick,
        title: disabled ? '地图视图开发中' : undefined,
      },
      [icon(iconName, 18), h('span', {}, label)],
    )
  return h('div', { class: 'view-seg', role: 'group', 'aria-label': '视图切换' }, [
    item('albums', '相册', 'grid', false, () => navigate(ctx.albumsHref ?? '/albums')),
    item('timeline', '时间线', 'list', false, () => navigate(timelineHref())),
    item('map', '地图', 'pin', true),
  ])
}

// 文件名兜底标题：去扩展名（含 .PHOTOSPHERE 这类双扩展）、下划线转空格。
export function photoDisplayTitle(title: string | null, filename: string): string {
  if (title) return title
  if (!filename) return '全景'
  const base = filename.replace(/\.(PHOTOSPHERE\.)?(jpe?g|png|webp|heic)$/i, '')
  return base.replace(/_/g, ' ')
}
