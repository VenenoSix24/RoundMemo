import * as THREE from 'three'

// 全景查看器：equirectangular 球面渲染 + 拖拽/滚轮/陀螺仪视角控制。
// 渲染上下文在此封装（预留点 6），未来升 WebXR 只换会话创建方式。
export class PanoramaViewer {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private mesh: THREE.Mesh
  private rafId = 0
  private gyroOn = false
  private dirty = true

  // 手动视角状态（陀螺仪关闭时生效）
  private yaw = 0
  private pitch = 0
  private dragging = false
  private lastX = 0
  private lastY = 0

  // 纹理 LRU：会话内最多缓存 3 张，来回切换不重解码（开发文档 §7.3）
  private textureCache = new Map<string, THREE.Texture>()

  private resizeObserver: ResizeObserver

  constructor(private container: HTMLElement, private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 1100)
    this.camera.rotation.order = 'YXZ'

    const geo = new THREE.SphereGeometry(500, 64, 64)
    geo.scale(-1, 1, 1) // 翻转使法线朝内，equirect 纹理不镜像
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x11141c }))
    this.scene.add(this.mesh)

    this.updateSize() // camera 已创建，可正确设置宽高比

    this.bindPointer()
    this.bindKeyboard()

    this.resizeObserver = new ResizeObserver(() => this.updateSize())
    this.resizeObserver.observe(container)

    this.loop()
  }

  // —— 纹理加载 ——
  load(sha: string): Promise<void> {
    const url = `/img/raw/${sha}`
    const cached = this.textureCache.get(url)
    if (cached) {
      this.applyTexture(cached)
      return Promise.resolve()
    }
    // LRU：超过 3 张淘汰最久未用
    if (this.textureCache.size >= 3) {
      const oldest = this.textureCache.keys().next().value
      if (oldest) {
        this.textureCache.get(oldest)?.dispose()
        this.textureCache.delete(oldest)
      }
    }
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          this.textureCache.set(url, tex)
          this.applyTexture(tex)
          resolve()
        },
        undefined,
        (err) => reject(err),
      )
    })
  }

  private applyTexture(tex: THREE.Texture): void {
    const mat = this.mesh.material as THREE.MeshBasicMaterial
    if (this.textureCache.size > 1 && mat.map) {
      // 切换时旧纹理淡出再换，避免帧抖（开发文档 §7.3）
      const old = mat.map
      const fade = new THREE.MeshBasicMaterial({ map: old, transparent: true, opacity: 1 })
      this.mesh.material = fade
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 300)
        fade.opacity = 1 - t
        if (t < 1) requestAnimationFrame(step)
        else {
          this.mesh.material = mat
          mat.map = tex
          this.prepareMappedMaterial(mat)
          this.dirty = true
        }
      }
      step()
    } else {
      mat.map = tex
      this.prepareMappedMaterial(mat)
      this.dirty = true
    }
  }

  // 初始材质用深色占位，加载完必须回白：MeshBasicMaterial 最终色 = 纹理 × 材质色，
  // 不重置会把全景压成近黑。
  private prepareMappedMaterial(mat: THREE.MeshBasicMaterial): void {
    mat.color.setRGB(1, 1, 1)
    mat.needsUpdate = true
  }

  // —— 视角控制 ——
  resetView(): void {
    this.yaw = 0
    this.pitch = 0
    if (this.gyroOn) this.setGyro(false)
    this.dirty = true
  }

  setFov(fov: number): void {
    this.camera.fov = THREE.MathUtils.clamp(fov, 30, 100)
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // 陀螺仪开关；iOS 13+ 需用户手势授权，失败静默回退触摸。
  async toggleGyro(): Promise<boolean> {
    if (this.gyroOn) {
      this.setGyro(false)
      return false
    }
    const ok = await this.requestGyroPermission()
    if (ok) {
      this.setGyro(true)
      return true
    }
    return false
  }

  private requestGyroPermission(): Promise<boolean> {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    if (typeof D.requestPermission === 'function') {
      return D.requestPermission()
        .then((state: string) => state === 'granted')
        .catch(() => false)
    }
    // 非 iOS：直接可用（或浏览器不支持时返回 false）
    return Promise.resolve('DeviceOrientationEvent' in window)
  }

  private setGyro(on: boolean): void {
    this.gyroOn = on
    if (!on) {
      // 从陀螺仪切回触摸时，把当前朝向同步进 yaw/pitch
      this.yaw = this.camera.rotation.y
      this.pitch = this.camera.rotation.x
      window.removeEventListener('deviceorientation', this.gyroHandler)
      this.dirty = true
    } else {
      window.addEventListener('deviceorientation', this.gyroHandler)
      this.dirty = true
    }
  }

  private gyroHandler = (e: DeviceOrientationEvent): void => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    const rad = Math.PI / 180
    // 标准全景映射：alpha=水平朝向，beta=俯仰，gamma=倾斜
    this.camera.rotation.y = e.alpha * rad
    this.camera.rotation.x = e.beta * rad
    this.camera.rotation.z = -e.gamma * rad
    this.dirty = true
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.gyroOn) return
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.canvas.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || this.gyroOn) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.yaw -= dx * 0.005
    this.pitch -= dy * 0.005
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
    this.applyManualView()
    this.dirty = true
  }

  private onPointerUp = (): void => {
    this.dragging = false
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.setFov(this.camera.fov + (e.deltaY > 0 ? 6 : -6))
  }

  private onDblClick = (): void => {
    this.resetView()
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.resetView()
  }

  private applyManualView(): void {
    if (this.gyroOn) return
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch
    this.camera.rotation.z = 0
  }

  private bindPointer(): void {
    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('dblclick', this.onDblClick)
    window.addEventListener('keydown', this.onKey)
  }

  private bindKeyboard(): void {
    // 方向键也控制视角（桌面补充）
    // 已在 onKey 中处理 Escape；←→ 留给页面做照片切换
  }

  private updateSize(): void {
    const w = this.container.clientWidth
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop)
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera)
      this.dirty = false
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    window.removeEventListener('deviceorientation', this.gyroHandler)
    window.removeEventListener('keydown', this.onKey)
    this.textureCache.forEach((t) => t.dispose())
    this.renderer.dispose()
  }
}
