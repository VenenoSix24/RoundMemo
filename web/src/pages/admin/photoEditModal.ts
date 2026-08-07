import { adminApi, type AdminPhoto } from '../../api/admin'
import { h } from '../../components/dom'
import { openModal, toast } from '../../components/modal'

// 照片信息编辑模态（标题/描述/拍摄时间/经纬度），相册子页与全局照片页共用。
export function openPhotoEditModal(p: AdminPhoto, onSaved: (p: AdminPhoto) => void): void {
  const title = h('input', { class: 'admin-input', value: p.title ?? '', placeholder: '标题（留空显示文件名）', 'aria-label': '标题' })
  const desc = h('input', { class: 'admin-input', value: p.description ?? '', placeholder: '描述（可选）', 'aria-label': '描述' })
  const location = h('input', { class: 'admin-input', value: p.location_name ?? '', placeholder: '地点（如「济南市历下区」）', 'aria-label': '地点' })
  const shotAt = h('input', { type: 'datetime-local', class: 'admin-input', value: p.shot_at != null ? toLocalInput(p.shot_at) : '', 'aria-label': '拍摄时间' })
  const gpsLat = h('input', { type: 'number', step: 'any', class: 'admin-input', value: p.gps_lat != null ? String(p.gps_lat) : '', placeholder: '纬度，如 37.5202', 'aria-label': '纬度' })
  const gpsLng = h('input', { type: 'number', step: 'any', class: 'admin-input', value: p.gps_lng != null ? String(p.gps_lng) : '', placeholder: '经度，如 121.3517', 'aria-label': '经度' })
  const gpsHint = h('p', { class: 'admin-form-hint text-muted' }, '经纬度需同时填写或同时留空（后续可自动反查地名）；自定义地点优先展示')
  const err = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  const { close } = openModal(h('div', { class: 'modal-body' }, [
    h('h3', { class: 'modal-title' }, '编辑照片信息'),
    h('p', { class: 'modal-sub text-muted' }, `原始文件：${p.filename || '未知'}`),
    h('p', { class: 'modal-sub text-muted' }, '该信息为照片池共用，保存后所有相册同步生效。'),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '标题'), title]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '描述'), desc]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '地点'), location]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '拍摄时间'), shotAt]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '纬度'), gpsLat]),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '经度'), gpsLng]),
    gpsHint,
    err,
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, '取消'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, '保存'),
    ]),
  ]))

  async function save(): Promise<void> {
    const lat = gpsLat.value.trim()
    const lng = gpsLng.value.trim()
    if (!!lat !== !!lng) { err.textContent = '经纬度需同时填写或同时留空'; return }
    try {
      const patch: Record<string, unknown> = {
        title: title.value.trim() || '',
        description: desc.value.trim() || '',
        location_name: location.value.trim() || '',
        shot_at: shotAt.value ? Math.floor(new Date(shotAt.value).getTime() / 1000) : null,
      }
      if (lat && lng) {
        patch.gps_lat = Number(lat)
        patch.gps_lng = Number(lng)
      } else {
        patch.gps_lat = null
        patch.gps_lng = null
      }
      const updated = await adminApi.updatePhoto(p.id, patch)
      close()
      onSaved(updated)
      toast('已保存')
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : '保存失败'
    }
  }
}

export function baseName(filename: string): string {
  return filename.replace(/\.(PHOTOSPHERE\.)?(jpe?g|png|webp|heic)$/i, '').replace(/_/g, ' ')
}

export function fmtDateTime(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
