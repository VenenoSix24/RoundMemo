import { api, imgUrl, type Album } from '../api/client'
import { state, rememberGroup } from '../state'
import { h, renderPage } from '../components/dom'
import { icon } from '../components/icons'
import { navigate } from '../router'

// 相册列表：顶部玻璃栏（分组切换 + 视图切换 + 退出），主体为实色相册卡片。
export async function renderAlbums(): Promise<void> {
  if (state.activeGroupId === 0) {
    navigate('/')
    return
  }
  let albums: Album[] = []
  try {
    albums = (await api.albums(state.activeGroupId)).albums
  } catch {
    navigate('/')
    return
  }

  renderPage(
    h('div', { class: 'page' }, [
      topBar(),
      h('main', { class: 'album-list' }, albums.length ? albums.map(albumCard) : [emptyState()]),
    ]),
  )
}

function topBar(): HTMLElement {
  const sel = h('select', {
    class: 'group-switcher',
    'aria-label': '切换分组',
    onChange: (e: Event) => {
      rememberGroup(Number((e.target as HTMLSelectElement).value))
      void renderAlbums()
    },
  })
  for (const g of state.groups) {
    const opt = document.createElement('option')
    opt.value = String(g.id)
    opt.textContent = g.name
    opt.selected = g.id === state.activeGroupId
    sel.append(opt)
  }

  const viewGrid = h(
    'button',
    {
      class: 'icon-btn view-btn is-active',
      'aria-label': '网格视图',
      onClick: () => navigate('/albums'),
    },
    icon('grid'),
  )
  const viewTimeline = h(
    'button',
    {
      class: 'icon-btn view-btn',
      'aria-label': '时间线',
      onClick: () => navigate('/timeline'),
    },
    icon('list'),
  )

  const exitBtn = h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': '退出访问',
      title: '退出访问',
      onClick: async () => {
        try {
          await api.revoke()
        } catch {
          /* 无会话时忽略 */
        }
        state.groups = []
        state.activeGroupId = 0
        navigate('/')
      },
    },
    icon('logout'),
  )

  return h('header', { class: 'glass topbar' }, [
    h('div', { class: 'topbar-left' }, [sel]),
    h('div', { class: 'topbar-right' }, [viewGrid, viewTimeline, exitBtn]),
  ])
}

function albumCard(a: Album): HTMLElement {
  const cover = a.cover_sha
    ? h('img', { class: 'album-cover', src: imgUrl('thumb1024', a.cover_sha), alt: a.title, loading: 'lazy' })
    : h('div', { class: 'album-cover album-cover-empty', 'aria-hidden': 'true' })
  return h(
    'article',
    {
      class: 'album-card',
      role: 'link',
      tabindex: '0',
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
