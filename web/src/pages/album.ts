import { api, imgUrl, type Album, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { homeExitButtons, visitorDock } from '../components/visitorNav'
import { wireReveal } from '../components/reveal'
import { photoDisplayTitle, viewToggle } from '../components/viewToggle'
import { navigate, setTeardown } from '../router'

// 相册照片网格：暖纸卡片 + 拍摄时间角标，点击进入全景沉浸。
export async function renderAlbum(albumIdStr: string): Promise<void> {
  const albumId = Number(albumIdStr)
  let album: Album
  let photos: Photo[]
  try {
    const r = await api.album(albumId)
    album = r.album
    photos = r.photos
  } catch {
    navigate('/albums')
    return
  }
  const albumHref = `/a/${album.id}`

  const page = h('div', { class: 'page' }, [
    h('header', { class: 'glass topbar' }, [
      h('div', { class: 'topbar-left' }, [
        h('button', { class: 'icon-btn', 'aria-label': '返回相册列表', onClick: () => navigate('/albums') }, icon('arrow-left')),
        h('div', { class: 'topbar-title-wrap' }, [
          h('h1', { class: 'topbar-title font-accent' }, album.title),
          h('span', { class: 'topbar-sub' }, `${photos.length} 张全景`),
        ]),
      ]),
      h('div', { class: 'topbar-center' }, [viewToggle('albums', { albumsHref: albumHref })]),
      h('div', { class: 'topbar-right' }, [...homeExitButtons()]),
    ]),
    h('main', { class: 'photo-grid' }, photos.length ? photos.map((p, i) => photoCard(p, album.id, i)) : [emptyState()]),
  ])
  // dock 与 .page 平级：脱离 page 入场动画的 transform 包含块，position:fixed 才相对视口
  renderPage([page, visitorDock('albums', { albumsHref: albumHref })])
  setTeardown(wireReveal(page))
}

function photoCard(p: Photo, albumId: number, i: number): HTMLElement {
  const badge = p.shot_at ? fmtDate(p.shot_at) : null
  const locBadge = p.location_name
  const title = photoDisplayTitle(p.title, p.filename)
  return h(
    'figure',
    {
      class: 'photo-card',
      role: 'link',
      tabindex: '0',
      dataset: { reveal: '' },
      style: i < 8 ? `--rd:${i * 40}ms` : undefined, // 首屏 stagger
      onClick: () => navigate(`/p/${p.id}?album=${albumId}`),
      onKeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter') navigate(`/p/${p.id}?album=${albumId}`)
      },
    },
    [
      h('div', { class: 'photo-frame' }, [
        h('img', { class: 'photo-thumb', src: imgUrl('thumb1024', p.sha256), alt: title, loading: 'lazy' }),
        badge ? h('span', { class: 'photo-badge glass-compact' }, [icon('clock', 12), badge]) : null,
        locBadge ? h('span', { class: 'photo-badge photo-badge-loc glass-compact' }, [icon('pin', 12), locBadge]) : null,
      ]),
      h('figcaption', { class: 'photo-caption' }, title),
    ],
  )
}

function emptyState(): HTMLElement {
  return h('div', { class: 'empty-state' }, [
    h('p', { class: 'font-accent empty-title' }, '这个相册还是空的'),
    h('p', { class: 'text-secondary' }, '等分享人导入新的全景吧'),
  ])
}

export function fmtDate(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
