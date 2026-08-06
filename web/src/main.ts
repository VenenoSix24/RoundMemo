import './styles/base.css'
import './styles/pages.css'
import './styles/admin.css'
import { navigate, route, startRouter } from './router'
import { renderEntry } from './pages/entry'
import { renderAlbums } from './pages/albums'
import { renderAlbum } from './pages/album'
import { renderViewer } from './pages/viewerPage'
import { renderTimeline } from './pages/timeline'
import { renderShare } from './pages/share'
import { renderAdminLogin } from './pages/admin/login'
import { renderAdminShell } from './pages/admin/shell'
import { renderAdminPhotos } from './pages/admin/photos'
import { renderAdminGrants } from './pages/admin/grants'
import { renderAdminGroups } from './pages/admin/groups'
import { renderAdminAlbums } from './pages/admin/albums'
import { renderAdminAlbumPhotos } from './pages/admin/adminPhotos'
import { renderAdminSettings } from './pages/admin/settings'

route('/', () => void renderEntry())
route('/albums', () => void renderAlbums())
route('/a/:albumId', (p) => void renderAlbum(p.albumId))
route('/p/:photoId', (p) => void renderViewer(p.photoId))
route('/timeline', () => void renderTimeline())
route('/s/:token', (p) => void renderShare(p.token))

// Owner 后台
route('/admin', () => navigate('/admin/photos'))
route('/admin/login', () => void renderAdminLogin())
route('/admin/photos', () => void renderAdminShell('photos', renderAdminPhotos))
route('/admin/albums', () => void renderAdminShell('albums', renderAdminAlbums))
route('/admin/albums/:albumId/photos', (p) => void renderAdminShell('albums', (m) => renderAdminAlbumPhotos(p.albumId, m)))
route('/admin/grants', () => void renderAdminShell('grants', renderAdminGrants))
route('/admin/groups', () => void renderAdminShell('groups', renderAdminGroups))
route('/admin/settings', () => void renderAdminShell('settings', renderAdminSettings))

startRouter()

// 应用站点级设置：浏览器标签页标题与图标（后台「设置」页配置）
void (async () => {
  try {
    const res = await fetch('/api/settings', { credentials: 'same-origin' })
    const s = (await res.json()) as { site_title: string; has_favicon: boolean }
    if (s.site_title) document.title = s.site_title
    if (s.has_favicon) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link')
      link.rel = 'icon'
      link.href = '/api/settings/favicon'
      document.head.append(link)
    }
  } catch {
    /* 设置未就绪时保持默认标题/图标 */
  }
})()
