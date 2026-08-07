import { api, imgUrl, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { homeExitButtons, visitorDock } from '../components/visitorNav'
import { wireReveal } from '../components/reveal'
import { photoDisplayTitle, viewToggle } from '../components/viewToggle'
import { navigate, setTeardown } from '../router'

// 时间线：按拍摄时间纵向轴，月份分组 + 粘性标签；每条目 = 缩略图 + 标题 + 时间 + 地点。
// 返回按钮优先回来源页（从相册照片页进入则回该页），否则回相册列表；「相册」tab 同理。
export async function renderTimeline(): Promise<void> {
  let photos: Photo[] = []
  try {
    photos = (await api.timeline()).photos
  } catch {
    navigate('/albums')
    return
  }

  const from = new URLSearchParams(location.search).get('from')
  const albumsHref = from?.startsWith('/a/') ? from : '/albums'

  const backBtn = h('button', {
    class: 'icon-btn',
    'aria-label': '返回',
    onClick: () => {
      if (from?.startsWith('/a/')) { navigate(from); return }
      if (history.length > 1) history.back()
      else navigate('/albums')
    },
  }, icon('arrow-left'))

  const groups = groupByMonth(photos)
  const page = h('div', { class: 'page' }, [
    h('header', { class: 'glass topbar' }, [
      h('div', { class: 'topbar-left' }, [backBtn, h('h1', { class: 'topbar-title font-accent' }, '时间线')]),
      h('div', { class: 'topbar-center' }, [viewToggle('timeline', { albumsHref })]),
      h('div', { class: 'topbar-right' }, [...homeExitButtons()]),
    ]),
    h('main', { class: 'timeline' }, groups.length ? groups.map((g, i) => monthGroup(g, i)) : [emptyState()]),
  ])
  // dock 与 .page 平级：脱离 page 入场动画的 transform 包含块，position:fixed 才相对视口
  renderPage([page, visitorDock('timeline', { albumsHref })])
  setTeardown(wireReveal(page))
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

function monthGroup(g: { year: number; label: string; photos: Photo[] }, i: number): HTMLElement {
  return h(
    'section',
    {
      class: 'timeline-group',
      'data-year': String(g.year),
      dataset: { reveal: '' },
      style: i < 6 ? `--rd:${i * 40}ms` : undefined, // 首屏 stagger
    },
    [h('h2', { class: 'timeline-month font-accent' }, g.label), h('div', { class: 'timeline-strip' }, g.photos.map(timelineItem))],
  )
}

function timelineItem(p: Photo): HTMLElement {
  const title = photoDisplayTitle(p.title, p.filename)
  const time = p.shot_at ? fmtDay(p.shot_at) : '时间未知'
  const hasGPS = p.gps_lat != null && p.gps_lng != null
  const loc = hasGPS ? `${p.gps_lat!.toFixed(4)}, ${p.gps_lng!.toFixed(4)}` : '地点未知'
  return h(
    'article',
    {
      class: 'timeline-item',
      role: 'link',
      tabindex: '0',
      onClick: () => navigate(`/p/${p.id}`),
      onKeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter') navigate(`/p/${p.id}`)
      },
    },
    [
      h('img', { class: 'timeline-thumb', src: imgUrl('thumb256', p.sha256), alt: title, loading: 'lazy' }),
      h('div', { class: 'timeline-body' }, [
        h('h3', { class: 'timeline-title font-accent' }, title),
        h('div', { class: 'timeline-meta' }, [
          h('span', { class: 'timeline-time' }, [icon('clock', 14), time]),
          h('span', { class: 'timeline-loc' }, [icon('pin', 14), loc]),
        ]),
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
