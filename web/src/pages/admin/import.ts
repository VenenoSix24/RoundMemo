import { adminApi, uploadPhotos, type ImportResult } from '../../api/admin'
import { h } from '../../components/dom'
import { icon } from '../../components/icons'

// 导入：本地上传（带进度）+ 服务器目录批量导入。结果统一为文件名 + 状态列表。
export async function renderAdminImport(main: HTMLElement): Promise<void> {
  const albums = (await adminApi.albums()).albums
  if (!albums.length) {
    main.replaceChildren(h('div', { class: 'admin-empty' }, [
      h('p', { class: 'font-accent admin-empty-title' }, '还没有相册'),
      h('p', { class: 'text-muted' }, '先去「相册」页建一个，再回来导入照片'),
    ]))
    return
  }

  const albumSel = h('select', { class: 'admin-input', 'aria-label': '目标相册' }, albums.map((a) => h('option', { value: String(a.id) }, a.title)))
  const albumId = () => Number(albumSel.value)

  // —— 上传区 ——
  const uploadZone = h('div', { class: 'import-dropzone', tabindex: '0', role: 'button', 'aria-label': '选择照片上传' }, [
    icon('upload', 28),
    h('p', { class: 'import-drop-hint' }, '拖拽照片到这里，或点击选择'),
    h('p', { class: 'import-drop-sub text-muted' }, '支持 jpg / png / webp，可多选'),
  ])
  const fileInput = h('input', { type: 'file', class: 'import-file', multiple: true, accept: 'image/*', 'aria-hidden': 'true' })
  const uploadProgress = h('div', { class: 'import-progress', 'aria-hidden': 'true' }, [h('div', { class: 'import-progress-bar', 'data-el': 'upBar' })])
  const uploadLabel = h('span', { class: 'import-progress-text', 'data-el': 'upText' }, '')

  let uploading = false
  const pickFiles = (files: File[]) => {
    if (uploading || !files.length) return
    uploading = true
    setProgress(0, '')
    void uploadPhotos(albumId(), files, (pct) => setProgress(pct, `上传中 ${pct}%`))
      .then(({ results }) => {
        uploading = false
        setProgress(100, '')
        appendResults(results)
      })
      .catch((e) => {
        uploading = false
        setProgress(0, e instanceof Error ? e.message : '上传失败')
      })
  }
  function setProgress(pct: number, text: string): void {
    uploadLabel.textContent = text
    uploadProgress.style.display = pct > 0 && pct < 100 ? 'flex' : 'none'
    ;(uploadProgress.querySelector('[data-el="upBar"]') as HTMLElement).style.width = `${pct}%`
  }
  uploadZone.addEventListener('click', () => fileInput.click())
  uploadZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click() })
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('is-drag') })
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-drag'))
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault()
    uploadZone.classList.remove('is-drag')
    pickFiles(Array.from(e.dataTransfer?.files ?? []))
  })
  fileInput.addEventListener('change', () => { pickFiles(Array.from(fileInput.files ?? [])); fileInput.value = '' })

  // —— 服务器目录导入 ——
  const dirPath = h('input', { class: 'admin-input', placeholder: '服务器上的目录路径，如 /opt/photos/graduation', 'aria-label': '服务器目录路径' })
  const dirBtn = h('button', { class: 'btn btn-ghost', type: 'button', onClick: runLocal }, [icon('upload', 16), '开始导入'])
  const dirErr = h('p', { class: 'admin-form-err', role: 'alert' }, '')
  async function runLocal(): Promise<void> {
    const p = dirPath.value.trim()
    if (!p) { dirErr.textContent = '请输入目录路径'; return }
    dirErr.textContent = ''
    dirBtn.disabled = true
    try {
      const { results } = await adminApi.importLocal(p, albumId())
      appendResults(results)
    } catch (e) {
      dirErr.textContent = e instanceof Error ? e.message : '导入失败'
    } finally {
      dirBtn.disabled = false
    }
  }

  // —— 结果 ——
  const resultsHead = h('div', { class: 'import-results-head' }, [
    h('h3', { class: 'admin-section-title' }, '导入结果'),
    h('span', { class: 'import-results-count text-muted', 'data-el': 'resCount' }, ''),
  ])
  const resultsList = h('ul', { class: 'import-results' })
  function appendResults(results: ImportResult[]): void {
    results.forEach((r) => {
      const st = r.status === 'added' ? '已导入' : r.status === 'duplicate' ? '已存在（跳过）' : '失败'
      resultsList.append(h('li', { class: `import-result is-${r.status}` }, [
        h('span', { class: 'import-result-name' }, r.filename),
        h('span', { class: 'import-result-status' }, r.error ?? st),
      ]))
    })
    const count = resultsList.children.length
    resultsHead.querySelector('[data-el="resCount"]')!.textContent = `共 ${count} 个`
  }

  const uploadCard = h('section', { class: 'glass admin-card import-upload-card' }, [
    h('h3', { class: 'admin-card-title' }, '本地上传'),
    uploadZone,
    fileInput,
    h('div', { class: 'import-progress-wrap' }, [uploadProgress, uploadLabel]),
  ])

  const dirCard = h('section', { class: 'glass admin-card import-dir-card' }, [
    h('h3', { class: 'admin-card-title' }, '服务器目录导入'),
    h('label', { class: 'admin-form-field' }, [h('span', { class: 'admin-form-label' }, '目录路径'), dirPath]),
    dirErr,
    dirBtn,
    h('p', { class: 'import-dir-hint text-muted' }, '适合一次性放入几十张。EXIF 会自动解析，文件名带时间戳的会兜底补拍摄时间。'),
  ])

  const resultsCard = h('section', { class: 'admin-card import-results-card' }, [resultsHead, resultsList])

  main.replaceChildren(
    h('div', { class: 'admin-section-head' }, [
      h('div', {}, [
        h('h2', { class: 'admin-section-title' }, '导入照片'),
        h('p', { class: 'admin-section-desc text-muted' }, '两种方式任选，重复照片按内容自动去重。'),
      ]),
      h('label', { class: 'admin-field-inline' }, [h('span', { class: 'admin-form-label' }, '目标相册'), albumSel]),
    ]),
    h('div', { class: 'import-grid' }, [uploadCard, dirCard]),
    resultsCard,
  )
}
