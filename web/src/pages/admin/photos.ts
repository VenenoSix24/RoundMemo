import { adminApi, uploadPhotos, type AdminPhoto } from '../../api/admin'
import { imgUrl } from '../../api/client'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, toast } from '../../components/modal'
import { baseName, fmtDateTime, openPhotoEditModal } from './photoEditModal'

// 照片池：跨相册全量照片，可上传进池、编辑信息、删除。
export async function renderAdminPhotos(main: HTMLElement): Promise<void> {
  const [photosRes, albumsRes] = await Promise.all([adminApi.allPhotos(), adminApi.albums()])
  let photos = photosRes.photos
  const albums = albumsRes.albums
  const albumName = (id: number): string => albums.find((a) => a.id === id)?.title ?? `相册 #${id}`

  const count = h('span', { class: 'admin-section-desc text-muted', 'data-el': 'count' }, '')
  const grid = h('div', { class: 'admin-photo-grid' })

  const render = () => {
    count.textContent = `共 ${photos.length} 张`
    grid.replaceChildren(...photos.map((p) => photoCard(p, albumName, {
      onEdited: (u) => { photos = photos.map((x) => (x.id === u.id ? u : x)); render() },
      onDeleted: async (id) => {
        const ok = await confirmDialog('删除照片', '确认从照片池删除该照片？将从所有相册移除并删除原图与缩略图，不可恢复。', true)
        if (!ok) return
        try {
          await adminApi.deletePhoto(id)
          photos = photos.filter((x) => x.id !== id)
          render()
          toast('照片已删除')
        } catch (e) {
          toast(e instanceof Error ? e.message : '删除失败')
        }
      },
    })))
  }

  // —— 上传进照片池 ——
  const fileInput = h('input', { type: 'file', class: 'import-file', multiple: true, accept: 'image/*', 'aria-hidden': 'true' })
  const upText = h('span', { class: 'import-progress-text', 'data-el': 'upText' }, '')
  let uploading = false
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? [])
    fileInput.value = ''
    if (uploading || !files.length) return
    uploading = true
    upText.textContent = '上传中…'
    void uploadPhotos(files, (pct) => { upText.textContent = `上传中 ${pct}%` })
      .then(({ results }) => {
        uploading = false
        const ok = results.filter((r) => r.status === 'added').length
        const dup = results.filter((r) => r.status === 'duplicate').length
        const err = results.length - ok - dup
        upText.textContent = `新增 ${ok}${dup ? `，已存在 ${dup}` : ''}${err ? `，失败 ${err}` : ''}`
        return adminApi.allPhotos()
      })
      .then(({ photos: updated }) => { photos = updated; render() })
      .catch((e) => {
        uploading = false
        upText.textContent = e instanceof Error ? e.message : '上传失败'
      })
  })
  const uploadBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => fileInput.click() }, [icon('upload', 18), '上传到池'])

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [
      h('h2', { class: 'admin-section-title' }, '照片池'),
      h('p', { class: 'admin-section-desc text-muted' }, '上传的照片都在这里，相册从池中挑选组成。'),
    ]),
    h('div', { class: 'admin-head-inline' }, [count, uploadBtn, fileInput, upText]),
  ])

  main.replaceChildren(header, grid)
  render()
}

interface PhotoCtx {
  onEdited: (p: AdminPhoto) => void
  onDeleted: (id: number) => void
}

function photoCard(p: AdminPhoto, albumName: (id: number) => string, ctx: PhotoCtx): HTMLElement {
  const title = p.title || baseName(p.filename) || '未命名'
  const albumsText = p.album_ids.length ? p.album_ids.map(albumName).join('、') : '未加入相册'
  return h('figure', { class: 'admin-photo-card' }, [
    h('div', { class: 'admin-photo-thumb' }, [
      h('img', { src: imgUrl('thumb1024', p.sha256), alt: title, loading: 'lazy' }),
    ]),
    h('figcaption', { class: 'admin-photo-meta' }, [
      h('span', { class: 'admin-photo-title' }, title),
      h('span', { class: 'admin-photo-sub text-muted' }, `${albumsText} · ${p.shot_at ? fmtDateTime(p.shot_at) : '未设时间'}`),
    ]),
    h('div', { class: 'admin-photo-actions' }, [
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => openPhotoEditModal(p, ctx.onEdited) }, [icon('edit', 16), '编辑']),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onClick: () => void ctx.onDeleted(p.id) }, [icon('trash', 16), '删除']),
    ]),
  ])
}
