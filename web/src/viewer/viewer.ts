import * as THREE from 'three'

// 全景查看器：equirectangular 球面渲染 + 拖拽/滚轮/陀螺仪视角控制。
// 渲染上下文在此封装，未来升 WebXR 只换会话创建方式。
// 默认朝向偏移：正确正面应在当前默认（yaw=0）基础上向左转 90°。
const DEFAULT_YAW = Math.PI / 2
const DEFAULT_FOV = 75
const PLANET_FOV = 150
const PLANET_PITCH = -Math.PI / 2 + 0.01
// 自动旋转角速度：约 40 秒一圈，缓慢优雅
const ROTATE_SPEED = (Math.PI * 2) / 40
// 开场动画时长：小行星视角展开到默认视角
const INTRO_MS = 1600
// 自动旋转前的静默时长：交互后停 2.5s 再恢复
const ROTATE_IDLE_MS = 2500

// W3C 标准四元数换算用的常量：设备坐标系 → 相机坐标系
const GYRO_ZEE = new THREE.Vector3(0, 0, 1)
const GYRO_Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)) // 绕 X 轴 -π/2

export class PanoramaViewer {
  static gyroSupported(): boolean {
    // 只按接口存在性判断；无传感器的环境由开启后的超时回退兜底，
    // 避免条件过严导致真机按钮消失。
    return typeof DeviceOrientationEvent !== 'undefined'
  }

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private mesh: THREE.Mesh
  private rafId = 0
  private gyroOn = false
  private dirty = true

  // 自动旋转与小行星开场：由管理员站点设置驱动（公共 /api/settings 传入）
  private autoRotate: boolean
  private planetIntro: boolean
  private lastInteract = 0
  private lastFrame = performance.now()

  // 手动视角状态（陀螺仪关闭时生效）
  private yaw = DEFAULT_YAW
  private pitch = 0
  private dragging = false
  private lastX = 0
  private lastY = 0

  // 陀螺仪：相机朝向 = 设备四元数 × 归零偏移。设备四元数经轻量滤波去抖，
  // 偏移在开启瞬间/归零时按当前视角重算，保证无跳变。竖屏、接近直立均稳定。
  private deviceQuat = new THREE.Quaternion()
  private targetQuat = new THREE.Quaternion()
  private gyroOffset = new THREE.Quaternion()
  private defaultViewQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, DEFAULT_YAW, 0, 'YXZ'))
  private gyroEuler = new THREE.Euler()
  private gyroQ0 = new THREE.Quaternion()
  private needsBaseline = false
  private firstGyroResolve: (() => void) | null = null
  private gyroResetting = false
  private gyroResetRaf = 0

  // 重置朝向补间（可被拖动/二次重置中断）
  private resetting = false
  private resetRaf = 0

  // 触控捏合：双指距离变化 → 缩放 FOV
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDist = 0

  // 纹理 LRU：会话内最多缓存 6 张，相册内切换基本不重解码
  private textureCache = new Map<string, THREE.Texture>()

  private resizeObserver: ResizeObserver

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    opts: { autoRotate?: boolean; planetIntro?: boolean } = {},
  ) {
    this.autoRotate = opts.autoRotate ?? false
    this.planetIntro = opts.planetIntro ?? false
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
  // 是否已缓存该纹理：切换前据此决定是否显示加载提示。
  // 小行星开场第二步：从星球视角展开到默认视角。陀螺仪开启时不播。
  playIntro(): void {
    if (!this.planetIntro || this.gyroOn) return
    this.animateViewTo(DEFAULT_YAW, 0, DEFAULT_FOV, INTRO_MS)
  }

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
    const oldTex = oldMat.map
    this.dirty = true
    // 首张或重复应用：直接上纹理并复位视角
    if (!oldTex || oldTex === tex) {
      this.mesh.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff })
      this.resetForNewPhoto()
      this.renderer.render(this.scene, this.camera)
      return
    }
    // 切图过渡：旧图淡出 → 暗底上复位视角并换新图 → 新图淡入。
    const geo = this.mesh.geometry
    const oldOverlay = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: oldTex, transparent: true, opacity: 1 }))
    this.scene.add(oldOverlay)
    this.mesh.material = new THREE.MeshBasicMaterial({ color: 0x0b0e14 })
    const t0 = performance.now()
    const fadeOut = (): void => {
      const t = Math.min(1, (performance.now() - t0) / 140)
      ;(oldOverlay.material as THREE.MeshBasicMaterial).opacity = 1 - t
      this.dirty = true
      if (t < 1) {
        requestAnimationFrame(fadeOut)
        return
      }
      this.scene.remove(oldOverlay)
      this.mesh.material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, color: 0xffffff })
      this.resetForNewPhoto()
      this.renderer.render(this.scene, this.camera)
      const t1 = performance.now()
      const fadeIn = (): void => {
        const u = Math.min(1, (performance.now() - t1) / 140)
        ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = u
        this.dirty = true
        if (u < 1) {
          requestAnimationFrame(fadeIn)
          return
        }
        this.mesh.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff })
        this.dirty = true
      }
      fadeIn()
    }
    fadeOut()
  }

  // —— 视角控制 ——
  resetView(): void {
    if (this.gyroOn) {
      // 陀螺仪模式下归零：缓动回设备正前方的默认朝向，不退出陀螺仪
      this.recenterGyro()
      return
    }
    this.animateViewTo(DEFAULT_YAW, 0)
  }

  // 切换照片时重置视角：新照片从默认朝向+缩放进入。
  // 陀螺仪模式下改为重算归零偏移，从设备当前朝向进入。
  resetForNewPhoto(): void {
    if (this.gyroOn) {
      this.gyroOffset.copy(this.defaultViewQuat).multiply(this.gyroQ0.copy(this.deviceQuat).invert())
      this.camera.fov = DEFAULT_FOV
      this.camera.updateProjectionMatrix()
      this.applyGyroView()
      this.dirty = true
      return
    }
    if (this.resetting) {
      cancelAnimationFrame(this.resetRaf)
      this.resetting = false
    }
    this.yaw = DEFAULT_YAW
    this.camera.fov = DEFAULT_FOV
    this.camera.updateProjectionMatrix()
    if (this.planetIntro) {
      // 小行星开场第一步：先停在星球视角，此刻仍被加载遮罩盖住，
      // 待页面在遮罩散开时调 playIntro() 再展开，避免动画被遮罩吃掉
      this.pitch = PLANET_PITCH
      this.camera.fov = PLANET_FOV
      this.camera.updateProjectionMatrix()
      this.applyManualView()
      this.dirty = true
      return
    }
    this.pitch = 0
    this.applyManualView()
    this.dirty = true
  }

  // 视角补间：从当前 yaw/pitch/fov 缓动到目标，任意拖动立即中断。
  private animateViewTo(targetYaw: number, targetPitch: number, targetFov: number = DEFAULT_FOV, dur = 450): void {
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
    this.resetting = true
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur)
      const e = 1 - Math.pow(1 - t, 3) // ease-out cubic
      this.yaw = fromYaw + dYaw * e
      this.pitch = fromPitch + (targetPitch - fromPitch) * e
      this.camera.fov = fromFov + (targetFov - fromFov) * e
      this.camera.updateProjectionMatrix()
      this.applyManualView()
      this.dirty = true
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



  // 陀螺仪开关；iOS 13+ 需用户手势授权。开启后若收不到传感器事件
  // （桌面浏览器有构造器无传感器）自动回退触摸并报失败。
  async toggleGyro(): Promise<boolean> {
    if (this.gyroOn) {
      this.setGyro(false)
      return false
    }
    const ok = await this.requestGyroPermission()
    if (!ok) return false
    this.setGyro(true)
    const got = await this.waitForFirstGyroEvent(800)
    if (!got) {
      this.setGyro(false)
      return false
    }
    return true
  }

  private waitForFirstGyroEvent(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        this.firstGyroResolve = null
        resolve(false)
      }, timeoutMs)
      this.firstGyroResolve = () => {
        window.clearTimeout(timer)
        this.firstGyroResolve = null
        resolve(true)
      }
    })
  }

  private requestGyroPermission(): Promise<boolean> {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    if (typeof D.requestPermission === 'function') {
      return D.requestPermission()
        .then((state: string) => state === 'granted')
        .catch(() => false)
    }
    // Android 等平台无需授权，存在构造器即尝试
    return Promise.resolve(true)
  }

  private setGyro(on: boolean): void {
    this.gyroOn = on
    if (!on) {
      // 从陀螺仪切回触摸时，把当前朝向同步进 yaw/pitch
      this.yaw = this.camera.rotation.y
      this.pitch = this.camera.rotation.x
      window.removeEventListener('deviceorientation', this.gyroHandler)
      this.firstGyroResolve = null
      this.dirty = true
    } else {
      this.needsBaseline = true
      window.addEventListener('deviceorientation', this.gyroHandler)
      this.dirty = true
    }
  }

  private gyroHandler = (e: DeviceOrientationEvent): void => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    const rad = Math.PI / 180
    // iOS Safari 的 screen.orientation.angle 有恒为 0 的 bug，横屏补偿会丢；
    // window.orientation 在 iOS 上一直可靠，故优先取它（Android 已移除该属性，自然落到标准接口）
    const screenAngle = (window as unknown as { orientation?: number }).orientation ?? screen.orientation?.angle ?? 0
    const orient = screenAngle * rad
    this.targetQuat.setFromEuler(this.gyroEuler.set(e.beta * rad, e.alpha * rad, -e.gamma * rad, 'YXZ'))
    this.targetQuat.multiply(GYRO_Q1).multiply(this.gyroQ0.setFromAxisAngle(GYRO_ZEE, -orient))
    if (this.needsBaseline) {
      // 首个事件：以当前视角为基准计算偏移，开启瞬间画面不跳变
      this.needsBaseline = false
      this.deviceQuat.copy(this.targetQuat)
      this.gyroOffset.copy(this.camera.quaternion).multiply(this.gyroQ0.copy(this.targetQuat).invert())
      this.applyGyroView()
      this.dirty = true
    }
    this.firstGyroResolve?.()
  }

  private applyGyroView(): void {
    // 偏移乘在世界帧（左乘）：物理俯仰/平摇永远对应视角的纯俯仰/平摇，
    // 不受偏移内容影响；右乘会把旋转轴扭成斜轴（表现为画面滚动）
    this.camera.quaternion.copy(this.gyroOffset).multiply(this.deviceQuat)
  }

  // 陀螺仪归零补间：偏移缓动到"设备正前方 = 默认朝向"，同时 FOV 复位
  private recenterGyro(): void {
    if (this.gyroResetting) cancelAnimationFrame(this.gyroResetRaf)
    const from = this.gyroOffset.clone()
    const to = this.defaultViewQuat.clone().multiply(this.deviceQuat.clone().invert())
    const fromFov = this.camera.fov
    const start = performance.now()
    this.gyroResetting = true
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / 450)
      const e = 1 - Math.pow(1 - t, 3)
      this.gyroOffset.slerpQuaternions(from, to, e)
      this.camera.fov = fromFov + (DEFAULT_FOV - fromFov) * e
      this.camera.updateProjectionMatrix()
      this.applyGyroView()
      this.dirty = true
      if (t < 1 && this.gyroResetting) this.gyroResetRaf = requestAnimationFrame(step)
      else this.gyroResetting = false
    }
    step()
  }

  private markInteract(): void {
    this.lastInteract = performance.now()
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.markInteract()
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
      this.markInteract()
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
    // 灵敏度
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
    this.markInteract()
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
    // 方向键也控制视角
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
    const now = performance.now()
    const dt = (now - this.lastFrame) / 1000
    this.lastFrame = now
    // 陀螺仪平滑放在渲染循环里逐帧追赶目标朝向：跟手且不受事件频率抖动影响
    if (this.gyroOn && !this.deviceQuat.equals(this.targetQuat)) {
      this.deviceQuat.slerp(this.targetQuat, 0.4)
      this.applyGyroView()
      this.dirty = true
    }
    // 自动旋转：交互静默后恢复，陀螺仪开启时让位
    if (this.autoRotate && !this.gyroOn && !this.dragging && !this.resetting &&
        now - this.lastInteract > ROTATE_IDLE_MS) {
      this.yaw += dt * ROTATE_SPEED
      this.applyManualView()
      this.dirty = true
    }
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
