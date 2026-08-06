import { adminApi, type AdminAlbum, type AdminGroup } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, openModal, toast } from '../../components/modal'

// 分组：相册的隔离容器。一个相册可属多组；组内成员登录可见绑定相册。
export async function renderAdminGroups(main: HTMLElement): Promise<void> {
  const [groupsRes, albumsRes] = await Promise.all([adminApi.groups(), adminApi.albums()])
  let groups = groupsRes.groups
  const albums = albumsRes.albums
  const albumName = (id: number): string => albums.find((a) => a.id === id)?.title ?? `相册 #${id}`

  const list = h('div', { class: 'group-list' })
  const render = () => {
    list.replaceChildren(...groups.map((g) => groupCard(g, albums, albumName, {
      onChanged: (u) => { groups = groups.map((x) => (x.id === u.id ? u : x)); render() },
      onDeleted: (id) => { groups = groups.filter((x) => x.id !== id); render() },
    })))
  }

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [
      h('h2', { class: 'admin-section-title' }, '分组'),
      h('p', { class: 'admin-section-desc text-muted' }, '分组决定"谁能看哪些相册"。绑定后，通过该分组授权（口令或分享链接）的访客即可见。'),
    ]),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: openNew }, [icon('plus', 18), '新建分组']),
  ])

  main.replaceChildren(header, list)
  render()

  function openNew(): void {
    const name = h('input', { class: 'admin-input', placeholder: '分组名称', 'aria-label': '分组名称' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '新建分组'),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '名称'), name]),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, '创建'),
      ]),
    ]))

    async function submit(): Promise<void> {
      const v = name.value.trim()
      if (!v) { err.textContent = '名称不能为空'; return }
      try {
        const created = await adminApi.createGroup(v)
        groups = [created, ...groups]
        close()
        render()
        toast('分组已创建')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '创建失败'
      }
    }
  }
}

interface GroupCtx {
  onChanged: (g: AdminGroup) => void
  onDeleted: (id: number) => void
}

function groupCard(g: AdminGroup, albums: AdminAlbum[], albumName: (id: number) => string, ctx: GroupCtx): HTMLElement {
  return h('section', { class: 'group-card' }, [
    h('div', { class: 'group-head' }, [
      h('h3', { class: 'group-name' }, g.name),
      h('span', { class: 'group-count text-muted' }, `绑定 ${g.album_ids.length} 个相册`),
    ]),
    h('div', { class: 'group-albums' }, g.album_ids.length
      ? g.album_ids.map((aid) => h('span', { class: 'group-album-chip' }, [albumName(aid), h('button', {
          class: 'icon-btn group-chip-x',
          type: 'button',
          'aria-label': '解除绑定',
          title: '解除绑定',
          onClick: () => void adminApi.unbindAlbum(g.id, aid).then(() => {
            ctx.onChanged({ ...g, album_ids: g.album_ids.filter((x) => x !== aid) })
            toast('已解除绑定')
          }),
        }, icon('x', 14))]))
      : h('span', { class: 'group-empty text-muted' }, '未绑定相册')),
    h('div', { class: 'group-actions' }, [
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: openBind }, [icon('plus', 16), '绑定相册']),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: openRename }, [icon('edit', 16), '重命名']),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onClick: del }, [icon('trash', 16), '删除']),
    ]),
  ])

  function openBind(): void {
    const checks = albums.map((a) => {
      const cb = h('input', {
        type: 'checkbox',
        class: 'admin-checkbox',
        'aria-label': a.title,
        checked: g.album_ids.includes(a.id) ? 'checked' : undefined,
      })
      return h('label', { class: 'admin-check-row' }, [cb, h('span', {}, a.title)])
    })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, `绑定相册到「${g.name}」`),
      h('div', { class: 'admin-check-group' }, checks.length ? checks : h('p', { class: 'text-muted' }, '还没有相册，先去相册页创建')),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
      ]),
    ]))

    async function save(): Promise<void> {
      const selected = albums
        .filter((_, i) => (checks[i].querySelector('input') as HTMLInputElement).checked)
        .map((a) => a.id)
      if (!selected.length) { err.textContent = '请至少勾选一个相册'; return }
      try {
        await adminApi.bindAlbums(g.id, selected)
        ctx.onChanged({ ...g, album_ids: selected })
        close()
        toast('绑定已更新')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '保存失败'
      }
    }
  }

  function openRename(): void {
    const name = h('input', { class: 'admin-input', value: g.name, 'aria-label': '分组名称' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '重命名分组'),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '名称'), name]),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
      ]),
    ]))

    async function save(): Promise<void> {
      const v = name.value.trim()
      if (!v) { err.textContent = '名称不能为空'; return }
      try {
        const updated = await adminApi.updateGroup(g.id, v)
        ctx.onChanged(updated)
        close()
        toast('已保存')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '保存失败'
      }
    }
  }

  function del(): void {
    void confirmDialog('删除分组', `确认删除分组「${g.name}」？组内授权与绑定关系一并删除，但相册本身保留。`, true).then(async (ok) => {
      if (!ok) return
      await adminApi.deleteGroup(g.id)
      ctx.onDeleted(g.id)
      toast('分组已删除')
    })
  }
}
