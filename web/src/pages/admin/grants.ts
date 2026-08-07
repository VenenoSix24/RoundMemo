import { adminApi, grantShareUrl, grantStatus, type AdminGrant } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'
import { confirmDialog, copyText, openModal, toast } from '../../components/modal'
import { navigate } from '../../router'

// 授权管理：grant 行 = 标签 + 数字码/分享链接 + 状态徽 + 用量 + 行内操作（开关/有效期/用量/重生码/重生链接/单设备下线/删除）。

export async function renderAdminGrants(main: HTMLElement): Promise<void> {
  const [groupsRes, grantsRes] = await Promise.all([adminApi.groups(), adminApi.grants()])
  const groups = groupsRes.groups
  let grants = grantsRes.grants

  const groupName = (id: number): string => groups.find((g) => g.id === id)?.name ?? `分组 #${id}`

  const list = h('div', { class: 'grant-list' })
  const render = () => {
    list.replaceChildren(...grants.map((g) => grantRow(g, groupName, { onChanged: async (updated) => {
      grants = grants.map((x) => (x.id === updated.id ? updated : x))
      render()
    }, onDeleted: async (id) => {
      grants = grants.filter((x) => x.id !== id)
      render()
    } })))
  }

  const header = h('div', { class: 'admin-section-head' }, [
    h('div', {}, [
      h('h2', { class: 'admin-section-title' }, '授权管理'),
      h('p', { class: 'admin-section-desc text-muted' }, '每个授权对应一个分组：数字码给朋友当面用，分享链接可发群里。'),
    ]),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openNewGrant() }, [icon('plus', 18), '新建授权']),
  ])

  main.replaceChildren(header, list)
  render()

  function openNewGrant(): void {
    const groupSel = h('select', { class: 'admin-input', 'aria-label': '选择分组' },
      groups.map((g) => h('option', { value: String(g.id) }, g.name)),
    )
    const label = h('input', { class: 'admin-input', placeholder: '标签，如"给老王"', 'aria-label': '标签' })
    const expires = h('input', { type: 'datetime-local', class: 'admin-input', 'aria-label': '到期时间（可空）' })
    const maxUses = h('input', { type: 'number', min: '1', class: 'admin-input', placeholder: '解锁次数上限（可空）', 'aria-label': '解锁次数上限' })
    const ttl = h('input', { type: 'number', min: '1', value: '30', class: 'admin-input', 'aria-label': '会话天数' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '新建授权'),
      formField('分组', groupSel),
      formField('标签', label),
      formField('到期时间', expires),
      formField('解锁次数上限', maxUses),
      formField('会话有效期（天）', ttl),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, '创建'),
      ]),
    ]))

    async function submit(): Promise<void> {
      const e = expires.value ? Math.floor(new Date(expires.value).getTime() / 1000) : null
      const m = maxUses.value ? Number(maxUses.value) : null
      try {
        const created = await adminApi.createGrant({
          group_id: Number(groupSel.value),
          label: label.value.trim() || null,
          expires_at: e,
          max_uses: m,
          session_ttl_days: Number(ttl.value) || 30,
        })
        grants = [created, ...grants]
        close()
        render()
        toast('授权已创建')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '创建失败'
      }
    }
  }
}

interface RowCtx {
  onChanged: (g: AdminGrant) => Promise<void>
  onDeleted: (id: number) => void
}

function grantRow(g: AdminGrant, groupName: (id: number) => string, ctx: RowCtx): HTMLElement {
  const status = grantStatus(g)
  const statusLabel: Record<string, string> = {
    active: '生效中',
    disabled: '已停用',
    expired: '已到期',
    exhausted: '已用尽',
    revoked: '已撤销',
  }

  const code = h('code', { class: 'grant-code' }, g.numeric_code)
  const link = h('span', { class: 'grant-link' }, grantShareUrl(g.token))

  const enabled = h('button', {
    class: 'icon-btn' + (g.enabled ? ' is-on' : ''),
    'aria-label': g.enabled ? '停用该授权' : '启用该授权',
    title: g.enabled ? '点击停用' : '点击启用',
    onClick: () => run(() => adminApi.updateGrant(g.id, { enabled: !g.enabled }), g.enabled ? '已停用' : '已启用'),
  }, icon('power', 18))

  const row = h('section', { class: 'grant-card' }, [
    h('div', { class: 'grant-head' }, [
      h('div', { class: 'grant-title' }, [
        h('span', { class: 'grant-label' }, g.label || '未命名授权'),
        h('span', { class: 'grant-group' }, groupName(g.group_id)),
        statusBadge(status, statusLabel[status]),
      ]),
      enabled,
    ]),
    h('div', { class: 'grant-keys' }, [
      copyField('数字码', code, g.numeric_code),
      copyField('分享链接', link, grantShareUrl(g.token)),
    ]),
    h('div', { class: 'grant-meta' }, [
      h('span', {}, `已解锁 ${g.used_count}${g.max_uses != null ? ` / ${g.max_uses}` : ''} 次`),
      g.expires_at != null ? h('span', {}, `到期 ${fmtDate(g.expires_at)}`) : h('span', { class: 'text-muted' }, '不限期'),
      h('span', { class: 'text-muted' }, `会话 ${g.session_ttl_days} 天`),
    ]),
    h('div', { class: 'grant-actions' }, [
      rowAction('编辑', 'edit', () => openEdit()),
      rowAction('重生码', 'refresh', () => {
        void confirmDialog('重生数字码', `确认重新生成 ${g.numeric_code}？旧码立即作废。`, true).then((ok) => {
          if (ok) run(() => adminApi.updateGrant(g.id, { regenerate_code: true }), '新码已生成')
        })
      }),
      rowAction('重生链接', 'link', () => {
        void confirmDialog('重生分享链接', '确认重新生成链接？旧链接立即作废，已发出的朋友将无法打开。', true).then((ok) => {
          if (ok) run(() => adminApi.updateGrant(g.id, { regenerate_token: true }), '新链接已生成')
        })
      }),
      rowAction('会话', 'monitor', () => navigate(`/admin/sessions?grant=${g.id}`)),
      rowAction('删除', 'trash', () => {
        void confirmDialog('删除授权', '确认删除该授权？其下所有已登录会话会被一并吊销。', true).then(async (ok) => {
          if (!ok) return
          await adminApi.deleteGrant(g.id)
          ctx.onDeleted(g.id)
          toast('授权已删除')
        })
      }, true),
    ]),
  ])

  function run(fn: () => Promise<AdminGrant>, okMsg: string): void {
    void fn()
      .then((u) => {
        ctx.onChanged(u)
        toast(okMsg)
      })
      .catch((e) => toast(e instanceof Error ? e.message : '操作失败'))
  }

  function openEdit(): void {
    const label = h('input', { class: 'admin-input', value: g.label ?? '', placeholder: '标签', 'aria-label': '标签' })
    const expires = h('input', { type: 'datetime-local', class: 'admin-input', value: g.expires_at != null ? toLocalInput(g.expires_at) : '', 'aria-label': '到期时间（可空）' })
    const maxUses = h('input', { type: 'number', min: '1', class: 'admin-input', value: g.max_uses != null ? String(g.max_uses) : '', placeholder: '解锁次数上限（可空）', 'aria-label': '解锁次数上限' })
    const ttl = h('input', { type: 'number', min: '1', class: 'admin-input', value: String(g.session_ttl_days), 'aria-label': '会话天数' })
    const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
    const { close } = openModal(h('div', { class: 'modal-body' }, [
      h('h3', { class: 'modal-title' }, '编辑授权'),
      formField('标签', label),
      formField('到期时间', expires),
      formField('解锁次数上限', maxUses),
      formField('会话有效期（天）', ttl),
      err,
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
      ]),
    ]))

    async function save(): Promise<void> {
      try {
        const updated = await adminApi.updateGrant(g.id, {
          label: label.value.trim() || '',
          expires_at: expires.value ? Math.floor(new Date(expires.value).getTime() / 1000) : 0,
          max_uses: maxUses.value ? Number(maxUses.value) : 0,
          session_ttl_days: Number(ttl.value) || g.session_ttl_days,
        })
        close()
        await ctx.onChanged(updated)
        toast('已保存')
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : '保存失败'
      }
    }
  }

  return row
}

function statusBadge(status: string, label: string): HTMLElement {
  return h('span', { class: `grant-status is-${status}` }, label)
}

function rowAction(label: string, iconName: string, onClick: () => void, danger = false): HTMLElement {
  return h('button', { class: 'btn btn-sm' + (danger ? ' btn-danger' : ' btn-ghost'), type: 'button', onClick }, [icon(iconName, 16), label])
}

function copyField(key: string, display: HTMLElement, value: string): HTMLElement {
  return h('div', { class: 'grant-copy-field' }, [
    h('span', { class: 'grant-copy-key text-muted' }, key),
    h('div', { class: 'grant-copy-val' }, [display,
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': `复制${key}`,
        title: '复制',
        onClick: () => {
          void copyText(value).then(() => toast('已复制到剪贴板')).catch(() => toast('复制失败，请手动选择'))
        },
      }, icon('copy', 16)),
    ]),
  ])
}

function formField(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, label), input])
}

function fmtDate(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
