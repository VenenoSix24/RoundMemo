import { api, type Album, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { PanoramaViewer } from '../viewer/viewer'
import { navigate } from '../router'
import { fmtDate } from './album'

// 全景沉浸页：照片占满视口，控件 1.5s 无操作淡出；顶栏胶囊 + 底部信息抽屉。
export async function renderViewer(photoIdStr: string): Promise<void> {
  const photoId = Number(photoIdStr)
  let photo: Photo
  let album: Album
  let photos: Photo[]
  try {
    photo = await api.photo(photoId)
    const r = await api.album(photo.album_id)
    album = r.album
    photos = r.photos
  } catch {
    navigate('/albums')
    return
  }
  let index = photos.findIndex((p) => p.id === photoId)
  if (index < 0) index = 0

  const root = h('div', { class: 'viewer-page' })
  const canvas = h('canvas', { class: 'viewer-canvas' })
  const loading = h('div', { class: 'viewer-loading glass-compact', role: 'status', 'aria-live': 'polite' }, [
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', {}, '全景加载中'),
  ])
  root.append(canvas, loading)

  // —— 顶栏控件 ——
  const counter = h('span', { class: 'viewer-counter' }, '')
  const pill = h('div', { class: 'glass viewer-pill' }, [
    h('button', { class: 'icon-btn', 'aria-label': '返回相册', onClick: () => navigate(`/a/${album.id}`) }, icon('arrow-left')),
    h('div', { class: 'viewer-middle' }, [
      h('button', { class: 'icon-btn', 'aria-label': '上一张', onClick: () => goTo(index - 1) }, icon('arrow-left')),
      counter,
      h('button', { class: 'icon-btn', 'aria-label': '下一张', onClick: () => goTo(index + 1) }, icon('arrow-right')),
    ]),
    h('div', { class: 'viewer-actions' }, [
      h('button', { class: 'icon-btn gyro-btn', 'aria-label': '开启看景视角', title: '陀螺仪', onClick: onGyro }, icon('compass')),
      h('button', { class: 'icon-btn', 'aria-label': '重置朝向', title: '重置', onClick: () => viewer.resetView() }, icon('reset')),
      h('button', { class: 'icon-btn', 'aria-label': '照片信息', onClick: () => toggleDrawer() }, icon('info')),
    ]),
  ])
  root.append(pill)

  // —— 照片信息：左上浮层 ——
  const drawer = h('aside', { class: 'glass viewer-drawer', 'aria-hidden': 'true' })
  drawer.append(buildDrawerContent(photo, drawer))
  root.append(drawer)

  renderPage(root)

  // 先挂载再创建查看器：容器已有真实尺寸，画布初始宽高才正确。
  const viewer = new PanoramaViewer(root, canvas)

  function goTo(i: number): void {
    if (i < 0 || i >= photos.length) return
    index = i
    const p = photos[i]
    history.replaceState(null, '', `/p/${p.id}`)
    updateCounter()
    loading.classList.add('is-shown')
    void viewer.load(p.sha256).finally(() => loading.classList.remove('is-shown'))
  }

  function updateCounter(): void {
    counter.textContent = `第 ${index + 1} / ${photos.length} 张`
  }

  function toggleDrawer(): void {
    const open = drawer.getAttribute('aria-hidden') === 'true'
    drawer.setAttribute('aria-hidden', String(!open))
  }

  async function onGyro(): Promise<void> {
    const on = await viewer.toggleGyro()
    const btn = pill.querySelector('.gyro-btn')
    if (btn) btn.classList.toggle('is-active', on)
  }

  // —— 控件 idle 淡出（尊重 reduced-motion）——
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let idleTimer = 0
  const showControls = () => {
    root.classList.add('controls-visible')
    if (reduced) return
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => root.classList.remove('controls-visible'), 1500)
  }
  if (!reduced) {
    window.addEventListener('mousemove', showControls)
    window.addEventListener('touchstart', showControls)
    root.classList.add('controls-visible')
    idleTimer = window.setTimeout(() => root.classList.remove('controls-visible'), 1500)
  } else {
    root.classList.add('controls-visible')
  }

  // —— 键盘切换（与查看器共用 window keydown，键位不冲突）——
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goTo(index - 1)
    if (e.key === 'ArrowRight') goTo(index + 1)
  }
  window.addEventListener('keydown', onKey)

  updateCounter()
  loading.classList.add('is-shown')
  void viewer
    .load(photos[index].sha256)
    .catch(() => {
      /* 图片加载失败：保持深色底，不阻断 */
    })
    .finally(() => loading.classList.remove('is-shown'))

  // 页面卸载时释放 WebGL 上下文
  window.addEventListener('pagehide', dispose)
  function dispose(): void {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mousemove', showControls)
    window.removeEventListener('touchstart', showControls)
    window.removeEventListener('pagehide', dispose)
    viewer.dispose()
  }
}

function buildDrawerContent(p: Photo, drawer: HTMLElement): HTMLElement {
  const rows: [string, string][] = [
    ['拍摄时间', p.shot_at ? fmtDate(p.shot_at) : '未知'],
    ['位置', p.gps_lat != null && p.gps_lng != null ? `${p.gps_lat.toFixed(5)}, ${p.gps_lng.toFixed(5)}` : '无位置信息'],
    ['设备', [p.device_make, p.device_model].filter(Boolean).join(' ') || '未知'],
    ['描述', p.title || p.description || '—'],
  ]
  return h('div', { class: 'drawer-inner' }, [
    h('div', { class: 'drawer-head' }, [
      h('h2', { class: 'font-accent drawer-title' }, '照片信息'),
      h('button', { class: 'icon-btn', 'aria-label': '关闭', onClick: () => drawer.setAttribute('aria-hidden', 'true') }, icon('x')),
    ]),
    ...rows.map(([k, v]) =>
      h('div', { class: 'drawer-row' }, [h('span', { class: 'drawer-key text-muted' }, k), h('span', { class: 'drawer-val' }, v)]),
    ),
  ])
}
