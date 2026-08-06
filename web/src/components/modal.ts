import { h } from './dom'

// 轻量模态：全屏遮罩 + 居中卡片，ESC/点遮罩关闭。供 admin 表单与二次确认复用。

export interface ModalHandle {
  close: () => void
  el: HTMLElement
}

export function openModal(content: HTMLElement): ModalHandle {
  const overlay = h('div', { class: 'modal-overlay' })
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '对话框' }, content)
  overlay.append(box)
  document.body.append(overlay)
  // 进场：先渲染隐藏初始态，再切类触发淡入/上移（强制回流保证过渡生效，不依赖 rAF）
  void overlay.offsetWidth
  overlay.classList.add('is-open')

  const close = () => {
    window.removeEventListener('keydown', onKey)
    overlay.classList.remove('is-open')
    window.setTimeout(() => overlay.remove(), 240) // 等出场动画结束再摘除
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const handle: ModalHandle = {
    close,
    el: box,
  }
  window.addEventListener('keydown', onKey)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  return handle
}

export function confirmDialog(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const { close } = openModal(
      h('div', { class: 'modal-body' }, [
        h('h3', { class: 'modal-title' }, title),
        h('p', { class: 'modal-message' }, message),
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { close(); resolve(false) } }, '取消'),
          h('button', {
            class: danger ? 'btn btn-danger' : 'btn btn-primary',
            type: 'button',
            onClick: () => { close(); resolve(true) },
          }, danger ? '确认删除' : '确定'),
        ]),
      ]),
    )
  })
}

export function toast(msg: string): void {
  const t = h('div', { class: 'admin-toast', role: 'status' }, msg)
  document.body.append(t)
  void t.offsetWidth
  t.classList.add('is-in')
  window.setTimeout(() => {
    t.classList.remove('is-in')
    t.classList.add('is-out')
    window.setTimeout(() => t.remove(), 260)
  }, 2000)
}

// 复制到剪贴板：优先异步 Clipboard API；失败（非安全上下文/权限被拒）时
// 退化为 execCommand('copy') 临时 textarea（LAN http 下可用）。
export function copyText(text: string): Promise<void> {
  const legacy = (): Promise<void> =>
    new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.append(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (ok) resolve()
        else reject(new Error('复制失败'))
      } catch {
        reject(new Error('复制失败'))
      }
    })
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacy())
  }
  return legacy()
}
