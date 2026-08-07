import { api, imgUrl, type Album } from '../api/client'
import { state, restoreGroup } from '../state'
import { h, renderPage } from '../components/dom'
import { groupBrand, homeExitButtons, visitorDock } from '../components/visitorNav'
import { wireReveal } from '../components/reveal'
import { viewToggle } from '../components/viewToggle'
import { navigate, setTeardown } from '../router'

// 相册列表：顶栏（左：圆忆·分组品牌切换 / 中：视图 tab / 右：首页+彻底退出）
// + 移动端底部 dock + 暖纸卡片（滚动淡入）。
export async function renderAlbums(): Promise<void> {
  if (state.activeGroupId === 0) {
    // 浏览器刷新后内存 state 是空的，但会话 cookie 还在：先尝试用会话恢复分组，
    // 成功（用户已解锁）则继续渲染，失败（未解锁/会话过期）才回入口页。
    try {
      const info = await api.session()
      restoreGroup(info.groups)
    } catch {
      navigate('/')
      return
    }
    if (state.activeGroupId === 0) {
      navigate('/')
      return
    }
  }
  let albums: Album[] = []
  try {
    albums = (await api.albums(state.activeGroupId)).albums
  } catch {
    navigate('/')
    return
  }

  const page = h('div', { class: 'page' }, [
    topBar(),
    h('main', { class: 'album-list' }, albums.length ? albums.map((a, i) => albumCard(a, i)) : [emptyState()]),
  ])
  // dock 与 .page 平级：脱离 page 入场动画的 transform 包含块，position:fixed 才相对视口
  renderPage([page, visitorDock('albums')])
  setTeardown(wireReveal(page))
}

function topBar(): HTMLElement {
  return h('header', { class: 'glass topbar' }, [
    h('div', { class: 'topbar-left' }, [groupBrand()]),
    h('div', { class: 'topbar-center' }, [viewToggle('albums')]),
    h('div', { class: 'topbar-right' }, [...homeExitButtons()]),
  ])
}

function albumCard(a: Album, i: number): HTMLElement {
  const cover = a.cover_sha
    ? h('img', { class: 'album-cover', src: imgUrl('thumb1024', a.cover_sha), alt: a.title, loading: 'lazy' })
    : h('div', { class: 'album-cover album-cover-empty', 'aria-hidden': 'true' })
  return h(
    'article',
    {
      class: 'album-card',
      role: 'link',
      tabindex: '0',
      dataset: { reveal: '' },
      style: i < 8 ? `--rd:${i * 40}ms` : undefined, // 首屏 stagger，8 张后交给滚动自然点亮
      onClick: () => navigate(`/a/${a.id}`),
      onKeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter') navigate(`/a/${a.id}`)
      },
    },
    [cover, h('div', { class: 'album-card-body' }, [
      h('h2', { class: 'album-card-title font-accent' }, a.title),
      a.description ? h('p', { class: 'album-card-desc text-secondary' }, a.description) : null,
    ])],
  )
}

function emptyState(): HTMLElement {
  return h('div', { class: 'empty-state' }, [
    h('p', { class: 'font-accent empty-title' }, '这里还没有全景'),
    h('p', { class: 'text-secondary' }, '向分享人索取口令，或稍后再来'),
  ])
}
