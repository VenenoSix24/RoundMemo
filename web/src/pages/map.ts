/// <reference types="leaflet.markercluster" />
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerclusterUrl from 'leaflet.markercluster/dist/leaflet.markercluster.js?url'
import { api, imgUrl, type MapTileConfig, type Photo } from '../api/client'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { homeExitButtons, visitorDock } from '../components/visitorNav'
import { photoDisplayTitle, viewToggle } from '../components/viewToggle'
import { navigate, setTeardown } from '../router'

// 地图视图记忆：SPA 切换页面/进查看器再回来时，恢复上次的缩放与位置而不是重置到全景范围。
// 带 crs 标记：瓦片源坐标系变化时不沿用旧视图。
let savedView: { center: [number, number]; zoom: number; crs: string } | null = null

// 兜底默认地图源。
// 照片 EXIF GPS 标准为 WGS-84，叠高德（GCJ-02 瓦片）时前端自动换算。
const defaultTile: MapTileConfig = {
  url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  subdomains: '1,2,3,4',
  crs: 'wgs84',
}

// 地图：把会话可见照片按 GPS 标到瓦片地图上（Leaflet + markercluster 聚类）。
// 无 GPS 照片显示空态；点标记进入全景查看器。离开页面时销毁地图实例。
export async function renderMap(): Promise<void> {
  const backBtn = h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': '返回',
      onClick: () => {
        if (history.length > 1) history.back()
        else navigate('/albums')
      },
    },
    icon('arrow-left'),
  )

  const mapWrap = h('div', { class: 'map-wrap' })
  const loading = h('div', { class: 'map-loading' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' })])
  mapWrap.append(loading)

  const page = h('div', { class: 'page' }, [
    h('header', { class: 'glass topbar' }, [
      h('div', { class: 'topbar-left' }, [backBtn, h('h1', { class: 'topbar-title font-accent' }, '地图')]),
      h('div', { class: 'topbar-center' }, [viewToggle('map')]),
      h('div', { class: 'topbar-right' }, [...homeExitButtons()]),
    ]),
    h('main', { class: 'map-page' }, [mapWrap]),
  ])
  renderPage([page, visitorDock('map')])

  // 离开页面即废弃：在途请求回来时不再触碰已卸载 DOM / 已销毁地图
  let disposed = false
  let map: L.Map | null = null
  setTeardown(() => {
    disposed = true
    window.removeEventListener('resize', onResize)
    map?.remove()
    map = null
  })

  // 并行取会话可见照片与瓦片源配置
  const [photos, tileCfg] = await Promise.all([
    api.timeline().then((r) => r.photos).catch(() => null),
    api.settings().then((s) => s.map_tile).catch(() => null),
  ])
  if (disposed) return
  if (!photos) {
    navigate('/albums')
    return
  }
  const cfg = tileCfg ?? defaultTile
  const located = photos.filter((p) => p.gps_lat != null && p.gps_lng != null)

  if (!located.length) {
    loading.replaceWith(
      h('div', { class: 'empty-state map-empty' }, [
        h('p', { class: 'font-accent empty-title' }, '还没有带位置的全景'),
        h('p', { class: 'empty-hint' }, '导入带 GPS 的照片后，它们会在这里留下印记'),
      ]),
    )
    return
  }

  // 先渲染基础地图，再注入 markercluster 补标记
  const rootEl = h('div', { class: 'map-root' })
  loading.replaceWith(rootEl)
  map = L.map(rootEl)
  tileLayerFrom(cfg).addTo(map)
  map.attributionControl.setPrefix(false)

  function onResize(): void {
    map?.invalidateSize()
  }
  window.addEventListener('resize', onResize)

  await ensureMarkerCluster()
  if (disposed) return

  // 瓦片源坐标系：高德=GCJ-02，OSM=WGS-84，未知源按照片坐标系免转换。
  // 照片 EXIF GPS 标准为 WGS-84，与瓦片坐标系不一致时才转换。
  const tileCrs: 'wgs84' | 'gcj02' = cfg.url.includes('autonavi') ? 'gcj02' : cfg.url.includes('openstreetmap') ? 'wgs84' : cfg.crs
  const toCoords = (p: Photo): [number, number] => {
    const [lat, lng] = [p.gps_lat!, p.gps_lng!]
    if (cfg.crs === tileCrs) return [lat, lng]
    return cfg.crs === 'gcj02' ? gcj02ToWgs84(lat, lng) : wgs84ToGcj02(lat, lng)
  }

  const cluster = L.markerClusterGroup({
    iconCreateFunction: clusterIcon,
    maxClusterRadius: 64,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
  })
  for (const p of located) {
    const marker = L.marker(toCoords(p), { icon: photoIcon(p) })
    const title = photoDisplayTitle(p.title, p.filename)
    marker.bindTooltip(title, { direction: 'top', offset: [0, -24], className: 'map-tip' })
    marker.on('click', () => navigate(`/p/${p.id}`))
    marker.on('add', () => {
      const el = marker.getElement()
      if (el) {
        el.setAttribute('role', 'button')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', `${title}，打开全景`)
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') navigate(`/p/${p.id}`)
        })
      }
    })
    cluster.addLayer(marker)
  }
  cluster.addTo(map)

  // 恢复上次视图，否则首次按标记范围取景
  map.on('moveend', () => {
    if (map) savedView = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom(), crs: tileCrs }
  })
  if (savedView && savedView.crs === tileCrs) {
    map.setView(savedView.center, savedView.zoom, { animate: false })
  } else {
    const bounds = L.latLngBounds(located.map(toCoords))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
  }
}

// 按配置构建瓦片图层：subdomains 逗号分隔转数组；{s} 子域由 Leaflet 替换。
function tileLayerFrom(cfg: MapTileConfig): L.TileLayer {
  const opts: L.TileLayerOptions = { maxZoom: 19, attribution: attributionFor(cfg.url) }
  if (cfg.subdomains) {
    opts.subdomains = cfg.subdomains.split(',').map((s) => s.trim()).filter(Boolean)
  }
  let url = cfg.url
  if (url.includes('autonavi') && window.devicePixelRatio >= 1.5) {
    const scl = Math.min(4, Math.ceil(window.devicePixelRatio))
    url += (url.includes('?') ? '&' : '?') + `scl=${scl}`
  }
  return L.tileLayer(url, opts)
}

function attributionFor(url: string): string {
  if (url.includes('autonavi.com')) return '&copy; 高德地图'
  if (url.includes('openstreetmap.org')) return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  try {
    return '&copy; ' + new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// WGS-84 ↔ GCJ-02
function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  const a = 6378245
  const ee = 0.006693421622965943
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng]
  const transLat = (x: number, y: number): number => {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
    ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
    return ret
  }
  const transLng = (x: number, y: number): number => {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
    ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
    return ret
  }
  const dLat = transLat(lng - 105, lat - 35)
  const dLng = transLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const mgLat = lat + (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI)
  const mgLng = lng + (dLng * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return [mgLat, mgLng]
}

// GCJ-02 → WGS-84：单步近似逆变换。
function gcj02ToWgs84(lat: number, lng: number): [number, number] {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng)
  return [lat * 2 - gLat, lng * 2 - gLng]
}

// markercluster 是 UMD，内部引用裸变量 L（ESM 模块作用域取不到 window.L）。
// 解法：设 window.L 后用经典 script 加载其 dist，经典脚本能解析全局 L，从而把
// MarkerCluster 挂到与 import 共享的 leaflet 命名空间对象上。
let clusterLoaded = false
async function ensureMarkerCluster(): Promise<void> {
  if (clusterLoaded || (L as unknown as { markerClusterGroup?: unknown }).markerClusterGroup) return
  ;(window as Window & { L: unknown }).L = L
  const script = document.createElement('script')
  script.src = markerclusterUrl
  await new Promise<void>((resolve, reject) => {
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('地图聚类脚本加载失败'))
    document.head.append(script)
  })
  clusterLoaded = true
}

function photoIcon(p: Photo): L.DivIcon {
  return L.divIcon({
    className: 'map-marker',
    html: `<img src="${imgUrl('thumb256', p.sha256)}" alt="" loading="lazy" onerror="this.remove()">`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount()
  const size = count < 10 ? 40 : count < 100 ? 48 : 56
  return L.divIcon({
    className: 'map-cluster',
    html: `<span>${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
