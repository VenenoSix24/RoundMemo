import { api } from '../api/client'
import { state, rememberGroup, restoreGroup } from '../state'
import { h, renderPage } from '../components/dom'
import { navigate } from '../router'

// 口令页：无会话时展示口令输入（隐私优先：背景用氛围渐变，不泄露任何照片）；
// 有会话时展示"欢迎回来"。错对码响应一致（防枚举），仅微震。
export async function renderEntry(): Promise<void> {
  let info
  try {
    info = await api.session()
    restoreGroup(info.groups)
  } catch {
    info = { groups: [] }
  }

  const page = h('div', { class: 'entry-page' }, [
    h('div', { class: 'entry-bg', 'aria-hidden': 'true' }),
    h('div', { class: 'entry-scene' }),
  ])

  const card = h('section', { class: 'glass entry-card', role: 'dialog', 'aria-label': '圆忆入口' })
  const brand = h('div', { class: 'entry-brand' }, [
    h('h1', { class: 'font-accent entry-title' }, '圆忆'),
    h('p', { class: 'entry-sub text-muted' }, 'RoundMemo · 全景纪念'),
  ])

  if (state.groups.length > 0) {
    renderWelcome(card, brand)
  } else {
    renderCodeForm(card, brand)
  }

  page.append(card)
  renderPage(page)
}

function renderWelcome(card: HTMLElement, brand: HTMLElement): void {
  const g = state.groups[0]
  card.append(
    brand,
    h('p', { class: 'entry-welcome text-secondary' }, `欢迎回来，继续上次的 ${g.name}？`),
    h(
      'button',
      {
        class: 'btn btn-primary entry-cta',
        type: 'button',
        onClick: () => navigate('/albums'),
      },
      '继续访问 →',
    ),
    h(
      'button',
      {
        class: 'btn btn-ghost entry-cta',
        type: 'button',
        onClick: () => navigate('/albums'),
      },
      '切换分组',
    ),
    entryFooter(),
  )
}

function renderCodeForm(card: HTMLElement, brand: HTMLElement): void {
  const boxes = Array.from({ length: 8 }, () => h('input', {
    type: 'text',
    inputmode: 'numeric',
    maxlength: '1',
    autocomplete: 'off',
    'aria-label': '口令第 N 位',
    class: 'code-box',
  }))

  const shake = () => {
    card.classList.remove('shake')
    // 触发重排后重新加类，让动画可重复
    void card.offsetWidth
    card.classList.add('shake')
  }

  const submit = async (code: string) => {
    try {
      const info = await api.unlockByCode(code)
      restoreGroup(info.groups)
      if (state.activeGroupId === 0) rememberGroup(info.groups[0]?.id ?? 0)
      navigate('/albums')
    } catch {
      // 错对统一：仅微震 + 清空，不提示"码不存在"（防枚举）
      shake()
      boxes.forEach((b) => {
        b.value = ''
        b.setAttribute('aria-invalid', 'true')
      })
      boxes[0]?.focus()
    }
  }

  const setValue = (i: number, v: string) => {
    boxes[i].value = v
    if (v) {
      if (i < 7) boxes[i + 1].focus()
      else {
        const code = boxes.map((b) => b.value).join('')
        if (code.length === 8) void submit(code)
      }
    }
  }

  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement
      const v = el.value.replace(/\D/g, '').slice(0, 1)
      setValue(i, v)
    })
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus()
        boxes[i - 1].value = ''
      }
      if (e.key === 'Enter') {
        const code = boxes.map((b) => b.value).join('')
        if (code.length === 8) void submit(code)
      }
    })
    box.addEventListener('focus', () => box.select())
  })

  card.append(
    brand,
    h('div', { class: 'code-row', role: 'group', 'aria-label': '8 位口令' }, boxes),
    h(
      'button',
      {
        class: 'btn btn-primary entry-cta',
        type: 'button',
        onClick: () => {
          const code = boxes.map((b) => b.value).join('')
          if (code.length === 8) void submit(code)
        },
      },
      '进入',
    ),
    h('p', { class: 'entry-hint text-muted' }, '没有口令？向分享人索取'),
    entryFooter(),
  )
  // 延迟聚焦，避免移动端键盘直接弹出盖住卡片
  window.setTimeout(() => boxes[0].focus(), 300)
}

function entryFooter(): HTMLElement {
  return h('div', { class: 'entry-footer' }, [
    h(
      'a',
      { href: '/admin', class: 'entry-admin' },
      '授访者登录',
    ),
  ])
}
