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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close()
  }
  const handle: ModalHandle = {
    close: () => {
      window.removeEventListener('keydown', onKey)
      overlay.remove()
    },
    el: box,
  }
  window.addEventListener('keydown', onKey)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) handle.close()
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
  window.setTimeout(() => t.remove(), 2200)
}
