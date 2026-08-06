import { adminApi, type AdminPhoto } from '../../api/admin'
import { imgUrl } from '../../api/client'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, openModal, toast } from '../../components/modal'
import { navigate } from '../../router'
import { baseName, fmtDateTime, openPhotoEditModal } from './photoEditModal'

// 相册照片管理（后台子页）：照片池 → 相册的挂接视图。
// 可「从照片池添加」组成相册、编辑信息、设封面、从相册移除（仅解引用，不删池）。
export async function renderAdminAlbumPhotos(albumIdStr: string, main: HTMLElement): Promise<void> {
  const albumId = Number(albumIdStr)
  const [albumsRes, photosRes] = await Promise.all([adminApi.albums(), adminApi.albumPhotos(albumId)])
  const album = albumsRes.albums.find((a) => a.id === albumId)
  let photos = photosRes.photos
  let coverId = album?.cover_photo_id ?? null

  const grid = h('div', { class: 'admin-photo-grid' })
  const render = () => {
    grid.replaceChildren(...photos.map((p) => photoCard(p, {
      isCover: p.id === coverId,
      onEdited: (u) => { photos = photos.map((x) => (x.id === u.id ? u : x)); render() },
      onSetCover: async (id) => {
        try {
          await adminApi.setCover(albumId, id)
          coverId = id
          render()
          toast('已设为封面')
        } catch (e) {
          toast(e instanceof Error ? e.message : '设置失败')
        }
      },
      onDetach: async (id) => {
        const ok = await confirmDialog('从相册移除', '仅从该相册移除（照片仍留在照片池，其他相册不受影响）。', true)
        if (!ok) return
        try {
          await adminApi.detachPhoto(albumId, id)
          if (coverId === id) coverId = null
          photos = photos.filter((x) => x.id !== id)
          render()
          toast('已从相册移除')
        } catch (e) {
          toast(e instanceof Error ? e.message : '移除失败')
        }
      },
    })))
  }

  // —— 从照片池挑选加入 ——
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: openPoolPicker }, [icon('plus', 18), '从照片池添加'])

  async function openPoolPicker(): Promise<void> {
    let pool = (await adminApi.allPhotos()).photos
    const inAlbum = new Set(photos.map((p) => p.id))
    const candidates = pool.filter((p) => !inAlbum.has(p.id))

    if (!candidates.length) {
      toast('照片池里没有可添加的照片，先到「照片」页上传')
      return
    }

    const checks = candidates.map((p) => {
      const cb = h('input', { type: 'checkbox', class: 'admin-checkbox', 'aria-label': p.title || baseName(p.filename) })
      const thumb = h('img', { class: 'picker-thumb', src: imgUrl('thumb256', p.sha256), alt: '', loading: 'lazy' })
      return h('label', { class: 'admin-check-row picker-row' }, [cb, thumb, h('span', { class: 'picker-name' }, p.title || baseName(p.filename) || '未命名')])
    })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, `从照片池添加 · ${album?.title ?? ''}`),
      h('div', { class: 'admin-check-group' }, checks),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '加入相册'),
      ]),
    ]))

    async function save(): Promise<void> {
      const selected = candidates.filter((_, i) => (checks[i].querySelector('input') as HTMLInputElement).checked).map((p) => p.id)
      if (!selected.length) { err.textContent = '请至少勾选一张照片'; return }
      try {
        await adminApi.attachPhotos(albumId, selected)
        close()
        const { photos: updated } = await adminApi.albumPhotos(albumId)
        photos = updated
        if (coverId == null && updated.length) coverId = updated[0].id
        render()
        toast('已加入相册')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '添加失败'
      }
    }
  }

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', { class: 'admin-section-head-left' }, [
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => navigate('/admin/albums') }, [icon('arrow-left', 16), '返回相册']),
      h('h2', { class: 'admin-section-title' }, album?.title ?? `相册 #${albumId}`),
      h('span', { class: 'admin-section-desc text-muted' }, `共 ${photos.length} 张 · 从照片池挑选组成`),
    ]),
    addBtn,
  ])

  main.replaceChildren(header, grid)
  render()
}

interface PhotoCtx {
  isCover: boolean
  onEdited: (p: AdminPhoto) => void
  onSetCover: (id: number) => void
  onDetach: (id: number) => void
}

function photoCard(p: AdminPhoto, ctx: PhotoCtx): HTMLElement {
  const title = p.title || baseName(p.filename) || '未命名'
  return h('figure', { class: 'admin-photo-card' }, [
    h('div', { class: 'admin-photo-thumb' }, [
      h('img', { src: imgUrl('thumb1024', p.sha256), alt: title, loading: 'lazy' }),
      ctx.isCover ? h('span', { class: 'admin-photo-cover-badge' }, '封面') : null,
    ]),
    h('figcaption', { class: 'admin-photo-meta' }, [
      h('span', { class: 'admin-photo-title' }, title),
      h('span', { class: 'admin-photo-sub text-muted' }, p.shot_at ? fmtDateTime(p.shot_at) : '未设时间'),
    ]),
    h('div', { class: 'admin-photo-actions' }, [
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => openPhotoEditModal(p, ctx.onEdited) }, [icon('edit', 16), '编辑']),
      ctx.isCover
        ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: true }, '已是封面')
        : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => ctx.onSetCover(p.id) }, [icon('image', 16), '设为封面']),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onClick: () => void ctx.onDetach(p.id) }, [icon('x', 16), '移除']),
    ]),
  ])
}
