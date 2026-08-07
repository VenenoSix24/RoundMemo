import type { Group } from './api/client'

// 解锁后可访问的分组与当前选中的分组。
// 分组切换器用 activeGroupId 驱动相册列表刷新；选择持久化到 localStorage。
export const state = {
  groups: [] as Group[],
  activeGroupId: 0,
}

const KEY = 'roundmemo.activeGroup'

export function rememberGroup(id: number): void {
  state.activeGroupId = id
  try {
    localStorage.setItem(KEY, String(id))
  } catch {
    /* 隐私模式等场景静默降级 */
  }
}

export function restoreGroup(groups: Group[]): void {
  let saved = 0
  try {
    saved = Number(localStorage.getItem(KEY)) || 0
  } catch {
    /* ignore */
  }
  const hit = groups.find((g) => g.id === saved)
  state.groups = groups
  state.activeGroupId = hit ? hit.id : groups[0]?.id ?? 0
}
