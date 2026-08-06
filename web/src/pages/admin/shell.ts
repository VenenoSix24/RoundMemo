import { adminApi } from '../../api/admin'
import { h, renderPage } from '../../components/dom'
import { icon } from '../../components/icons'
import { navigate } from '../../router'

// Owner 后台壳：顶栏（品牌 + 居中 tab + 身份/退出）；桌面 tab 在顶栏，手机 tab 沉底 dock。
// 进入任意 admin 页先验身份，401 转登录页。导航顺序：照片/相册/授权/分组/设置。

export type AdminTab = 'photos' | 'albums' | 'grants' | 'groups' | 'settings'

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'photos', label: '照片', icon: 'camera' },
  { id: 'albums', label: '相册', icon: 'image' },
  { id: 'grants', label: '授权', icon: 'key' },
  { id: 'groups', label: '分组', icon: 'users' },
  { id: 'settings', label: '设置', icon: 'settings' },
]

export async function renderAdminShell(active: AdminTab, build: (main: HTMLElement) => Promise<void>): Promise<void> {
  let me
  try {
    me = await adminApi.whoami()
  } catch {
    navigate('/admin/login')
    return
  }

  const tabBtn = (t: { id: AdminTab; label: string; icon: string }) =>
    h('button', {
      class: 'admin-nav-item' + (t.id === active ? ' is-active' : ''),
      type: 'button',
      onClick: () => navigate(`/admin/${t.id}`),
    }, [icon(t.icon, 18), h('span', {}, t.label)])

  // 桌面顶栏居中 tab + 移动端底部 dock 各渲染一份，CSS 按断点显隐
  const topNav = h('nav', { class: 'admin-nav', 'aria-label': '后台导航' }, TABS.map(tabBtn))
  const dock = h('nav', { class: 'admin-dock', 'aria-label': '后台导航' }, TABS.map(tabBtn))

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
    h('header', { class: 'glass admin-topbar' }, [
      h('div', { class: 'admin-topbar-left' }, [
        h('span', { class: 'font-accent admin-brand' }, '圆忆'),
        h('span', { class: 'admin-topbar-sep' }, '·'),
        h('span', { class: 'admin-topbar-title' }, '管理后台'),
      ]),
      topNav,
      h('div', { class: 'admin-topbar-right' }, [
        h('span', { class: 'admin-owner' }, [
          h('span', { class: 'admin-owner-avatar' }, me.username[0]?.toUpperCase() ?? 'O'),
          h('span', { class: 'admin-owner-name' }, me.username),
        ]),
        logoutBtn,
      ]),
    ]),
    main,
    dock,
  ])

  renderPage(page)
  try {
    await build(main)
  } finally {
    // tab 切换动画：内容就绪后淡入上移（强制回流保证过渡生效）
    void main.offsetWidth
    main.classList.add('is-in')
  }
}
