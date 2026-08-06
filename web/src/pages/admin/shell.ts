import { adminApi } from '../../api/admin'
import { h, renderPage } from '../../components/dom'
import { icon } from '../../components/icons'
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
        ownerBadge({ avatar: me.username[0]?.toUpperCase() ?? 'O', name: me.username }),
        logoutBtn,
      ]),
    ]),
    h('div', { class: 'admin-body' }, [nav, main]),
  ])

  renderPage(page)
  await build(main)
}

// 顶栏 Owner 头像 + 用户名
export function ownerBadge(o: { avatar: string; name: string }): HTMLElement {
  return h('span', { class: 'admin-owner' }, [
    h('span', { class: 'admin-owner-avatar' }, o.avatar),
    h('span', { class: 'admin-owner-name' }, o.name),
  ])
}
