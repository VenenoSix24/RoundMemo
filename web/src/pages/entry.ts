import { api } from '../api/client'
import { state, rememberGroup, restoreGroup } from '../state'
import { h, renderPage } from '../components/dom'
import { openModal } from '../components/modal'
import { navigate, setTeardown } from '../router'

// 口令入口页（电影感版本）：光场三叠层 + 滚动叙事三章 + 玻璃口令卡。
// 隐私优先：滚动章节全是插画（山脊/圆环/落日），不渲染任何真实照片；口令逻辑与旧版一致（错对统一、防枚举）。

const RIDGE_SVG = `
<svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="pr1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7bd76"/><stop offset="1" stop-color="#d5a153"/></linearGradient>
    <linearGradient id="pr2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ca9448"/><stop offset="1" stop-color="#b28136"/></linearGradient>
    <pattern id="ridge" width="1000" height="300" patternUnits="userSpaceOnUse">
      <path d="M0 150 Q 80 96 170 142 T 340 118 T 510 148 T 680 122 T 850 150 T 1000 128 L1000 300 L0 300 Z" fill="url(#pr1)" opacity=".55"/>
      <path d="M0 202 Q 120 142 250 192 T 500 174 T 750 198 T 1000 180 L1000 300 L0 300 Z" fill="url(#pr1)" opacity=".78"/>
      <path d="M0 246 Q 160 180 320 234 T 640 222 T 900 240 T 1000 232 L1000 300 L0 300 Z" fill="url(#pr2)" opacity=".9"/>
      <path d="M0 286 Q 220 238 440 278 T 880 272 T 1000 280 L1000 300 L0 300 Z" fill="#7a5c28" opacity=".5"/>
    </pattern>
  </defs>
  <rect width="1000" height="300" fill="url(#ridge)"/>
</svg>
`

const EMBLEM_SVG = `
<svg viewBox="0 0 56 56" aria-hidden="true">
  <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(216,171,78,.7)" stroke-width="1.5"/>
  <circle cx="28" cy="28" r="2.6" fill="#d8ab4e"/>
  <line x1="28" y1="3" x2="28" y2="10" stroke="rgba(216,171,78,.5)" stroke-width="1.5"/>
</svg>
`

const GLOBE_SVG = `
<svg viewBox="0 0 220 220" aria-hidden="true">
  <circle cx="110" cy="110" r="96" fill="none" stroke="rgba(120,90,30,.14)" stroke-width="1"/>
  <circle cx="110" cy="110" r="96" fill="none" class="gold" stroke-width="2" stroke-dasharray="4 4" stroke-dashoffset="8"/>
  <g stroke="rgba(120,90,30,.32)" stroke-width="1"><line x1="110" y1="10" x2="110" y2="18"/><line x1="110" y1="202" x2="110" y2="210"/><line x1="10" y1="110" x2="18" y2="110"/><line x1="202" y1="110" x2="210" y2="110"/></g>
  <circle data-el="sweep" cx="110" cy="110" r="96" fill="none" class="gold-2" stroke-width="7" stroke-linecap="round" stroke-dasharray="603" stroke-dashoffset="603" transform="rotate(-90 110 110)"/>
  <circle data-el="marker" cx="110" cy="14" r="5" class="gold"/>
</svg>
`

// 渐变 id 冲突：入口页是一次性渲染，无并发页，可安全复用同一套 id。
export async function renderEntry(): Promise<void> {
  let info
  try {
    info = await api.session()
    restoreGroup(info.groups)
  } catch {
    info = { groups: [] }
  }

  const root = h('div', { class: 'entry' })

  // —— 光场三叠层 + 噪点 + 进度条 ——
  const field = h('div', { class: 'field', 'aria-hidden': 'true' }, [
    h('div', { class: 'layer morning' }),
    h('div', { class: 'layer noon', 'data-el': 'noon' }),
    h('div', { class: 'layer dusk', 'data-el': 'dusk' }),
  ])
  root.append(
    field,
    h('div', { class: 'grain', 'aria-hidden': 'true' }),
    h('div', { class: 'progress', 'aria-hidden': 'true', 'data-el': 'progress' }),
  )

  // —— HERO ——
  const emblem = h('div', { class: 'emblem', 'aria-hidden': 'true' })
  emblem.innerHTML = EMBLEM_SVG
  const brand = h('h1', { class: 'brand' }, [h('span', {}, '圆'), h('span', {}, '忆')])
  const brandEn = h('p', { class: 'brand-en' }, 'ROUNDMEMO')
  const meaning = h('p', { class: 'meaning' }, [
    h('i', {}, '圆'),
    '，是走完一圈的圆满　　',
    h('i', {}, '忆'),
    '，是转过身的那次回望',
  ])
  const tagline = h('p', { class: 'tagline' }, '全景纪念')
  const card = h('section', { class: 'card', role: 'dialog', 'aria-label': '圆忆入口' })

  if (state.groups.length > 0) renderWelcome(card)
  else renderCodeForm(card, null)

  const hero = h('header', { class: 'hero', 'data-el': 'hero' }, [
    emblem,
    brand,
    brandEn,
    meaning,
    tagline,
    card,
    h(
      'a',
      { href: '/admin', class: 'entry-admin' },
      '芝麻开门',
    ),
    h('div', { class: 'scrollcue', 'aria-hidden': 'true' }, ['向下，环顾这段记忆', h('span', { class: 'dot' })]),
  ])
  root.append(hero)

  // —— 第一章 · 满屏全景 ——
  const scene = h('div', { class: 'scene', 'data-el': 'c1Scene' })
  scene.innerHTML = RIDGE_SVG + '<div class="sun"></div>'
  const c1 = h('section', { class: 'chapter c1' }, [
    scene,
    h('div', { class: 'text' }, [
      h('p', {}, ['有些地方，绕一圈，', h('br'), '才算真的来过']),
      h('small', {}, [
        'SOME PLACES DESERVE A FULL ',
        h('span', { class: 'num' }, '360'),
        ' LOOK AROUND',
      ]),
    ]),
  ])
  root.append(c1)

  // —— 第二章 · 不对称扫掠 ——
  const globe = h('div', { class: 'globe' }, [
    (() => {
      const s = h('div', {}, '')
      s.innerHTML = GLOBE_SVG
      return s.firstElementChild as HTMLElement
    })(),
    h('div', { class: 'deg' }, '360°'),
  ])
  const c2 = h('section', { class: 'chapter c2' }, [
    globe,
    h('div', { class: 'text' }, [
      h('p', { class: 'kicker' }, 'ONE MOMENT, A WHOLE WORLD'),
      h('p', {}, ['有些时刻，会在你', h('br'), '转身之后，重新转成一圈']),
      h('small', {}, 'MEMORY RETURNS IN FULL CIRCLES'),
    ]),
  ])
  root.append(c2)

  // —— 第三章 · 飞向黄昏 ——
  const sun3 = h('div', { class: 'sun', 'data-el': 'sun3' })
  const hline3 = h('div', { class: 'hline', 'data-el': 'hline3' })
  const zoom = h('div', { class: 'zoom', 'data-el': 'zoom' }, [
    h('div', { class: 'sunstage' }, [hline3, sun3]),
    h('div', { class: 'text' }, [
      h('p', {}, ['把它留在原地。', h('br'), '想它的时候，回来看看']),
      h('small', {}, 'KEEP IT HERE — COME BACK WHEN YOU REMEMBER'),
    ]),
  ])
  const c3 = h('section', { class: 'chapter c3' }, [zoom])
  root.append(c3)

  // —— 结尾 ——
  const climax = h('footer', { class: 'climax' }, [
    h('div', { class: 'climax-brand' }, [
      h('h1', { class: 'brand' }, [h('span', {}, '圆'), h('span', {}, '忆')]),
      h('p', { class: 'brand-en' }, 'ROUNDMEMO'),
    ]),
    h('p', {}, ['把自己放回那个时刻。', h('br'), '拖动，环顾，让四面的风，都记得你。']),
    h('button', { class: 'btn climax-cta', type: 'button', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }, '回到入口'),
    h('p', { class: 'foot' }, 'ROUNDMEMO · 全景纪念相册'),
  ])
  root.append(climax)

  renderPage(root)

  const disposeScroll = wireScroll(root)
  const disposeParallax = window.matchMedia('(pointer:fine)').matches && !reducedMotion()
    ? wireParallax(root)
    : null

  // 深链接直达时复位滚动（避免浏览器记住上一次的滚动位置）
  window.scrollTo(0, 0)
  setTeardown(() => {
    disposeScroll?.()
    disposeParallax?.()
    window.scrollTo(0, 0)
  })
}

// —— 口令卡：口令态（错对统一防枚举）。onBack 非空时（从"切换分组→输入新口令"进入）
// 显示返回按钮，可回到欢迎卡；无会话时不留返回入口。——
function renderCodeForm(card: HTMLElement, onBack: (() => void) | null): void {
  card.replaceChildren() // 从欢迎态切回口令态时清掉旧内容
  const boxes = Array.from({ length: 8 }, () => h('input', {
    type: 'text',
    inputmode: 'numeric',
    maxlength: '1',
    autocomplete: 'off',
    'aria-label': '口令第 N 位',
    class: 'box',
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
    h('div', { class: 'boxes', role: 'group', 'aria-label': '8 位口令' }, boxes),
    h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onClick: () => {
          const code = boxes.map((b) => b.value).join('')
          if (code.length === 8) void submit(code)
        },
      },
      '进入这个时刻',
    ),
    h('p', { class: 'hint' }, '没有口令？向分享人索取'),
    ...(onBack ? [h('button', { class: 'btn btn-ghost entry-back', type: 'button', onClick: onBack }, '← 返回')] : []),
  )
  // 延迟聚焦，避免移动端键盘直接弹出盖住卡片
  window.setTimeout(() => boxes[0].focus(), 300)
}

// —— 口令卡：已登录态 ——
function renderWelcome(card: HTMLElement): void {
  card.replaceChildren() // 从口令态返回时清掉旧内容
  const g = state.groups[0]
  card.append(
    h('p', { class: 'welcome' }, `欢迎回来，继续上次的 ${g.name}？`),
    h('button', { class: 'btn', type: 'button', onClick: () => navigate('/albums') }, '继续访问 →'),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: openChooser }, '切换分组'),
  )

  // 切换分组：弹层列出已有分组可直接切，或输入新口令（加到当前会话）
  function openChooser(): void {
    const groupItems = state.groups.map((gr) => h(
      'button',
      {
        class: 'chooser-item' + (gr.id === state.activeGroupId ? ' is-current' : ''),
        type: 'button',
        onClick: () => {
          rememberGroup(gr.id)
          close()
          navigate('/albums')
        },
      },
      [h('span', { class: 'chooser-name' }, gr.name), gr.id === state.activeGroupId ? h('span', { class: 'chooser-tag' }, '当前') : null],
    ))
    const newCode = h(
      'button',
      {
        class: 'chooser-item chooser-new',
        type: 'button',
        onClick: () => {
          close()
          renderCodeForm(card, () => renderWelcome(card)) // 切回口令卡，输新口令并入当前会话
        },
      },
      '输入新口令',
    )
    const { close } = openModal(h('div', { class: 'modal-body entry-chooser' }, [
      h('h3', { class: 'modal-title' }, '切换分组'),
      ...groupItems,
      h('div', { class: 'chooser-divider', role: 'separator' }),
      newCode,
    ]))
  }
}

// —— 滚动叙事（1:1 直映，无 lerp → 不回弹）——
function clamp(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function wireScroll(root: HTMLElement): (() => void) | null {
  const $ = (el: string): HTMLElement | null => root.querySelector(el)
  const hero = $('[data-el="hero"]')
  const progress = $('[data-el="progress"]')
  const scene = $('[data-el="c1Scene"]')
  const c1 = root.querySelector('.c1') as HTMLElement
  const c2 = root.querySelector('.c2') as HTMLElement
  const c3 = root.querySelector('.c3') as HTMLElement
  const sweep = $('[data-el="sweep"]')
  const marker = $('[data-el="marker"]')
  const zoom = $('[data-el="zoom"]')
  const sun3 = $('[data-el="sun3"]')
  const hline3 = $('[data-el="hline3"]')
  const noon = $('[data-el="noon"]')
  const dusk = $('[data-el="dusk"]')
  if (!hero || !progress || !scene || !c1 || !c2 || !c3 || !sweep || !marker || !zoom || !sun3 || !hline3 || !noon || !dusk) return null

  if (reducedMotion()) return null // 静态版式，滚动驱动动画整体停用

  let rafId = 0

  // 键盘弹出检测：视口可用高度被键盘压缩即判定。不能用 innerHeight 作分母——
  // Android 键盘弹出时 innerHeight 与 visualViewport.height 同步缩小（比值不变），
  // 唯有相对「无键盘时的初始高度」的缩水才可靠；iOS 则只有 visualViewport 缩小。
  const vv = window.visualViewport
  const baseViewportH = vv ? vv.height : window.innerHeight
  let kbOpen = false
  const detectKb = () => {
    const h = vv ? vv.height : window.innerHeight
    kbOpen = h < baseViewportH * 0.85
    // 键盘弹出期间 hero 强制可见：即使浏览器为露出输入框自动滚动（scrollY 变大），
    // 也不让口令卡随滚动公式淡出。键盘收起后恢复常态。
    if (kbOpen) {
      hero.style.transform = 'none'
      hero.style.opacity = '1'
    }
  }
  detectKb()
  window.addEventListener('resize', detectKb)
  vv?.addEventListener('resize', detectKb)
  vv?.addEventListener('scroll', detectKb)

  const onScroll = () => {
    const y = scrollY
    const total = document.documentElement.scrollHeight - innerHeight
    const p = total > 0 ? y / total : 0
    progress.style.transform = `scaleX(${p})`

    // hero 上浮淡出（1:1）：键盘弹出期间冻结，避免输口令时卡片淡出
    if (!kbOpen) {
      const hp = Math.min(1, y / (innerHeight * 0.85))
      hero.style.transform = `translateY(${y * 0.28}px)`
      hero.style.opacity = String(Math.max(0, 1 - hp))
    }

    // 第一章 · 全景平移：从进视口到出视口全程持续，不停顿
    const c1p = clamp((y - c1.offsetTop + innerHeight) / (innerHeight * 2))
    scene.style.transform = `translateX(${-c1p * 40}vw)`

    // 第二章 · 扫掠
    const c2p = clamp((y - c2.offsetTop + innerHeight * 0.4) / (innerHeight * 0.85))
    sweep.setAttribute('stroke-dashoffset', String(603 - 603 * c2p))
    const ang = ((c2p * 360 - 90) * Math.PI) / 180
    marker.setAttribute('cx', String(110 + 96 * Math.cos(ang)))
    marker.setAttribute('cy', String(110 + 96 * Math.sin(ang)))

    // 第三章 · 缩放飞入 + 黄昏
    const c3p = clamp((y - c3.offsetTop + innerHeight * 0.45) / (innerHeight * 1.0))
    zoom.style.transform = `scale(${0.74 + c3p * 0.26}) translateY(${(1 - c3p) * 40}px)`
    sun3.style.transform = `translateY(${c3p * 150}px)`
    sun3.style.opacity = String(1 - c3p * 0.45)
    hline3.style.transform = `translateY(${c3p * 78}px)`
    noon.style.opacity = String(clamp((c3p - 0.15) / 0.45))
    dusk.style.opacity = String(clamp((c3p - 0.55) / 0.45))
  }

  const onScrollRaf = () => {
    if (!rafId) rafId = requestAnimationFrame(() => {
      rafId = 0
      onScroll()
    })
  }
  window.addEventListener('scroll', onScrollRaf, { passive: true })
  onScroll()
  return () => {
    window.removeEventListener('scroll', onScrollRaf)
    window.removeEventListener('resize', detectKb)
    vv?.removeEventListener('resize', detectKb)
    vv?.removeEventListener('scroll', detectKb)
    if (rafId) cancelAnimationFrame(rafId)
  }
}

// 桌面鼠标视差 + 磁性按钮（仅精细指针设备）
function wireParallax(root: HTMLElement): () => void {
  const sun = root.querySelector('.scene .sun') as HTMLElement | null
  const onMouseMove = (e: MouseEvent) => {
    const x = e.clientX / innerWidth - 0.5
    const y = e.clientY / innerHeight - 0.5
    if (sun) {
      sun.style.marginLeft = `${x * 16}px`
      sun.style.marginTop = `${y * 12}px`
    }
  }
  window.addEventListener('mousemove', onMouseMove, { passive: true })

  const magnets: Array<[HTMLElement, (e: MouseEvent) => void, () => void]> = []
  root.querySelectorAll('.btn').forEach((btn) => {
    const el = btn as HTMLElement
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      el.style.transform = `translate(${((e.clientX - r.left - r.width / 2) / r.width) * 10}px, ${((e.clientY - r.top - r.height / 2) / r.height) * 6}px)`
    }
    const leave = () => {
      el.style.transform = ''
    }
    el.addEventListener('mousemove', move)
    el.addEventListener('mouseleave', leave)
    magnets.push([el, move, leave])
  })
  return () => {
    window.removeEventListener('mousemove', onMouseMove)
    magnets.forEach(([el, move, leave]) => {
      el.removeEventListener('mousemove', move)
      el.removeEventListener('mouseleave', leave)
    })
  }
}
