import { adminApi, type AdminBackup } from '../../api/admin'
import type { MapTileConfig } from '../../api/client'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, openModal, toast } from '../../components/modal'
import { renderImportSection } from './import'
import { renderSessionsSection } from './sessions'
import { fmtDateTime } from './photoEditModal'

// 设置 tab：账号 / 站点（标题·图标）/ 地图瓦片源 / 导入 / 会话 / 备份恢复（占位）。
export async function renderAdminSettings(main: HTMLElement): Promise<void> {
  const me = await adminApi.whoami()
  const settings = await adminApi.settings()

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [h('h2', { class: 'admin-section-title' }, '设置')]),
  ])

  main.replaceChildren(
    header,
    h('div', { class: 'settings-stack' }, [
      accountSection(me.username),
      siteSection(settings.site_title, settings.has_favicon),
      mapTileSection(settings.map_tile),
      sectionCard('导入照片', renderImportSection),
      sectionCard('在线会话', renderSessionsSection),
      backupSection(),
    ]),
  )
}

function sectionCard(title: string, render: (container: HTMLElement) => Promise<void>): HTMLElement {
  const body = h('div', { class: 'settings-block-group' })
  const card = h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, title),
    body,
  ])
  void render(body)
  return card
}

function accountSection(currentUsername: string): HTMLElement {
  const cur = h('input', { type: 'password', class: 'admin-input', autocomplete: 'current-password', placeholder: '当前密码', 'aria-label': '当前密码' })
  const name = h('input', { class: 'admin-input', value: currentUsername, placeholder: '新用户名（留空不变）', 'aria-label': '新用户名' })
  const pw = h('input', { type: 'password', class: 'admin-input', autocomplete: 'new-password', placeholder: '新密码（至少 8 位，留空不变）', 'aria-label': '新密码' })
  const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存')

  async function save(): Promise<void> {
    const uname = name.value.trim()
    const pass = pw.value
    if (!cur.value) { err.textContent = '请输入当前密码'; return }
    if (uname === currentUsername && !pass) { err.textContent = '没有要修改的内容'; return }
    try {
      const body: { current_password: string; username?: string; password?: string } = { current_password: cur.value }
      if (uname && uname !== currentUsername) body.username = uname
      if (pass) body.password = pass
      await adminApi.account(body)
      err.textContent = ''
      toast('账号已更新')
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : '保存失败'
    }
  }

  return h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, '账号'),
    h('p', { class: 'admin-section-desc text-muted' }, `当前管理员：${currentUsername}`),
    h('div', { class: 'settings-grid' }, [
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '当前密码'), cur]),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '新用户名'), name]),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '新密码'), pw]),
    ]),
    err,
    saveBtn,
  ])
}

function siteSection(siteTitle: string, hasFavicon: boolean): HTMLElement {
  const title = h('input', { class: 'admin-input', value: siteTitle, placeholder: '如「圆忆 · 我的相册」', 'aria-label': '站点标题' })
  const titleErr = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const favInput = h('input', { type: 'file', class: 'import-file', accept: 'image/*', 'aria-hidden': 'true' })
  const favStatus = h('span', { class: 'settings-fav-status text-muted' }, hasFavicon ? '已设置图标' : '未设置图标')

  const saveTitle = h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
    const v = title.value.trim()
    if (!v) { titleErr.textContent = '站点标题不能为空'; return }
    try {
      await adminApi.putSettings(v)
      titleErr.textContent = ''
      toast('站点标题已更新，刷新后生效')
    } catch (e) {
      titleErr.textContent = e instanceof Error ? e.message : '保存失败'
    }
  } }, '保存标题')

  favInput.addEventListener('change', () => {
    const f = favInput.files?.[0]
    if (!f) return
    void adminApi.uploadFavicon(f)
      .then(() => {
        favStatus.textContent = '已设置图标'
        favStatus.className = 'settings-fav-status text-muted'
        toast('图标已更新，刷新后生效')
      })
      .catch((e) => {
        favStatus.textContent = e instanceof Error ? e.message : '上传失败'
        favStatus.className = 'settings-fav-status'
      })
  })

  return h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, '站点'),
    h('p', { class: 'admin-section-desc text-muted' }, '设置浏览器标签页上显示的标题与图标。'),
    h('div', { class: 'settings-block' }, [
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '网页标题'), title]),
      titleErr,
      saveTitle,
    ]),
    h('div', { class: 'settings-block' }, [
      h('h4', { class: 'settings-block-title' }, '网页图标'),
      h('div', { class: 'settings-fav-row' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => favInput.click() }, [icon('image', 16), '上传图标']),
        favInput,
        favStatus,
      ]),
    ]),
  ])
}

// 地图瓦片源预设：切换只填 URL 与子域（地图来源）；「照片 GPS 坐标系」独立于地图来源。
const MAP_PRESETS: Record<string, { url: string; subdomains: string }> = {
  amap8: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: '1,2,3,4',
  },
  amap7: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
    subdomains: '1,2,3,4',
  },
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: '' },
}

function mapTileSection(current: MapTileConfig): HTMLElement {
  const preset = h('select', { class: 'admin-input', 'aria-label': '瓦片源预设' }, [
    h('option', { value: 'amap8' }, '高德 · 简洁路网图（默认）'),
    h('option', { value: 'amap7' }, '高德 · 标准街道图'),
    h('option', { value: 'osm' }, 'OpenStreetMap'),
    h('option', { value: 'custom' }, '自定义'),
  ])
  const url = h('input', { class: 'admin-input', value: current.url, spellcheck: 'false', 'aria-label': '瓦片地址模板' })
  const subs = h('input', { class: 'admin-input', value: current.subdomains, placeholder: '逗号分隔，留空则无子域', 'aria-label': '瓦片子域' })
  const crs = h('select', { class: 'admin-input', 'aria-label': '照片坐标系' }, [
    h('option', { value: 'wgs84' }, 'WGS-84（EXIF 标准，默认）'),
    h('option', { value: 'gcj02' }, 'GCJ-02（少数国内手机照片）'),
  ])
  crs.value = current.crs
  const matched = Object.entries(MAP_PRESETS).find(([, p]) => p.url === current.url)?.[0]
  preset.value = matched ?? 'custom'

  preset.addEventListener('change', () => {
    const p = MAP_PRESETS[preset.value]
    if (!p) return
    url.value = p.url
    subs.value = p.subdomains
    // crs 是照片坐标系，不随地图来源变化
  })

  const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    onClick: async () => {
      const u = url.value.trim()
      if (!u) { err.textContent = '瓦片地址不能为空'; return }
      try {
        await adminApi.putMapTile({ url: u, subdomains: subs.value.trim(), crs: crs.value as MapTileConfig['crs'] })
        err.textContent = ''
        toast('地图瓦片源已更新，刷新后生效')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '保存失败'
      }
    },
  }, '保存地图源')

  return h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, '地图瓦片源'),
    h('p', { class: 'admin-section-desc text-muted' }, '地图页底图。照片 GPS 坐标系：EXIF 标准是 WGS-84，叠高德（GCJ-02 瓦片）时会自动换算；仅极少数国内手机照片的 GPS 才是 GCJ-02。' ),
    h('div', { class: 'settings-block' }, [
      h('div', { class: 'settings-fav-row' }, [preset, crs]),
    ]),
    h('div', { class: 'settings-block' }, [
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '瓦片地址模板'), url]),
      h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '子域（逗号分隔）'), subs]),
    ]),
    err,
    saveBtn,
  ])
}

function backupSection(): HTMLElement {
  const body = h('div', { class: 'settings-block-group' })
  void renderBackupSection(body)
  return h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, '备份与恢复'),
    h('p', { class: 'admin-section-desc text-muted' }, '把站点数据导出为档案包，可迁移到另一台服务器。'),
    body,
  ])
}

// 备份区块：创建（仅数据 / 数据+原图）、列表、下载、删除、恢复。
async function renderBackupSection(body: HTMLElement): Promise<void> {
  const listEl = h('div', { class: 'backup-list' })
  const errEl = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const reload = async () => {
    try {
      const r = await adminApi.backups()
      renderBackupList(listEl, r.backups, reload)
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : '加载备份失败'
    }
  }
  void reload()

  const dbBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    onClick: async () => {
      dbBtn.disabled = true
      errEl.textContent = ''
      try {
        await adminApi.createBackup('db')
        toast('已创建数据备份')
        void reload()
      } catch (e) {
        errEl.textContent = e instanceof Error ? e.message : '创建失败'
      } finally {
        dbBtn.disabled = false
      }
    },
  }, [icon('download', 16), '仅数据'])

  const fullBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    onClick: async () => {
      const ok = await confirmDialog(
        '创建完整备份？',
        '完整备份包含数据库 + 全部照片原图，文件较大。照片原图通常您自己也有，一般只需备份数据。确定继续？',
      )
      if (!ok) return
      fullBtn.disabled = true
      errEl.textContent = ''
      try {
        await adminApi.createBackup('full')
        toast('已创建完整备份')
        void reload()
      } catch (e) {
        errEl.textContent = e instanceof Error ? e.message : '创建失败'
      } finally {
        fullBtn.disabled = false
      }
    },
  }, [icon('download', 16), '数据+原图'])

  const fileInput = h('input', {
    type: 'file', class: 'import-file', accept: '.rmbackup,application/octet-stream', 'aria-hidden': 'true',
  })
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (!f) return
    fileInput.value = ''
    void startRestore(f, reload)
  })
  const restoreBtn = h('button', {
    class: 'btn btn-danger',
    type: 'button',
    onClick: () => fileInput.click(),
  }, [icon('upload', 16), '恢复备份'])

  body.replaceChildren(
    h('div', { class: 'settings-block' }, [
      h('h4', { class: 'settings-block-title' }, '创建备份'),
      h('div', { class: 'settings-fav-row' }, [dbBtn, fullBtn]),
      errEl,
    ]),
    h('div', { class: 'settings-block' }, [
      h('h4', { class: 'settings-block-title' }, '已有备份'),
      listEl,
    ]),
    h('div', { class: 'settings-block' }, [
      h('h4', { class: 'settings-block-title' }, '恢复备份'),
      h('p', { class: 'admin-form-hint text-muted' }, '恢复会用档案包覆盖当前数据，操作不可撤销。'),
      h('div', { class: 'settings-fav-row' }, [restoreBtn, fileInput]),
    ]),
  )
}

function renderBackupList(el: HTMLElement, backups: AdminBackup[], reload: () => Promise<void>): void {
  if (!backups.length) {
    el.replaceChildren(h('p', { class: 'group-empty text-muted' }, '还没有备份'))
    return
  }
  const rows = backups.map((b) => {
    const kind = b.kind === 'full' ? h('span', { class: 'grant-status is-active' }, '完整') : h('span', { class: 'grant-status' }, '数据')
    const dl = h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': '下载备份',
      title: '下载备份',
      onClick: async () => {
        try {
          const blob = await adminApi.downloadBackup(b.name)
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = b.name
          a.click()
          URL.revokeObjectURL(url)
        } catch (e) {
          toast(e instanceof Error ? e.message : '下载失败')
        }
      },
    }, icon('download', 16))
    const del = h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': '删除备份',
      title: '删除备份',
      onClick: async () => {
        const ok = await confirmDialog('删除备份？', `确定删除 ${b.name}？此操作不可恢复。`, true)
        if (!ok) return
        try {
          await adminApi.deleteBackup(b.name)
          toast('备份已删除')
          void reload()
        } catch (e) {
          toast(e instanceof Error ? e.message : '删除失败')
        }
      },
    }, icon('trash', 16))

    return h('div', { class: 'backup-row' }, [
      h('div', { class: 'backup-main' }, [
        h('div', { class: 'backup-name' }, [kind, h('span', { class: 'backup-file' }, b.name)]),
        h('div', { class: 'backup-meta' }, [
          h('span', {}, fmtDateTime(b.created_at)),
          h('span', {}, fmtSize(b.size)),
          h('span', {}, `${b.photos} 张照片 · ${b.albums} 相册 · ${b.groups} 分组 · ${b.grants} 授权`),
        ]),
      ]),
      h('div', { class: 'backup-actions' }, [dl, del]),
    ])
  })
  el.replaceChildren(...rows)
}

// startRestore 恢复流程：选文件 → 强确认（输入 RESET）→ 调接口。
async function startRestore(file: File, reload: () => Promise<void>): Promise<void> {
  const input = h('input', { class: 'admin-input', placeholder: '输入 RESET 确认恢复', 'aria-label': '输入 RESET 确认恢复' })
  const msg = h('p', { class: 'modal-message' }, `将用 ${file.name} 覆盖当前全部数据。输入 RESET 确认。`)
  const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  let closeModal: () => void = () => {}
  const { close } = openModal(h('div', { class: 'modal-body' }, [
    h('h3', { class: 'modal-title' }, '恢复备份'),
    msg,
    input,
    err,
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => closeModal() }, '取消'),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onClick: async () => {
          if (input.value.trim() !== 'RESET') {
            err.textContent = '确认词不正确'
            return
          }
          try {
            const r = await adminApi.restoreBackup(file, 'RESET')
            closeModal()
            toast(`恢复完成（${r.kind === 'full' ? '完整' : '数据'}）`)
            void reload()
          } catch (e) {
            err.textContent = e instanceof Error ? e.message : '恢复失败'
          }
        },
      }, '确认恢复'),
    ]),
  ]))
  closeModal = close
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
