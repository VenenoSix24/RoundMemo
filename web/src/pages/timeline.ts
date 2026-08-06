import { api, imgUrl, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { navigate } from '../router'

// 时间线：按拍摄时间纵向轴，年份粘性标签 + 月份分组。
export async function renderTimeline(): Promise<void> {
  let photos: Photo[] = []
  try {
    photos = (await api.timeline()).photos
  } catch {
    navigate('/albums')
    return
  }

  const groups = groupByMonth(photos)
  renderPage(
    h('div', { class: 'page' }, [
      h('header', { class: 'glass topbar' }, [
        h('div', { class: 'topbar-left' }, [
          h('button', { class: 'icon-btn', 'aria-label': '返回', onClick: () => navigate('/albums') }, icon('arrow-left')),
          h('h1', { class: 'topbar-title font-accent' }, '时间线'),
        ]),
      ]),
      h('main', { class: 'timeline' }, groups.length ? groups.map(monthGroup) : [emptyState()]),
    ]),
  )
}

function groupByMonth(photos: Photo[]): { year: number; label: string; photos: Photo[] }[] {
  const map = new Map<string, { year: number; label: string; photos: Photo[] }>()
  for (const p of photos) {
    if (!p.shot_at) {
      const key = 'unknown'
      if (!map.has(key)) map.set(key, { year: 0, label: '未知时间', photos: [] })
      map.get(key)!.photos.push(p)
      continue
    }
    const t = new Date(p.shot_at * 1000)
    const key = `${t.getFullYear()}-${t.getMonth()}`
    if (!map.has(key)) {
      map.set(key, { year: t.getFullYear(), label: `${t.getFullYear()} 年 ${t.getMonth() + 1} 月`, photos: [] })
    }
    map.get(key)!.photos.push(p)
  }
  return [...map.values()]
}

function monthGroup(g: { year: number; label: string; photos: Photo[] }): HTMLElement {
  return h('section', { class: 'timeline-group', 'data-year': String(g.year) }, [
    h('h2', { class: 'timeline-month font-accent' }, g.label),
    h('div', { class: 'timeline-strip' }, g.photos.map(timelineItem)),
  ])
}

function timelineItem(p: Photo): HTMLElement {
  const time = p.shot_at ? fmtDay(p.shot_at) : '未知时间'
  return h(
    'button',
    {
      class: 'timeline-item',
      type: 'button',
      onClick: () => navigate(`/p/${p.id}`),
    },
    [
      h('img', { class: 'timeline-thumb', src: imgUrl('thumb256', p.sha256), alt: '', loading: 'lazy' }),
      h('div', { class: 'timeline-meta' }, [
        h('span', { class: 'timeline-time' }, time),
        h('span', { class: 'timeline-title text-muted' }, p.title ?? (p.device_model ? p.device_model : '全景')),
      ]),
    ],
  )
}

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyState(): HTMLElement {
  return h('div', { class: 'empty-state' }, [h('p', { class: 'font-accent empty-title' }, '还没有带时间的照片')])
}
