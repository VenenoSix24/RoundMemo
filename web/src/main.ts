import './styles/base.css'
import './styles/pages.css'
import { route, startRouter } from './router'
import { renderEntry } from './pages/entry'
import { renderAlbums } from './pages/albums'
import { renderAlbum } from './pages/album'
import { renderViewer } from './pages/viewerPage'
import { renderTimeline } from './pages/timeline'
import { renderShare } from './pages/share'

route('/', () => void renderEntry())
route('/albums', () => void renderAlbums())
route('/a/:albumId', (p) => void renderAlbum(p.albumId))
route('/p/:photoId', (p) => void renderViewer(p.photoId))
route('/timeline', () => void renderTimeline())
route('/s/:token', (p) => void renderShare(p.token))

startRouter()
