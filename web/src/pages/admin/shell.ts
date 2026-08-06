import { adminApi } from '../../api/admin'
import { h, renderPage } from '../../components/dom'
import { icon } from '../../components/icons'
import { openModal, toast } from '../../components/modal'
import { navigate } from '../../router'

// Owner 后台壳：顶栏（品牌 + 身份 + 退出）+ 桌面左抽屉 / 移动底部 tab 导航。
// 进入任意 admin 页先验身份，401 转登录页。

export type AdminTab = 'albums' | 'groups' | 'grants' | 'import' | 'sessions'

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'albums', label: '相册', icon: 'image' },
  { id: 'groups', label: '分组', icon: 'users' },
  { id: 'grants', label: '授权', icon: 'key' },
  { id: 'import', label: '导入', icon: 'upload' },
  { id: 'sessions', label: '会话', icon: 'monitor' },
]

export async function renderAdminShell(active: AdminTab, build: (main: HTMLElement) => Promise<void>): Promise<void> {
  let me
  try {
    me = await adminApi.whoami()
  } catch {
    navigate('/admin/login')
    return
  }

  const nav = h('nav', { class: 'admin-nav', 'aria-label': '后台导航' }, TABS.map((t) =>
    h('button', {
      class: 'admin-nav-item' + (t.id === active ? ' is-active' : ''),
      type: 'button',
      onClick: () => navigate(`/admin/${t.id}`),
    }, [icon(t.icon, 18), h('span', {}, t.label)]),
  ))

  const main = h('main', { class: 'admin-main' })

  const logoutBtn = h('button', {
    class: 'icon-btn admin-logout',
    'aria-label': '退出登录',
    title: '退出登录',
    onClick: async () => {
      try {
        await adminApi.logout()
      } catch {
        /* 会话可能已失效，仍回登录页 */
      }
      navigate('/admin/login')
    },
  }, icon('logout', 18))

  const page = h('div', { class: 'admin-page' }, [
    h('header', { class: 'admin-topbar glass' }, [
      h('div', { class: 'admin-topbar-left' }, [
        h('span', { class: 'font-accent admin-brand' }, '圆忆'),
        h('span', { class: 'admin-topbar-sep' }, '·'),
        h('span', { class: 'admin-topbar-title' }, '管理后台'),
      ]),
      h('div', { class: 'admin-topbar-right' }, [
        h('button', { class: 'admin-owner', type: 'button', title: '修改账号', onClick: () => openAccountModal(me.username) }, [
          h('span', { class: 'admin-owner-avatar' }, me.username[0]?.toUpperCase() ?? 'O'),
          h('span', { class: 'admin-owner-name' }, me.username),
        ]),
        logoutBtn,
      ]),
    ]),
    h('div', { class: 'admin-body' }, [nav, main]),
  ])

  renderPage(page)
  await build(main)
}

// 修改账号模态：验证当前密码后可改用户名/密码。
function openAccountModal(currentUsername: string): void {
  const cur = h('input', { type: 'password', class: 'admin-input', autocomplete: 'current-password', placeholder: '当前密码', 'aria-label': '当前密码' })
  const name = h('input', { class: 'admin-input', value: currentUsername, placeholder: '新用户名（可留空不变）', 'aria-label': '新用户名' })
  const pw = h('input', { type: 'password', class: 'admin-input', autocomplete: 'new-password', placeholder: '新密码（至少 8 位，可留空不变）', 'aria-label': '新密码' })
  const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const { close } = openModal(h('div', { class: 'modal-body' }, [
    h('h3', { class: 'modal-title' }, '修改账号'),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '当前密码'), cur]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '新用户名'), name]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '新密码'), pw]),
    err,
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
    ]),
  ]))

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
      close()
      toast('账号已更新')
      navigate('/admin/grants') // 刷新顶栏显示新用户名
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : '保存失败'
    }
  }
}
