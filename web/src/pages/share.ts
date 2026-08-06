import { api } from '../api/client'
import { state, rememberGroup, restoreGroup } from '../state'
import { h, renderPage } from '../components/dom'
import { navigate } from '../router'

// 分享落地：自动用 token 解锁，成功进相册；失败回口令页（统一提示）。
export async function renderShare(token: string): Promise<void> {
  renderPage(
    h('div', { class: 'share-loading' }, [
      h('div', { class: 'entry-bg', 'aria-hidden': 'true' }),
      h('p', { class: 'text-secondary' }, '正在解锁…'),
    ]),
  )
  try {
    const info = await api.unlockByToken(token)
    restoreGroup(info.groups)
    if (state.activeGroupId === 0) rememberGroup(info.groups[0]?.id ?? 0)
    navigate('/albums')
  } catch {
    // 与口令错误一致：不提示"链接无效"以外的存在性细节
    renderPage(
      h('div', { class: 'share-failed' }, [
        h('div', { class: 'entry-bg', 'aria-hidden': 'true' }),
        h('p', { class: 'share-failed-title font-accent' }, '这个链接已失效'),
        h('p', { class: 'text-secondary' }, '可能已过期或已被分享人关闭'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => navigate('/') }, '回到首页'),
      ]),
    )
  }
}
