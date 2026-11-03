import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ElevationGrid } from '../../lib/dem/types'
import {
  buildTerrainGeometry,
  buildWaterGeometry,
  cellAtLocal,
  terrainHeightAt,
  type TerrainFrame,
} from '../../lib/terrain3d/geometry'

const SILT = new Color('#f1ede4')
const SLATE = new Color('#5b636b')
const RAIN = new Color('#5f7d96')
const SPLASH = new Color('#d6e6f4')

/** Upper bound on rain streaks; the intensity control uses a share of it. */
export const MAX_DROPS = 6000
const MAX_SPLASHES = 400
const SPLASH_SECONDS = 0.35
/** Seconds for displayed water to rise to the modelled level when rain starts. Display only. */
const RISE_SECONDS = 4

export interface PointerCell {
  row: number
  col: number
}

/**
 * Three.js scene for one elevation grid: terrain, modelled water and a rain animation.
 * All geometry comes from the real grid and scenario arrays; the animation only moves
 * particles and eases the displayed water level towards the modelled one.
 */
export class TerrainScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(40, 1, 1, 100_000)
  private controls: OrbitControls
  private sun = new DirectionalLight(0xffffff, 2.4)
  private resizeObserver: ResizeObserver
  private raycaster = new Raycaster()
  private pointer = new Vector2(2, 2)
  private pointerDirty = false

  private grid: ElevationGrid | null = null
  private frame: TerrainFrame | null = null
  private terrain: Mesh | null = null
  private plinth: Mesh | null = null
  private water: Mesh | null = null
  private waterTop: Float32Array | null = null
  private waterRise: Float32Array | null = null
  private riseProgress = 1

  private rain: LineSegments
  private drops = new Float32Array(MAX_DROPS * 4) // x, y, z, speed
  private activeDrops = 0
  private raining = false
  private paused = false
  private splashes: InstancedMesh
  private splashAge = new Float32Array(MAX_SPLASHES).fill(Infinity)
  private splashPosition = new Float32Array(MAX_SPLASHES * 3)
  private nextSplash = 0
  private dummy = new Object3D()
  private lastTime = 0
  private lastAzimuth = Number.NaN

  onPointerCell: (cell: PointerCell | null) => void = () => {}
  onAzimuth: (radians: number) => void = () => {}

  private container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.setClearColor(SILT)
    container.appendChild(this.renderer.domElement)

    this.scene.background = SILT
    this.scene.add(new HemisphereLight(0xfaf7f0, 0x5b636b, 1.1))
    // From the north-west, matching the 2D hillshade.
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun, this.sun.target)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.47 // stay above the horizon
    this.controls.screenSpacePanning = true

    const rainGeometry = new BufferGeometry()
    rainGeometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_DROPS * 6), 3))
    rainGeometry.setDrawRange(0, 0)
    this.rain = new LineSegments(rainGeometry, new LineBasicMaterial({ color: RAIN, transparent: true, opacity: 0.55 }))
    this.rain.frustumCulled = false
    this.scene.add(this.rain)

    const ring = new CircleGeometry(1, 12)
    ring.rotateX(-Math.PI / 2)
    this.splashes = new InstancedMesh(ring, new MeshBasicMaterial({ color: SPLASH, transparent: true, opacity: 0.55, depthWrite: false }), MAX_SPLASHES)
    this.splashes.frustumCulled = false
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    for (let k = 0; k < MAX_SPLASHES; k++) this.splashes.setMatrixAt(k, this.dummy.matrix)
    this.scene.add(this.splashes)

    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.renderer.setAnimationLoop(this.tick)
  }

  /** Builds the terrain for a grid, replacing any previous one, and frames the camera on it. */
  setTerrain(grid: ElevationGrid, exaggeration: number, keepCamera = false): TerrainFrame {
    this.removeMesh(this.terrain)
    this.removeMesh(this.plinth)
    const built = buildTerrainGeometry(grid, exaggeration)
    this.grid = grid
    this.frame = built.frame

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
    geometry.setAttribute('color', new BufferAttribute(built.colors, 3))
    geometry.setIndex(new BufferAttribute(built.indices, 1))
    geometry.computeVertexNormals()
    this.terrain = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }))
    this.terrain.castShadow = true
    this.terrain.receiveShadow = true
    this.scene.add(this.terrain)

    this.plinth = this.buildPlinth(built.positions, built.frame)
    this.scene.add(this.plinth)

    const { extentX, extentZ } = built.frame
    const size = Math.max(extentX, extentZ)
    const relief = (built.frame.maxElevation - built.frame.minElevation) * exaggeration
    this.scene.fog = new Fog(SILT, size * 2.2, size * 5)
    this.sun.position.set(-size * 0.8, size * 1.1, -size * 0.6)
    this.sun.target.position.set(0, 0, 0)
    const shadow = this.sun.shadow.camera
    shadow.left = -size * 0.8
    shadow.right = size * 0.8
    shadow.top = size * 0.8
    shadow.bottom = -size * 0.8
    shadow.near = 1
    shadow.far = size * 4
    shadow.updateProjectionMatrix()

    this.controls.minDistance = size * 0.15
    this.controls.maxDistance = size * 3
    if (keepCamera) this.controls.update()
    else this.frameCamera(size, relief)
    this.respawnAllDrops()
    return built.frame
  }

  /**
   * Places the camera at the home view. With damping on, OrbitControls keeps the
   * rotation, pan and zoom still owed from the last drag and applies part of it on every
   * update; that is flushed first so the view lands in the same place every time.
   */
  private frameCamera(size: number, relief: number): void {
    this.controls.enableDamping = false
    this.controls.update()
    // Angled view from the south-south-east, looking north across the area.
    this.camera.position.set(size * 0.35, relief + size * 0.6, size * 0.95)
    this.controls.target.set(0, relief * 0.3, 0)
    this.controls.update()
    this.controls.enableDamping = true
  }

  /** Draws modelled ponding, or removes water when `pondDepthM` is null. */
  setWater(pondDepthM: Float32Array | null): { cells: number; maxDepthM: number } {
    this.removeMesh(this.water)
    this.water = null
    this.waterTop = null
    this.waterRise = null
    if (!pondDepthM || !this.grid || !this.frame) return { cells: 0, maxDepthM: 0 }
    const built = buildWaterGeometry(this.grid, this.frame, pondDepthM)
    if (built.cells === 0) return { cells: 0, maxDepthM: 0 }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(built.positions.slice(), 3))
    geometry.setAttribute('color', new BufferAttribute(built.colors, 3))
    geometry.setIndex(new BufferAttribute(built.indices, 1))
    geometry.computeVertexNormals()
    const material = new MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      roughness: 0.18,
      metalness: 0.05,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.water = new Mesh(geometry, material)
    this.water.receiveShadow = true
    this.waterTop = built.positions
    this.waterRise = built.rise
    this.scene.add(this.water)
    this.applyWaterLevel(this.riseProgress)
    return { cells: built.cells, maxDepthM: built.maxDepthM }
  }

  /** Share of the maximum number of rain streaks to animate, 0–1. */
  setRainIntensity(share: number): void {
    this.activeDrops = Math.round(Math.min(1, Math.max(0, share)) * MAX_DROPS)
    this.rain.geometry.setDrawRange(0, this.raining ? this.activeDrops * 2 : 0)
  }

  startRain(): void {
    if (!this.raining) {
      this.raining = true
      this.riseProgress = 0
      this.applyWaterLevel(0)
      this.respawnAllDrops()
    }
    this.paused = false
    this.rain.geometry.setDrawRange(0, this.activeDrops * 2)
  }

  pauseRain(): void {
    this.paused = true
  }

  /** Stops the rain and shows water at its modelled level. */
  stopRain(): void {
    this.raining = false
    this.paused = false
    this.riseProgress = 1
    this.applyWaterLevel(1)
    this.rain.geometry.setDrawRange(0, 0)
    this.hideSplashes()
  }

  /** Returns to the home view of the current terrain without rebuilding it. */
  resetView(): void {
    if (!this.frame) return
    const { extentX, extentZ, maxElevation, minElevation, exaggeration } = this.frame
    this.frameCamera(Math.max(extentX, extentZ), (maxElevation - minElevation) * exaggeration)
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave)
    this.controls.dispose()
    this.scene.traverse((object) => {
      const mesh = object as Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.sun.shadow.map?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  /** Draw calls and geometry counts, for checking that resources are released. */
  stats() {
    return { ...this.renderer.info.memory, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }
  }

  private buildPlinth(positions: Float32Array, frame: TerrainFrame): Mesh {
    // Walls down from the terrain's outer cells to a base below the lowest point,
    // so the area reads as a cut block of real ground.
    const base = -Math.max(frame.extentX, frame.extentZ) * 0.03
    const { width, height } = frame
    const ring: number[] = []
    for (let c = 0; c < width; c++) ring.push(c)
    for (let r = 1; r < height; r++) ring.push(r * width + width - 1)
    for (let c = width - 2; c >= 0; c--) ring.push((height - 1) * width + c)
    for (let r = height - 2; r > 0; r--) ring.push(r * width)
    const wall: number[] = []
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]
      const b = ring[(k + 1) % ring.length]
      if (!Number.isFinite(this.grid!.values[a]) || !Number.isFinite(this.grid!.values[b])) continue
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
      wall.push(ax, ay, az, ax, base, az, bx, by, bz, bx, by, bz, ax, base, az, bx, base, bz)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(wall), 3))
    geometry.computeVertexNormals()
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: SLATE, roughness: 1, side: DoubleSide }))
    mesh.receiveShadow = true
    return mesh
  }

  private applyWaterLevel(progress: number): void {
    if (!this.water || !this.waterTop || !this.waterRise) return
    const eased = 1 - (1 - progress) ** 3
    const position = this.water.geometry.getAttribute('position') as BufferAttribute
    const array = position.array as Float32Array
    for (let v = 0; v < this.waterRise.length; v++) {
      array[v * 3 + 1] = this.waterTop[v * 3 + 1] - (1 - eased) * this.waterRise[v]
    }
    position.needsUpdate = true
    this.water.visible = eased > 0.02
  }

  private spawnDrop(k: number, anywhereInHeight: boolean): void {
    if (!this.frame) return
    const { extentX, extentZ, maxElevation, minElevation, exaggeration } = this.frame
    const top = (maxElevation - minElevation) * exaggeration + Math.max(extentX, extentZ) * 0.35
    const d = k * 4
    this.drops[d] = (Math.random() - 0.5) * extentX
    this.drops[d + 2] = (Math.random() - 0.5) * extentZ
    this.drops[d + 1] = anywhereInHeight ? Math.random() * top : top * (0.85 + Math.random() * 0.15)
    this.drops[d + 3] = Math.max(extentX, extentZ) * (0.42 + Math.random() * 0.18)
  }

  private respawnAllDrops(): void {
    for (let k = 0; k < MAX_DROPS; k++) this.spawnDrop(k, true)
  }

  private addSplash(x: number, y: number, z: number): void {
    const k = this.nextSplash
    this.nextSplash = (k + 1) % MAX_SPLASHES
    this.splashAge[k] = 0
    this.splashPosition.set([x, y + 0.2, z], k * 3)
  }

  private hideSplashes(): void {
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    for (let k = 0; k < MAX_SPLASHES; k++) {
      this.splashAge[k] = Infinity
      this.splashes.setMatrixAt(k, this.dummy.matrix)
    }
    this.splashes.instanceMatrix.needsUpdate = true
  }

  private updateRain(dt: number): void {
    if (!this.grid || !this.frame) return
    const positions = (this.rain.geometry.getAttribute('position') as BufferAttribute).array as Float32Array
    const size = Math.max(this.frame.extentX, this.frame.extentZ)
    const streak = size * 0.012
    const drift = size * 0.02 // slight, constant wind from the west
    for (let k = 0; k < this.activeDrops; k++) {
      const d = k * 4
      const fall = this.drops[d + 3] * dt
      this.drops[d + 1] -= fall
      this.drops[d] += drift * dt
      const ground = terrainHeightAt(this.grid, this.frame, this.drops[d], this.drops[d + 2])
      if (!Number.isFinite(ground) || this.drops[d + 1] <= ground) {
        if (Number.isFinite(ground) && Math.random() < 0.08) this.addSplash(this.drops[d], ground, this.drops[d + 2])
        this.spawnDrop(k, false)
      }
      const p = k * 6
      positions[p] = this.drops[d]
      positions[p + 1] = this.drops[d + 1]
      positions[p + 2] = this.drops[d + 2]
      positions[p + 3] = this.drops[d] - drift * 0.02
      positions[p + 4] = this.drops[d + 1] + streak
      positions[p + 5] = this.drops[d + 2]
    }
    ;(this.rain.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true

    const radius = size * 0.004
    for (let k = 0; k < MAX_SPLASHES; k++) {
      if (this.splashAge[k] === Infinity) continue
      this.splashAge[k] += dt
      const t = this.splashAge[k] / SPLASH_SECONDS
      if (t >= 1) {
        this.splashAge[k] = Infinity
        this.dummy.scale.setScalar(0)
      } else {
        this.dummy.position.set(this.splashPosition[k * 3], this.splashPosition[k * 3 + 1], this.splashPosition[k * 3 + 2])
        this.dummy.scale.setScalar(radius * (0.3 + t))
      }
      this.dummy.updateMatrix()
      this.splashes.setMatrixAt(k, this.dummy.matrix)
    }
    this.splashes.instanceMatrix.needsUpdate = true
  }

  private tick = (time: number): void => {
    const dt = Math.min(0.05, this.lastTime ? (time - this.lastTime) / 1000 : 0)
    this.lastTime = time
    if (this.raining && !this.paused) {
      this.updateRain(dt)
      if (this.riseProgress < 1) {
        this.riseProgress = Math.min(1, this.riseProgress + dt / RISE_SECONDS)
        this.applyWaterLevel(this.riseProgress)
      }
    }
    this.controls.update()
    const azimuth = this.controls.getAzimuthalAngle()
    if (Math.abs(azimuth - this.lastAzimuth) > 0.002 || Number.isNaN(this.lastAzimuth)) {
      this.lastAzimuth = azimuth
      this.onAzimuth(azimuth)
    }
    if (this.pointerDirty) this.pick()
    this.renderer.render(this.scene, this.camera)
  }

  private pick(): void {
    this.pointerDirty = false
    if (!this.terrain || !this.frame || this.pointer.x > 1) return this.onPointerCell(null)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.terrain, false)[0]
    this.onPointerCell(hit ? cellAtLocal(this.frame, hit.point.x, hit.point.z) : null)
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.pointerDirty = true
  }

  private handlePointerLeave = (): void => {
    this.pointer.set(2, 2)
    this.pointerDirty = true
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container
    if (!clientWidth || !clientHeight) return
    this.renderer.setSize(clientWidth, clientHeight, false)
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
  }

  private removeMesh(mesh: Mesh | null): void {
    if (!mesh) return
    this.scene.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as MeshStandardMaterial).dispose()
  }
}
