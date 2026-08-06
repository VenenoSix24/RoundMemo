import { adminApi, type AdminAlbum } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, openModal, toast } from '../../components/modal'

// 相册：一组全景的容器（本身中立，谁能看由分组绑定决定）。
export async function renderAdminAlbums(main: HTMLElement): Promise<void> {
  let albums = (await adminApi.albums()).albums

  const list = h('div', { class: 'album-admin-list' })
  const render = () => {
    list.replaceChildren(...albums.map((a) => albumCard(a, {
      onChanged: (u) => { albums = albums.map((x) => (x.id === u.id ? u : x)); render() },
      onDeleted: (id) => { albums = albums.filter((x) => x.id !== id); render() },
    })))
  }

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [
      h('h2', { class: 'admin-section-title' }, '相册'),
      h('p', { class: 'admin-section-desc text-muted' }, '相册是照片的容器，建好后可绑定到分组供访客查看。'),
    ]),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: openNew }, [icon('plus', 18), '新建相册']),
  ])

  main.replaceChildren(header, list)
  render()

  function openNew(): void {
    const title = h('input', { class: 'admin-input', placeholder: '相册标题', 'aria-label': '相册标题' })
    const desc = h('input', { class: 'admin-input', placeholder: '描述（可选）', 'aria-label': '描述' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '新建相册'),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '标题'), title]),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '描述'), desc]),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, '创建'),
      ]),
    ]))

    async function submit(): Promise<void> {
      const v = title.value.trim()
      if (!v) { err.textContent = '标题不能为空'; return }
      try {
        const created = await adminApi.createAlbum(v, desc.value.trim() || null)
        albums = [created, ...albums]
        close()
        render()
        toast('相册已创建')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '创建失败'
      }
    }
  }
}

interface AlbumCtx {
  onChanged: (a: AdminAlbum) => void
  onDeleted: (id: number) => void
}

function albumCard(a: AdminAlbum, ctx: AlbumCtx): HTMLElement {
  return h('section', { class: 'album-admin-card' }, [
    h('div', { class: 'album-admin-cover', 'aria-hidden': 'true' }, a.cover_sha ? h('img', { src: `/img/thumb256/${a.cover_sha}`, alt: '' }) : icon('image', 24)),
    h('div', { class: 'album-admin-body' }, [
      h('h3', { class: 'album-admin-title' }, a.title),
      h('p', { class: 'album-admin-desc text-muted' }, a.description || '—'),
      h('div', { class: 'album-admin-actions' }, [
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: openEdit }, [icon('edit', 16), '编辑']),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onClick: del }, [icon('trash', 16), '删除']),
      ]),
    ]),
  ])

  function openEdit(): void {
    const title = h('input', { class: 'admin-input', value: a.title, 'aria-label': '相册标题' })
    const desc = h('input', { class: 'admin-input', value: a.description ?? '', 'aria-label': '描述' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '编辑相册'),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '标题'), title]),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '描述'), desc]),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
      ]),
    ]))

    async function save(): Promise<void> {
      const v = title.value.trim()
      if (!v) { err.textContent = '标题不能为空'; return }
      try {
        const updated = await adminApi.updateAlbum(a.id, { title: v, description: desc.value.trim() || null })
        ctx.onChanged(updated)
        close()
        toast('已保存')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '保存失败'
      }
    }
  }

  function del(): void {
    void confirmDialog('删除相册', `确认删除相册「${a.title}」？相册内所有照片与缩略图一并删除，不可恢复。`, true).then(async (ok) => {
      if (!ok) return
      await adminApi.deleteAlbum(a.id)
      ctx.onDeleted(a.id)
      toast('相册已删除')
    })
  }
}
