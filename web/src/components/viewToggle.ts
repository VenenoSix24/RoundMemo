import { h } from './dom'
import { icon } from './icons'
import { navigate } from '../router'

// 相册/时间线视图切换：当前视图高亮，点另一端导航过去。
export function viewToggle(current: 'grid' | 'timeline'): HTMLElement {
  return h('div', { class: 'view-seg', role: 'group', 'aria-label': '视图切换' }, [
    h('button', {
      class: 'view-seg-btn' + (current === 'grid' ? ' is-active' : ''),
      type: 'button',
      'aria-pressed': current === 'grid' ? 'true' : 'false',
      onClick: () => navigate('/albums'),
    }, [icon('grid', 18), h('span', {}, '网格')]),
    h('button', {
      class: 'view-seg-btn' + (current === 'timeline' ? ' is-active' : ''),
      type: 'button',
      'aria-pressed': current === 'timeline' ? 'true' : 'false',
      onClick: () => navigate('/timeline'),
    }, [icon('list', 18), h('span', {}, '时间线')]),
  ])
}

// 文件名兜底标题：去扩展名（含 .PHOTOSPHERE 这类双扩展）、下划线转空格。
export function photoDisplayTitle(title: string | null, filename: string): string {
  if (title) return title
  if (!filename) return '全景'
  const base = filename.replace(/\.(PHOTOSPHERE\.)?(jpe?g|png|webp|heic)$/i, '')
  return base.replace(/_/g, ' ')
}
