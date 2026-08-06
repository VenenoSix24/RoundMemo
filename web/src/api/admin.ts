// Owner 后台 REST 客户端与类型。鉴权走 rm_admin httpOnly cookie（fetch 自动随行），
// 401 由调用方统一转登录页。

export interface AdminAlbum {
  id: number
  title: string
  description: string | null
  cover_photo_id: number | null
  cover_sha: string
  sort_key: string
  created_at: number
  updated_at: number
}

export interface AdminGroup {
  id: number
  name: string
  album_ids: number[]
  created_at: number
}

export type GrantStatus = 'active' | 'disabled' | 'expired' | 'exhausted' | 'revoked'

export interface AdminGrant {
  id: number
  group_id: number
  token: string
  numeric_code: string
  label: string | null
  enabled: boolean
  active: boolean
  expires_at: number | null
  max_uses: number | null
  used_count: number
  session_ttl_days: number
  created_at: number
  revoked_at: number | null
}

export interface AdminSession {
  sid: string
  issued_at: number
  last_seen_at: number
  expires_at: number
  user_agent: string
}

export interface AdminPhoto {
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

export interface ImportResult {
  filename: string
  status: 'added' | 'duplicate' | 'error'
  photo_id?: number
  error?: string
}

async function adminReq<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// XHR 上传（fetch 无上传进度）：返回解码后的导入结果。
export function uploadPhotos(albumId: number, files: File[], onProgress: (pct: number) => void): Promise<{ results: ImportResult[] }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('file', f))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/admin/albums/${albumId}/photos`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('上传响应解析失败'))
        }
      } else {
        let msg = `上传失败 (${xhr.status})`
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.error) msg = data.error
        } catch {
          /* ignore */
        }
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误'))
    xhr.send(fd)
  })
}

export const adminApi = {
  // 会话
  whoami: () => adminReq<{ username: string; expires_at: number }>('/api/admin/session'),
  login: (username: string, password: string) =>
    adminReq<{ username: string; expires_at: number }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => adminReq<void>('/api/admin/logout', { method: 'POST', body: '{}' }),

  // 相册
  albums: () => adminReq<{ albums: AdminAlbum[] }>('/api/admin/albums'),
  createAlbum: (title: string, description: string | null) =>
    adminReq<AdminAlbum>('/api/admin/albums', { method: 'POST', body: JSON.stringify({ title, description }) }),
  updateAlbum: (id: number, patch: { title?: string; description?: string | null }) =>
    adminReq<AdminAlbum>(`/api/admin/albums/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAlbum: (id: number) => adminReq<void>(`/api/admin/albums/${id}`, { method: 'DELETE' }),
  albumPhotos: (albumId: number) => adminReq<{ photos: AdminPhoto[] }>(`/api/admin/albums/${albumId}/photos`),
  setCover: (albumId: number, photoId: number) =>
    adminReq<{ ok: boolean }>(`/api/admin/albums/${albumId}/cover`, { method: 'POST', body: JSON.stringify({ photo_id: photoId }) }),
  updatePhoto: (photoId: number, patch: Record<string, unknown>) =>
    adminReq<AdminPhoto>(`/api/admin/photos/${photoId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // 账号
  account: (body: { current_password: string; username?: string; password?: string }) =>
    adminReq<{ username: string }>('/api/admin/account', { method: 'POST', body: JSON.stringify(body) }),

  // 分组
  groups: () => adminReq<{ groups: AdminGroup[] }>('/api/admin/groups'),
  createGroup: (name: string) =>
    adminReq<AdminGroup>('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: number, name: string) =>
    adminReq<AdminGroup>(`/api/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteGroup: (id: number) => adminReq<void>(`/api/admin/groups/${id}`, { method: 'DELETE' }),
  bindAlbums: (groupId: number, albumIds: number[]) =>
    adminReq<{ bound: number }>(`/api/admin/groups/${groupId}/albums`, {
      method: 'POST',
      body: JSON.stringify({ album_ids: albumIds }),
    }),
  unbindAlbum: (groupId: number, albumId: number) =>
    adminReq<void>(`/api/admin/groups/${groupId}/albums/${albumId}`, { method: 'DELETE' }),

  // 授权
  grants: () => adminReq<{ grants: AdminGrant[] }>('/api/admin/grants'),
  createGrant: (body: { group_id: number; label?: string | null; expires_at?: number | null; max_uses?: number | null; session_ttl_days?: number }) =>
    adminReq<AdminGrant>('/api/admin/grants', { method: 'POST', body: JSON.stringify(body) }),
  updateGrant: (id: number, patch: Record<string, unknown>) =>
    adminReq<AdminGrant>(`/api/admin/grants/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteGrant: (id: number) => adminReq<void>(`/api/admin/grants/${id}`, { method: 'DELETE' }),

  // 会话（单设备下线）
  grantSessions: (grantId: number) => adminReq<{ sessions: AdminSession[] }>(`/api/admin/grants/${grantId}/sessions`),
  deleteSession: (sid: string) => adminReq<void>(`/api/admin/sessions/${sid}`, { method: 'DELETE' }),

  // 导入
  importLocal: (path: string, albumId: number) =>
    adminReq<{ results: ImportResult[] }>('/api/admin/import/local', {
      method: 'POST',
      body: JSON.stringify({ path, album_id: albumId }),
    }),
  uploadPhotos,
}

// 授权分享链接：当前域即对外地址（生产由 Caddy 反代到域名）。
export function grantShareUrl(token: string): string {
  return `${location.origin}/s/${token}`
}

export function grantStatus(g: AdminGrant): GrantStatus {
  if (g.revoked_at != null) return 'revoked'
  if (!g.enabled) return 'disabled'
  if (g.expires_at != null && g.expires_at <= Math.floor(Date.now() / 1000)) return 'expired'
  if (g.max_uses != null && g.used_count >= g.max_uses) return 'exhausted'
  return 'active'
}
