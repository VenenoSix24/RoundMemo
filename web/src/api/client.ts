// REST 客户端与类型。所有请求同源带 cookie（httpOnly 会话自动随行）。

export interface Group {
  id: number
  name: string
}

export interface Album {
  id: number
  title: string
  description: string | null
  cover_photo_id: number | null
  cover_sha: string
  sort_key: string
  created_at: number
  updated_at: number
}

export interface Photo {
  id: number
  album_id: number
  sha256: string
  width: number | null
  height: number | null
  shot_at: number | null
  gps_lat: number | null
  gps_lng: number | null
  device_make: string
  device_model: string
  title: string | null
  description: string | null
  filename: string
}

export interface SessionInfo {
  groups: Group[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data.error) msg = data.error
    } catch {
      /* 非 JSON 错误体 */
    }
    const err = new Error(msg) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export const api = {
  session: () => request<SessionInfo>('/api/session'),
  unlockByCode: (code: string) =>
    request<SessionInfo>('/api/access/code', { method: 'POST', body: JSON.stringify({ code }) }),
  unlockByToken: (token: string) =>
    request<SessionInfo>('/api/access/token', { method: 'POST', body: JSON.stringify({ token }) }),
  revoke: () => request<{ ok: boolean }>('/api/session/revoke', { method: 'POST', body: '{}' }),

  albums: (groupId: number) => request<{ albums: Album[] }>(`/api/albums?group_id=${groupId}`),
  album: (id: number) => request<{ album: Album; photos: Photo[] }>(`/api/albums/${id}`),
  photo: (id: number) => request<Photo>(`/api/photos/${id}`),
  timeline: () => request<{ photos: Photo[] }>('/api/timeline'),
}

// 鉴权图片 URL。缩略图/原图都由后端 /img 鉴权分发，cookie 随请求自动带上。
export function imgUrl(kind: 'raw' | 'thumb1024' | 'thumb256', sha: string): string {
  return `/img/${kind}/${sha}`
}
