import { api, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { toast } from '../components/modal'
import { icon } from '../components/icons'
import { photoDisplayTitle } from '../components/viewToggle'
import { PanoramaViewer } from '../viewer/viewer'
import { navigate } from '../router'
import { fmtDate } from './album'

// 照片占满视口。左上常驻「返回 + 照片信息」，底部控制胶囊（上一张/计数/下一张 + 陀螺仪/重置）1.5s 无操作淡出。
export async function renderViewer(photoIdStr: string): Promise<void> {
  const photoId = Number(photoIdStr)
  let albumId = Number(new URLSearchParams(location.search).get('album')) || 0
  let photo: Photo
  let photos: Photo[]
  try {
    photo = await api.photo(photoId)
    if (!albumId) albumId = photo.album_ids[0] ?? 0
    const r = await api.album(albumId)
    photos = r.photos
  } catch {
    navigate('/albums')
    return
  }
  let index = photos.findIndex((p) => p.id === photoId)
  if (index < 0) index = 0

  const root = h('div', { class: 'viewer-page' })
  const canvas = h('canvas', { class: 'viewer-canvas' })
  // 首张加载与照片切换共用
  const enter = h('div', { class: 'viewer-enter', role: 'status', 'aria-live': 'polite' }, [
    h('div', { class: 'viewer-enter-brand' }, [
      h('span', { class: 'font-accent viewer-enter-name' }, '圆忆'),
      h('span', { class: 'viewer-enter-sub' }, '正在进入这个时刻'),
    ]),
    h('span', { class: 'spinner viewer-enter-spinner', 'aria-hidden': 'true' }),
  ])
  root.append(canvas, enter)

  // —— 底部控制胶囊 ——
  const counter = h('span', { class: 'viewer-counter' }, '')
  const pill = h('div', { class: 'glass viewer-pill' }, [
    h('div', { class: 'viewer-middle' }, [
      h('button', { class: 'icon-btn', 'aria-label': '上一张', onClick: () => goTo(index - 1) }, icon('arrow-left')),
      counter,
      h('button', { class: 'icon-btn', 'aria-label': '下一张', onClick: () => goTo(index + 1) }, icon('arrow-right')),
    ]),
    h('div', { class: 'viewer-actions' }, [
      ...(PanoramaViewer.gyroSupported()
        ? [h('button', { class: 'icon-btn gyro-btn', 'aria-label': '开启看景视角', title: '陀螺仪', onClick: onGyro }, icon('compass'))]
        : []),
      h('button', { class: 'icon-btn', 'aria-label': '重置朝向', title: '重置', onClick: () => viewer.resetView() }, icon('reset')),
    ]),
  ])
  root.append(pill)

  // —— 左上：返回相册 + 常驻照片信息 ——
  const infoTitle = h('h1', { class: 'font-accent viewer-info-title' })
  const infoMeta = h('div', { class: 'viewer-info-meta' })
  const info = h('div', { class: 'viewer-info' }, [infoTitle, infoMeta])
  const backBtn = h('button', {
    class: 'btn btn-ghost viewer-back',
    type: 'button',
    // 返回上一个页面
    onClick: () => {
      if (history.length > 1) history.back()
      else navigate(albumId ? `/a/${albumId}` : '/albums')
    },
  }, [icon('arrow-left', 16), '返回'])
  const top = h('div', { class: 'viewer-top' }, [backBtn, info])
  root.append(top)

  renderPage(root)

  // 先挂载再创建查看器
  const viewer = new PanoramaViewer(root, canvas)

  let enterResetTimer = 0
  function showEnter(): void {
    window.clearTimeout(enterResetTimer)
    enter.classList.remove('is-done')
    enter.classList.add('is-shown')
  }
  function hideEnter(): void {
    enter.classList.add('is-done')
    window.clearTimeout(enterResetTimer)
    enterResetTimer = window.setTimeout(() => {
      enter.classList.remove('is-shown')
      enter.classList.remove('is-done')
    }, 550) // 等 is-done 的 500ms 淡出完成再复位，供下次复用
  }

  let hideTimer = 0
  function beginLoad(sha: string): Promise<void> {
    // 每次加载/切换都显示品牌遮罩，覆盖网络加载与黑屏过渡
    showEnter()
    window.clearTimeout(hideTimer)
    return viewer.load(sha).finally(() => {
      // 黑屏过渡约 280ms + 遮罩自身淡入淡出，加载完成后延迟隐藏
      hideTimer = window.setTimeout(hideEnter, 650)
    })
  }

  function goTo(i: number): void {
    if (i < 0 || i >= photos.length) return
    index = i
    const p = photos[i]
    history.replaceState(null, '', `/p/${p.id}?album=${albumId}`)
    updateCounter()
    updateInfo(p)
    // 视角重置在 viewer.load 应用新纹理时进行，不在加载期间提前切
    void beginLoad(p.sha256)
  }

  function updateCounter(): void {
    counter.textContent = `第 ${index + 1} / ${photos.length} 张`
  }

  function updateInfo(p: Photo): void {
    infoTitle.textContent = photoDisplayTitle(p.title, p.filename)
    const meta: Array<{ icon: string; text: string }> = []
    if (p.shot_at) meta.push({ icon: 'clock', text: fmtDate(p.shot_at) })
    // 自定义地点优先，其次经纬度坐标
    if (p.location_name) meta.push({ icon: 'pin', text: p.location_name })
    else if (p.gps_lat != null && p.gps_lng != null) meta.push({ icon: 'pin', text: `${p.gps_lat.toFixed(4)}, ${p.gps_lng.toFixed(4)}` })
    if (p.description) meta.push({ icon: 'info', text: p.description })
    const device = [p.device_make, p.device_model].filter(Boolean).join(' ')
    if (device) meta.push({ icon: 'camera', text: device })
    infoMeta.replaceChildren(...meta.map((m) => h('span', { class: 'viewer-info-item' }, [icon(m.icon, 14), m.text])))
  }

  async function onGyro(): Promise<void> {
    const btn = pill.querySelector('.gyro-btn')
    const wasOn = btn?.classList.contains('is-active') ?? false
    const on = await viewer.toggleGyro()
    if (btn) btn.classList.toggle('is-active', on)
    if (!on && !wasOn) toast('陀螺仪不可用：权限被拒绝或设备无传感器')
  }

  // —— 控件 idle 淡出（仅底部胶囊）——
  // 鼠标悬停在工具栏上时不隐藏，移出后再计时隐藏。
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let idleTimer = 0
  const hideAfterIdle = () => {
    if (reduced) return
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      if (pill.matches(':hover')) return // 鼠标仍在工具栏上则保持常驻
      root.classList.remove('controls-visible')
    }, 1500)
  }
  const showControls = () => {
    root.classList.add('controls-visible')
    hideAfterIdle()
  }
  if (!reduced) {
    window.addEventListener('mousemove', showControls)
    window.addEventListener('touchstart', showControls)
    pill.addEventListener('mouseleave', showControls) // 移出工具栏立即重新计时
  }
  showControls()

  // —— 键盘切换——
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goTo(index - 1)
    if (e.key === 'ArrowRight') goTo(index + 1)
  }
  window.addEventListener('keydown', onKey)

  updateCounter()
  updateInfo(photo)
  // beginLoad 内部已亮品牌遮罩，等纹理加载完再淡出
  void beginLoad(photos[index].sha256)
    .catch(() => {
      /* 图片加载失败：保持深色底，不阻断 */
    })

  // 页面卸载时释放 WebGL 上下文
  window.addEventListener('pagehide', dispose)
  function dispose(): void {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mousemove', showControls)
    window.removeEventListener('touchstart', showControls)
    pill.removeEventListener('mouseleave', showControls)
    window.removeEventListener('pagehide', dispose)
    window.clearTimeout(hideTimer)
    window.clearTimeout(enterResetTimer)
    viewer.dispose()
  }
}
