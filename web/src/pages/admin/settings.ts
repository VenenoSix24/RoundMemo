import { adminApi } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { toast } from '../../components/modal'
import { renderImportSection } from './import'
import { renderSessionsSection } from './sessions'

// 设置 tab：账号 / 站点（标题·图标）/ 导入 / 会话 / 备份恢复（占位）。
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

function backupSection(): HTMLElement {
  return h('section', { class: 'glass admin-card' }, [
    h('h3', { class: 'admin-card-title' }, '备份与恢复'),
    h('p', { class: 'admin-section-desc text-muted' }, '后续支持将照片、相册、分组与设置导出为档案包，迁移到另一台服务器。'),
    h('div', { class: 'settings-fav-row' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, [icon('download', 16), '导出备份']),
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, [icon('upload', 16), '恢复备份']),
      h('span', { class: 'text-muted' }, '开发中（Future）'),
    ]),
  ])
}
