import { adminApi, type AdminSession } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, toast } from '../../components/modal'

// 会话：某授权下仍在线的设备列表，可逐个下线（单设备吊销）。
export async function renderAdminSessions(main: HTMLElement): Promise<void> {
  const grants = (await adminApi.grants()).grants
  const preselected = new URLSearchParams(location.search).get('grant')
  const groupName = (gid: number): string => `#${gid}`

  if (!grants.length) {
    main.replaceChildren(h('div', { class: 'admin-empty' }, [
      h('p', { class: 'font-accent admin-empty-title' }, '还没有授权'),
      h('p', { class: 'text-muted' }, '先去「授权」页创建一个，再查看设备会话'),
    ]))
    return
  }

  const sel = h('select', { class: 'admin-input', 'aria-label': '选择授权' }, grants.map((g) =>
    h('option', { value: String(g.id), selected: String(g.id) === preselected ? 'selected' : undefined }, `${g.label || '未命名'} · ${groupName(g.group_id)} · ${g.numeric_code}`),
  ))

  const list = h('div', { class: 'session-list' })
  const empty = h('div', { class: 'admin-empty' }, [
    h('p', { class: 'font-accent admin-empty-title' }, '这个授权下没有在线会话'),
    h('p', { class: 'text-muted' }, '有朋友通过该授权登录后，会出现在这里'),
  ])

  async function load(grantId: number): Promise<void> {
    list.replaceChildren(h('p', { class: 'text-muted' }, '加载中…'))
    try {
      const { sessions } = await adminApi.grantSessions(grantId)
      if (!sessions.length) {
        list.replaceChildren(empty)
        return
      }
      list.replaceChildren(...sessions.map((s) => sessionRow(s, () => void revoke(grantId, s))))
    } catch (e) {
      list.replaceChildren(h('p', { class: 'admin-form-err' }, e instanceof Error ? e.message : '加载失败'))
    }
  }

  async function revoke(grantId: number, s: AdminSession): Promise<void> {
    const ok = await confirmDialog('下线设备', '确认将该设备登出？该设备上的会话立即失效，需重新输入口令。', true)
    if (!ok) return
    try {
      await adminApi.deleteSession(s.sid)
      await load(grantId)
      toast('设备已下线')
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作失败')
    }
  }

  sel.addEventListener('change', () => void load(Number(sel.value)))

  const head = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [
      h('h2', { class: 'admin-section-title' }, '在线会话'),
      h('p', { class: 'admin-section-desc text-muted' }, '按授权查看设备，可单独下线某个设备。'),
    ]),
    sel,
  ])

  main.replaceChildren(head, list)
  await load(Number(sel.value))
}

function sessionRow(s: AdminSession, onRevoke: () => void): HTMLElement {
  const ua = s.user_agent || '未知设备'
  const short = ua.length > 48 ? ua.slice(0, 48) + '…' : ua
  return h('div', { class: 'session-row' }, [
    h('div', { class: 'session-main' }, [
      h('span', { class: 'session-ua' }, short),
      h('div', { class: 'session-meta text-muted' }, [
        h('span', {}, `登录 ${fmtTime(s.issued_at)}`),
        h('span', {}, `最近活跃 ${fmtTime(s.last_seen_at)}`),
        h('span', {}, `到期 ${fmtTime(s.expires_at)}`),
      ]),
    ]),
    h('button', { class: 'btn btn-sm btn-danger', type: 'button', onClick: onRevoke }, [icon('logout', 16), '下线']),
  ])
}

function fmtTime(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
