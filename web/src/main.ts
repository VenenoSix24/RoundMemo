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
import { renderAdminGrants } from './pages/admin/grants'
import { renderAdminGroups } from './pages/admin/groups'
import { renderAdminAlbums } from './pages/admin/albums'
import { renderAdminAlbumPhotos } from './pages/admin/adminPhotos'
import { renderAdminImport } from './pages/admin/import'
import { renderAdminSessions } from './pages/admin/sessions'

route('/', () => void renderEntry())
route('/albums', () => void renderAlbums())
route('/a/:albumId', (p) => void renderAlbum(p.albumId))
route('/p/:photoId', (p) => void renderViewer(p.photoId))
route('/timeline', () => void renderTimeline())
route('/s/:token', (p) => void renderShare(p.token))

// Owner 后台
route('/admin', () => navigate('/admin/grants'))
route('/admin/login', () => void renderAdminLogin())
route('/admin/albums', () => void renderAdminShell('albums', renderAdminAlbums))
route('/admin/albums/:albumId/photos', (p) => void renderAdminShell('albums', (m) => renderAdminAlbumPhotos(p.albumId, m)))
route('/admin/groups', () => void renderAdminShell('groups', renderAdminGroups))
route('/admin/grants', () => void renderAdminShell('grants', renderAdminGrants))
route('/admin/import', () => void renderAdminShell('import', renderAdminImport))
route('/admin/sessions', () => void renderAdminShell('sessions', renderAdminSessions))

startRouter()
