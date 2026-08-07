import * as THREE from 'three'

// 全景查看器：equirectangular 球面渲染 + 拖拽/滚轮/陀螺仪视角控制。
// 渲染上下文在此封装（预留点 6），未来升 WebXR 只换会话创建方式。
// 默认朝向偏移：用户反馈每张照片进入后的默认视角偏右 90°，
// 正确正面应在当前默认（yaw=0）基础上向左转 90°。若方向反了改负号。
const DEFAULT_YAW = Math.PI / 2
const DEFAULT_FOV = 75

export class PanoramaViewer {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private mesh: THREE.Mesh
  private rafId = 0
  private gyroOn = false
  private dirty = true

  // 手动视角状态（陀螺仪关闭时生效）
  private yaw = DEFAULT_YAW
  private pitch = 0
  private dragging = false
  private lastX = 0
  private lastY = 0

  // 重置朝向补间（可被拖动/二次重置中断）
  private resetting = false
  private resetRaf = 0

  // 触控捏合：双指距离变化 → 缩放 FOV
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDist = 0

  // 纹理 LRU：会话内最多缓存 6 张，相册内切换基本不重解码（开发文档 §7.3）
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
    this.applyManualView() // 构造时就把默认朝向（左移 90°）应用到相机，避免点进去仍是 0°

    this.bindPointer()
    this.bindKeyboard()

    this.resizeObserver = new ResizeObserver(() => this.updateSize())
    this.resizeObserver.observe(container)

    this.loop()
  }

  // —— 纹理加载 ——
  // 是否已缓存该纹理：切换前据此决定是否显示加载提示（避免已缓存的快速切换闪提示）。
  isLoaded(sha: string): boolean {
    return this.textureCache.has(`/img/raw/${sha}`)
  }

  load(sha: string): Promise<void> {
    const url = `/img/raw/${sha}`
    const cached = this.textureCache.get(url)
    if (cached) {
      this.applyTexture(cached)
      return Promise.resolve()
    }
    // LRU：超过 6 张淘汰最久未用
    if (this.textureCache.size >= 6) {
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
    const oldMat = this.mesh.material as THREE.MeshBasicMaterial
    this.mesh.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff })
    this.dirty = true

    // 跨纹理切换用叠加球淡出旧纹理：旧纹理透明度降低时下方已是新图，
    // 不会露出黑色画布背景（帧抖/黑缝的根因）。
    if (oldMat.map && oldMat !== this.mesh.material) {
      const overlay = new THREE.Mesh(
        this.mesh.geometry,
        new THREE.MeshBasicMaterial({ map: oldMat.map, transparent: true, opacity: 1 }),
      )
      this.scene.add(overlay)
      // 关键：先同步渲染一帧把新纹理上传到 GPU，再开始淡出计时。否则首次上传
      // 阻塞主线程（全景约 113MB），start 采集过早，阻塞后首帧 t 已超 1，
      // 过渡瞬间完成——即"第一次切图没动画，缓存后才有"。
      this.renderer.render(this.scene, this.camera)
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 450)
        ;(overlay.material as THREE.MeshBasicMaterial).opacity = 1 - t
        this.dirty = true // 关键：每帧标记脏，主循环才会重绘淡出过程
        if (t < 1) requestAnimationFrame(step)
        else this.scene.remove(overlay)
      }
      step()
    } else {
      // 兜底：立即渲染一帧，确保新纹理不依赖下一次滚动/拖拽才上屏
      this.renderer.render(this.scene, this.camera)
    }
  }

  // —— 视角控制 ——
  resetView(): void {
    if (this.gyroOn) this.setGyro(false) // 先切回触摸（会同步当前朝向到 yaw/pitch）
    this.animateViewTo(DEFAULT_YAW, 0)
  }

  // 视角补间：从当前 yaw/pitch/fov 缓动到目标（重置朝向用），任意拖动立即中断。
  private animateViewTo(targetYaw: number, targetPitch: number): void {
    if (this.resetting) {
      cancelAnimationFrame(this.resetRaf)
      this.resetting = false
    }
    const fromYaw = this.yaw
    const fromPitch = this.pitch
    const fromFov = this.camera.fov
    // yaw 可越界环绕：取最短转向角，避免拉回时绕大圈
    let dYaw = targetYaw - fromYaw
    dYaw = ((dYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    const start = performance.now()
    const dur = 450
    this.resetting = true
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur)
      const e = 1 - Math.pow(1 - t, 3) // ease-out cubic
      this.yaw = fromYaw + dYaw * e
      this.pitch = fromPitch + (targetPitch - fromPitch) * e
      this.camera.fov = fromFov + (DEFAULT_FOV - fromFov) * e
      this.camera.updateProjectionMatrix()
      this.applyManualView()
      this.dirty = true // 关键：补间每帧标记脏，主循环才持续重绘
      if (t < 1 && this.resetting) this.resetRaf = requestAnimationFrame(step)
      else this.resetting = false
    }
    step()
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
    if (this.resetting) {
      cancelAnimationFrame(this.resetRaf)
      this.resetting = false
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 2) {
      // 进入双指捏合：暂停单指拖拽
      this.dragging = false
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      return
    }
    if (this.gyroOn) return
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.canvas.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchDist > 0) this.setFov(this.camera.fov - (d - this.pinchDist) * 0.16)
      this.pinchDist = d
      return
    }
    if (!this.dragging || this.gyroOn) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    // 灵敏度 0.003：比之前 0.005 低，拖/滑同样距离照片转动更慢、更好控制
    this.yaw += dx * 0.003
    this.pitch += dy * 0.003
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
    this.applyManualView()
    this.dirty = true
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDist = 0
    if (this.pointers.size === 0) this.dragging = false
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
