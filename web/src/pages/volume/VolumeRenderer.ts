/**
 * GPU ray-marching volume renderer (raw three.js, WebGL2 / GLSL 3).
 *
 * - A unit proxy box is placed in three.js world space with the grid affine
 *   (origin / spacing / direction -> LPS -> lpsToWorld), so the volume sits in exactly the same
 *   frame as the anatomy meshes. The fragment shader intersects the ray with the clip box.
 * - Renders on demand. While the user interacts it renders one frame per change at an adaptive
 *   resolution; when idle it progressively accumulates jittered frames (sub-pixel + ray-start
 *   jitter, optional soft shadows) into a half-float target and then stops using the GPU.
 * - AI label masks (gate / solid / glass) are baked on the GPU into a 3D render target.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GridMeta, Vec3 } from '../../lib/data'
import { indexToLps } from '../../lib/coords'
import { bakeFrag, displayFrag, screenVert, volumeFrag, volumeVert } from './shaders'
import type { Mode, Shading, ViewName, VolumeKey } from './presets'

export type Quality = 'low' | 'medium' | 'high'
export type RenderGrid = GridMeta & { huMin: number; huMax: number }

export const QUALITY: Record<Quality, { step: number; frames: number; dpr: number; label: string }> = {
  low: { step: 1.6, frames: 6, dpr: 1, label: 'Low' },
  medium: { step: 1.0, frames: 16, dpr: 1.5, label: 'Medium' },
  high: { step: 0.6, frames: 36, dpr: 2, label: 'High' },
}

export interface RenderParams {
  mode: Mode
  volume: VolumeKey
  opacity: number
  gateFloor: number
  grad: { lo: number; hi: number; mod: number }
  shading: Shading
  lighting: boolean
  shadows: boolean
  quality: Quality
  /** per PATIENT axis fractions: [R..L], [A..P], [I..S] */
  clip: [[number, number], [number, number], [number, number]]
  win: [number, number, number, number]
  flags: { gate: boolean; solid: boolean; glass: boolean; tint: boolean; boneProtect: boolean }
  solidAlpha: number
  glass: number
  skinVeil: boolean
  gateRamp: [number, number]
}

interface VolEntry {
  key: VolumeKey
  meta: RenderGrid
  data: Uint8Array
  tex: THREE.Data3DTexture
  size: THREE.Vector3
  dims: THREE.Vector3
  R: THREE.Matrix3
  Rt: THREE.Matrix3
  T: THREE.Vector3
  model: THREE.Matrix4
  toMask: THREE.Matrix4
  center: THREE.Vector3
  corners: THREE.Vector3[]
  /** texture axis a -> [patient axis, sign] */
  axisMap: [number, number][]
}

export interface ProbeHit { lps: Vec3; ijk: Vec3; volume: VolumeKey }

const M_LPS_TO_WORLD = new THREE.Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0)

function dirMatrix(meta: GridMeta): THREE.Matrix3 {
  const d = meta.direction
  return new THREE.Matrix3().set(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8])
}

function halton(i: number, b: number): number {
  let f = 1, r = 0
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b) }
  return r
}

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  top: [0, 1, 0.0015],       // from the head: a pure tilt up from the front view (patient left stays on screen right)
  bottom: [0, -1, 0.0015],   // from the feet (radiological axial convention)
  hero: [0.5, 0.36, 1],
  heroHeart: [0.28, 0.16, 1],
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class VolumeRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly canvas: HTMLCanvasElement

  onView?: () => void
  onProgress?: (frame: number, total: number, interactive: boolean) => void
  onError?: (msg: string) => void

  private scene = new THREE.Scene()
  private box: THREE.Mesh
  private uniforms: Record<string, THREE.IUniform>
  private material: THREE.RawShaderMaterial
  private probeMaterial: THREE.RawShaderMaterial
  private screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private displayScene = new THREE.Scene()
  private displayMat: THREE.RawShaderMaterial
  private bakeScene = new THREE.Scene()
  private bakeMat: THREE.RawShaderMaterial
  private acc: THREE.WebGLRenderTarget
  private probeRT: THREE.WebGLRenderTarget
  private maskRT: THREE.WebGL3DRenderTarget | null = null
  private labelTex: THREE.Data3DTexture | null = null
  private labelMeta: GridMeta | null = null
  private styleTex: THREE.DataTexture
  private classTex: THREE.DataTexture
  private tfTex: THREE.DataTexture
  private vols = new Map<VolumeKey, VolEntry>()
  private active: VolEntry | null = null
  private params: RenderParams | null = null

  private cssW = 1
  private cssH = 1
  private frame = 0
  private interactScale = 0.6
  private dtEma = 16.7
  private lastTick = 0
  private lastWasInteractive = false
  private lastChange = 0
  private pointerDown = false
  private raf = 0
  private disposed = false
  private anim: null | { t0: number; dur: number; from: THREE.Spherical; to: THREE.Spherical; tFrom: THREE.Vector3; tTo: THREE.Vector3 } = null
  private autoRotate = false
  private reducedMotion = false
  private frameCounter = 0
  private tmpV = new THREE.Vector3()
  private halfFloatOK: boolean
  private lastRenderMs = 0
  // GPU timing (EXT_disjoint_timer_query_webgl2) drives adaptive resolution when available
  private gpuTimer: { gl: WebGL2RenderingContext; ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: { q: WebGLQuery; interactive: boolean }[] } | null = null
  private gpuMsI = 0
  private gpuMsR = 0
  private refineScale = 1
  private lastStyle: { style: Uint8Array; lut: Uint8Array } | null = null
  onRecovered?: () => void

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'vol-canvas'
    container.appendChild(this.canvas)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      depth: false,
      stencil: false,
    })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '')
      this.onError?.(`Shader failed to compile on this GPU.\n${log.slice(0, 600)}`)
    }
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const ext = this.renderer.extensions
    this.halfFloatOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
    this.initTimer()

    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 6000)
    this.camera.position.set(0, 0, 900)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.rotateSpeed = 0.75
    this.controls.zoomSpeed = 0.9
    this.controls.panSpeed = 0.8
    this.controls.screenSpacePanning = true
    this.controls.autoRotateSpeed = 1.6
    this.controls.addEventListener('start', () => { this.pointerDown = true; this.anim = null; this.markChanged() })
    this.controls.addEventListener('end', () => { this.pointerDown = false; this.markChanged() })

    // --- textures that always exist
    this.tfTex = new THREE.DataTexture(new Uint16Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.HalfFloatType)
    this.tfTex.minFilter = this.tfTex.magFilter = THREE.LinearFilter
    this.tfTex.needsUpdate = true
    this.classTex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    this.classTex.minFilter = this.classTex.magFilter = THREE.NearestFilter
    this.classTex.needsUpdate = true
    this.styleTex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    this.styleTex.minFilter = this.styleTex.magFilter = THREE.NearestFilter
    this.styleTex.needsUpdate = true

    // --- volume material
    this.uniforms = {
      uVol: { value: null }, uTF: { value: this.tfTex }, uMask: { value: null }, uLabel: { value: null }, uClassLUT: { value: this.classTex }, uStyle: { value: this.styleTex },
      uSize: { value: new THREE.Vector3(1, 1, 1) }, uDims: { value: new THREE.Vector3(1, 1, 1) },
      uCam: { value: new THREE.Vector3() }, uClipMin: { value: new THREE.Vector3() }, uClipMax: { value: new THREE.Vector3(1, 1, 1) },
      uCapMin: { value: new THREE.Vector3() }, uCapMax: { value: new THREE.Vector3() },
      uToMask: { value: new THREE.Matrix4() }, uMaskDims: { value: new THREE.Vector3(1, 1, 1) },
      uStep: { value: 1 }, uHuMin: { value: -1024 }, uHuRange: { value: 3000 }, uOpacity: { value: 1 }, uGateFloor: { value: 0 },
      uGrad: { value: new THREE.Vector3(10, 100, 0) }, uLight: { value: new THREE.Vector3(0, 0, 1) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uMat: { value: new THREE.Vector4(0.3, 0.8, 0.3, 30) }, uFrame: { value: 0 }, uShadows: { value: 0 },
      uWin: { value: new THREE.Vector4(0, 1, 0, 1) }, uSolidAlpha: { value: 3 }, uGlass: { value: 0.6 }, uGradStencil: { value: 1 }, uSkinVeil: { value: 0 }, uGateRamp: { value: new THREE.Vector2(0.05, 0.32) },
    }
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: volumeVert,
      fragmentShader: volumeFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ConstantAlphaFactor,
      blendDst: THREE.OneMinusConstantAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ConstantAlphaFactor,
      blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
    })
    this.probeMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: volumeVert,
      fragmentShader: volumeFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      defines: { PROBE: 1 },
    })
    const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
    this.box = new THREE.Mesh(boxGeo, this.material)
    this.box.matrixAutoUpdate = false
    this.box.frustumCulled = false
    this.scene.add(this.box)

    // --- full-screen passes
    const tri = new THREE.BufferGeometry()
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.displayMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: screenVert, fragmentShader: displayFrag,
      uniforms: { uTex: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const dq = new THREE.Mesh(tri, this.displayMat); dq.frustumCulled = false
    this.displayScene.add(dq)
    this.bakeMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: screenVert, fragmentShader: bakeFrag,
      uniforms: { uLabel: { value: null }, uStyle: { value: this.styleTex }, uLayer: { value: 0 }, uDims: { value: new THREE.Vector3(1, 1, 1) } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const bq = new THREE.Mesh(tri, this.bakeMat); bq.frustumCulled = false
    this.bakeScene.add(bq)

    this.acc = new THREE.WebGLRenderTarget(2, 2, {
      type: this.halfFloatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.displayMat.uniforms.uTex.value = this.acc.texture
    this.probeRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    })

    this.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.raf = requestAnimationFrame(this.tick)
  }

  // ------------------------------------------------------------------ data

  addVolume(key: VolumeKey, meta: RenderGrid, data: Uint8Array, labelMeta: GridMeta | null, worldCenter: Vec3) {
    if (this.vols.has(key)) return
    const [nx, ny, nz] = meta.dims
    const tex = new THREE.Data3DTexture(data, nx, ny, nz)
    tex.format = THREE.RedFormat
    tex.type = THREE.UnsignedByteType
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
    tex.unpackAlignment = 1
    tex.generateMipmaps = false
    tex.needsUpdate = true

    const s = new THREE.Vector3(...meta.spacing)
    const dims = new THREE.Vector3(nx, ny, nz)
    const size = s.clone().multiply(dims)
    const D = dirMatrix(meta)
    const R = M_LPS_TO_WORLD.clone().multiply(D)
    const Rt = R.clone().transpose()
    // world(x) = R x + T,   T = M (o - D s/2 - c)
    const halfS = s.clone().multiplyScalar(0.5).applyMatrix3(D)
    const o = new THREE.Vector3(...meta.origin)
    const c = new THREE.Vector3(...worldCenter)
    const T = o.clone().sub(halfS).sub(c).applyMatrix3(M_LPS_TO_WORLD)
    const RS = R.clone().multiply(new THREE.Matrix3().set(size.x, 0, 0, 0, size.y, 0, 0, 0, size.z))
    const e = RS.elements // column-major
    const model = new THREE.Matrix4().set(
      e[0], e[3], e[6], T.x,
      e[1], e[4], e[7], T.y,
      e[2], e[5], e[8], T.z,
      0, 0, 0, 1,
    )
    // X -> mask texture coords (labels live on the render grid)
    const lm = labelMeta ?? meta
    const A1 = affine(D, o.clone().sub(halfS))                       // X -> LPS
    const Dl = dirMatrix(lm)
    const sl = new THREE.Vector3(...lm.spacing)
    const nl = new THREE.Vector3(...lm.dims)
    const inv = new THREE.Matrix3().set(1 / (sl.x * nl.x), 0, 0, 0, 1 / (sl.y * nl.y), 0, 0, 0, 1 / (sl.z * nl.z)).multiply(Dl.clone().transpose())
    const ol = new THREE.Vector3(...lm.origin).applyMatrix3(inv).negate().add(new THREE.Vector3(0.5 / nl.x, 0.5 / nl.y, 0.5 / nl.z))
    const A2 = affine(inv, ol)                                         // LPS -> mask tc
    const toMask = A2.multiply(A1)

    // Frame the camera on the body, not on the air-padded box: bounding box of voxels > -400 HU.
    const [bMin, bMax] = bodyBounds(data, meta, size)
    const corners: THREE.Vector3[] = []
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
      corners.push(new THREE.Vector3(i ? bMax.x : bMin.x, j ? bMax.y : bMin.y, k ? bMax.z : bMin.z).applyMatrix3(R).add(T))
    }
    const center = bMin.clone().add(bMax).multiplyScalar(0.5).applyMatrix3(R).add(T)
    const axisMap: [number, number][] = [0, 1, 2].map((a) => {
      const col = [meta.direction[a], meta.direction[3 + a], meta.direction[6 + a]]
      let best = 0
      for (let p = 1; p < 3; p++) if (Math.abs(col[p]) > Math.abs(col[best])) best = p
      return [best, Math.sign(col[best]) || 1]
    })
    this.vols.set(key, { key, meta, data, tex, size, dims, R, Rt, T, model, toMask, center, corners, axisMap })
    if (this.params?.volume === key) this.applyParams(this.params)
  }

  hasVolume(key: VolumeKey) { return this.vols.has(key) }

  /** Frame the camera on a sub-region (LPS bounds), e.g. the AI heart label inside the heart scan. */
  setFocusBounds(key: VolumeKey, lpsMin: Vec3, lpsMax: Vec3, worldCenter: Vec3) {
    const v = this.vols.get(key)
    if (!v) return
    const c = new THREE.Vector3(...worldCenter)
    const corners: THREE.Vector3[] = []
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
      const p = new THREE.Vector3(i ? lpsMax[0] : lpsMin[0], j ? lpsMax[1] : lpsMin[1], k ? lpsMax[2] : lpsMin[2])
      corners.push(p.sub(c).applyMatrix3(M_LPS_TO_WORLD))
    }
    v.corners = corners
    v.center = corners.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / 8)
  }

  setLabels(meta: GridMeta, data: Uint8Array) {
    if (this.labelTex) return
    const [nx, ny, nz] = meta.dims
    const tex = new THREE.Data3DTexture(data, nx, ny, nz)
    tex.format = THREE.RedFormat
    tex.type = THREE.UnsignedByteType
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.unpackAlignment = 1
    tex.generateMipmaps = false
    tex.needsUpdate = true
    this.labelTex = tex
    this.labelMeta = meta
    this.maskRT = new THREE.WebGL3DRenderTarget(nx, ny, nz, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    })
    this.maskRT.texture.wrapR = THREE.ClampToEdgeWrapping
    this.uniforms.uLabel.value = tex
    this.uniforms.uMask.value = this.maskRT.texture
    this.uniforms.uMaskDims.value.set(nx, ny, nz)
    this.bakeMat.uniforms.uLabel.value = tex
    this.bakeMat.uniforms.uDims.value = new THREE.Vector3(nx, ny, nz)
  }

  /** Re-bake the label mask volume from per-class styles (256 x RGBA). Fast: one draw per z-layer. */
  setClassStyles(style: Uint8Array, lut: Uint8Array) {
    this.lastStyle = { style, lut }
    ;(this.classTex.image.data as Uint8Array).set(lut)
    this.classTex.needsUpdate = true
    if (!this.maskRT || !this.labelTex) { this.markChanged(); return }
    ;(this.styleTex.image.data as Uint8Array).set(style)
    this.styleTex.needsUpdate = true
    const prev = this.renderer.getRenderTarget()
    const depth = this.maskRT.depth
    for (let z = 0; z < depth; z++) {
      this.bakeMat.uniforms.uLayer.value = z
      this.renderer.setRenderTarget(this.maskRT, z)
      this.renderer.render(this.bakeScene, this.screenCam)
    }
    this.renderer.setRenderTarget(prev)
    this.markChanged()
  }

  setTF(lut: Float32Array) {
    const d = this.tfTex.image.data as Uint16Array
    for (let i = 0; i < lut.length; i++) d[i] = THREE.DataUtils.toHalfFloat(Math.min(lut[i], 60000))
    this.tfTex.needsUpdate = true
    this.markChanged()
  }

  setParams(p: RenderParams) {
    const qualityChanged = this.params?.quality !== p.quality
    this.params = p
    if (qualityChanged && Math.abs(this.renderer.getPixelRatio() - this.canvasDpr()) > 1e-3) this.resize(this.cssW, this.cssH)
    this.applyParams(p)
  }

  private applyParams(p: RenderParams) {
    const v = this.vols.get(p.volume) ?? null
    const switched = v !== this.active
    this.active = v
    const u = this.uniforms
    // defines -> program variant
    const defs: Record<string, number> = {}
    if (p.mode === 'tf') defs.MODE_TF = 1
    else if (p.mode === 'label') defs.MODE_LABEL = 1
    else if (p.mode === 'drr') defs.MODE_DRR = 1
    else defs.MODE_MIP = 1
    if (p.mode === 'tf' || p.mode === 'label') {
      if (p.flags.gate && p.mode === 'tf') defs.USE_GATE = 1
      if (p.flags.solid) defs.USE_SOLID = 1
      if (p.flags.glass) defs.USE_GLASS = 1
      if (p.flags.tint && p.mode === 'tf') defs.USE_TINT = 1
      if (p.flags.boneProtect) defs.BONE_PROTECT = 1
      if (p.lighting || p.mode === 'label') defs.USE_SHADING = 1
      if (p.lighting && p.shadows && p.mode === 'tf') defs.USE_SHADOWS = 1
    }
    if (!this.maskRT) { delete defs.USE_GATE; delete defs.USE_SOLID; delete defs.USE_GLASS; delete defs.USE_TINT }
    if (!sameDefines(this.material.defines, defs)) {
      this.material.defines = defs
      this.material.needsUpdate = true
      this.probeMaterial.defines = { ...defs, PROBE: 1 }
      this.probeMaterial.needsUpdate = true
    }
    if (v) {
      this.box.matrix.copy(v.model)
      this.box.matrixWorldNeedsUpdate = true
      u.uVol.value = v.tex
      u.uSize.value.copy(v.size)
      u.uDims.value.copy(v.dims)
      u.uToMask.value.copy(v.toMask)
      // the heart series is thinner-voxelled but noisier: smooth its normals with a wider stencil
      u.uGradStencil.value = v.key === 'heart' ? 1.7 : 1.0
      u.uHuMin.value = v.meta.huMin
      u.uHuRange.value = v.meta.huMax - v.meta.huMin
      const minSp = Math.min(...v.meta.spacing)
      u.uStep.value = Math.max(0.25, QUALITY[p.quality].step * minSp)
      // clip box: patient-axis fractions -> texture axes
      const lo = new THREE.Vector3(), hi = new THREE.Vector3(), capLo = new THREE.Vector3(), capHi = new THREE.Vector3()
      for (let a = 0; a < 3; a++) {
        const [pa, sign] = v.axisMap[a]
        let [l, h] = p.clip[pa]
        if (sign < 0) [l, h] = [1 - h, 1 - l]
        const sz = v.size.getComponent(a)
        lo.setComponent(a, l * sz); hi.setComponent(a, Math.max(l + 0.002, h) * sz)
        capLo.setComponent(a, l > 0.001 ? 1 : 0); capHi.setComponent(a, h < 0.999 ? 1 : 0)
      }
      u.uClipMin.value.copy(lo); u.uClipMax.value.copy(hi)
      u.uCapMin.value.copy(capLo); u.uCapMax.value.copy(capHi)
    }
    u.uOpacity.value = p.opacity
    u.uGateFloor.value = p.gateFloor
    u.uSkinVeil.value = p.skinVeil ? 1 : 0
    u.uGateRamp.value.set(p.gateRamp[0], p.gateRamp[1])
    u.uGrad.value.set(p.grad.lo, p.grad.hi, p.grad.mod)
    u.uMat.value.set(p.shading.ambient, p.shading.diffuse, p.shading.specular, p.shading.shininess)
    u.uWin.value.set(...p.win)
    u.uSolidAlpha.value = p.solidAlpha
    u.uGlass.value = p.glass
    if (switched) this.onView?.()
    this.markChanged()
  }

  // ------------------------------------------------------------------ camera

  /** Distance so the active box fits the viewport from direction `dir` (unit, target -> camera). */
  private fitDistance(dir: THREE.Vector3, target: THREE.Vector3, corners: THREE.Vector3[]): number {
    const f = dir.clone().negate()
    let r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0))
    if (r.lengthSq() < 1e-6) r = new THREE.Vector3(1, 0, 0)
    r.normalize()
    const up = new THREE.Vector3().crossVectors(r, f).normalize()
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const tanH = tanV * this.camera.aspect
    const margin = this.cssW < 560 ? 0.94 : 0.84
    let D = 0
    for (const c of corners) {
      const rel = c.clone().sub(target)
      const depth = rel.dot(dir)
      const x = Math.abs(rel.dot(r)), y = Math.abs(rel.dot(up))
      D = Math.max(D, depth + Math.max(x / (tanH * margin), y / (tanV * margin)))
    }
    return D
  }

  flyTo(view: ViewName, opts: { animate?: boolean; duration?: number; fromFar?: boolean } = {}) {
    const v = this.active
    if (!v) return
    const dir = new THREE.Vector3(...VIEW_DIRS[view]).normalize()
    const target = v.center.clone()
    const dist = this.fitDistance(dir, target, v.corners)
    const to = new THREE.Spherical().setFromVector3(dir.clone().multiplyScalar(dist))
    this.controls.minDistance = dist * 0.12
    this.controls.maxDistance = dist * 4
    const animate = (opts.animate ?? true) && !this.reducedMotion
    if (!animate) {
      this.anim = null
      this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(to))
      this.controls.target.copy(target)
      this.camera.lookAt(target)
      this.controls.update()
      this.markChanged()
      this.onView?.()
      return
    }
    const fromVec = this.camera.position.clone().sub(this.controls.target)
    const from = new THREE.Spherical().setFromVector3(fromVec)
    if (opts.fromFar) {
      from.radius = dist * 2.1
      from.theta = to.theta - 0.9
      from.phi = Math.min(Math.PI - 0.2, to.phi + 0.25)
    }
    // shortest way round in azimuth
    let dTheta = to.theta - from.theta
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI
    const toAdj = to.clone(); toAdj.theta = from.theta + dTheta
    this.anim = { t0: performance.now(), dur: opts.duration ?? 850, from, to: toAdj, tFrom: opts.fromFar ? target.clone() : this.controls.target.clone(), tTo: target }
    this.markChanged()
  }

  /** Change the vertical field of view, dollying so the framing stays the same (narrow = flatter, X-ray-like). */
  setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(k)
    this.camera.position.copy(this.controls.target).add(off)
    this.camera.fov = fov
    this.camera.far = Math.max(6000, off.length() * 4)
    this.camera.updateProjectionMatrix()
    this.controls.minDistance *= k
    this.controls.maxDistance *= k
    if (this.anim) { this.anim.from.radius *= k; this.anim.to.radius *= k }
    this.controls.update()
    this.markChanged()
    this.onView?.()
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on && !this.reducedMotion
    this.controls.autoRotate = this.autoRotate
    this.markChanged()
  }

  /** Project an LPS point to CSS pixels in the canvas (null if behind the camera). */
  projectLps(lps: Vec3, worldCenter: Vec3): { x: number; y: number } | null {
    const w = this.tmpV.set(lps[0] - worldCenter[0], lps[2] - worldCenter[2], -(lps[1] - worldCenter[1]))
    const p = w.clone().project(this.camera)
    if (p.z > 1 || p.z < -1) return null
    return { x: (p.x * 0.5 + 0.5) * this.cssW, y: (-p.y * 0.5 + 0.5) * this.cssH }
  }

  /** Camera basis expressed in world (for orientation markers / cube). */
  viewBasis() {
    const m = this.camera.matrixWorld.elements
    return {
      right: new THREE.Vector3(m[0], m[1], m[2]).normalize(),
      up: new THREE.Vector3(m[4], m[5], m[6]).normalize(),
      back: new THREE.Vector3(m[8], m[9], m[10]).normalize(),
    }
  }

  /** PNG of the current (accumulated) image on a dark background. */
  snapshot(background = '#07090d'): Promise<Blob | null> {
    // re-present the accumulation buffer and read the canvas in the same task (no preserveDrawingBuffer needed)
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear()
    this.renderer.render(this.displayScene, this.screenCam)
    const c = document.createElement('canvas')
    c.width = this.canvas.width
    c.height = this.canvas.height
    const g = c.getContext('2d')
    if (!g) return Promise.resolve(null)
    const grad = g.createRadialGradient(c.width / 2, c.height * 0.46, 0, c.width / 2, c.height * 0.46, Math.max(c.width, c.height) * 0.7)
    grad.addColorStop(0, '#101826')
    grad.addColorStop(1, background)
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(this.canvas, 0, 0)
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
  }

  // ------------------------------------------------------------------ picking

  probe(cssX: number, cssY: number): ProbeHit | null {
    const v = this.active
    if (!v || !this.params || this.disposed) return null
    this.updateFrameUniforms()
    this.camera.setViewOffset(this.cssW, this.cssH, cssX, cssY, 1, 1)
    this.box.material = this.probeMaterial
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.probeRT)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear()
    this.uniforms.uShadows.value = 0
    this.renderer.render(this.scene, this.camera)
    const px = new Uint8Array(4)
    this.renderer.readRenderTargetPixels(this.probeRT, 0, 0, 1, 1, px)
    this.renderer.setRenderTarget(prev)
    this.box.material = this.material
    this.camera.clearViewOffset()
    if (px[3] < 128) return null
    const tc: Vec3 = [(px[0] + 0.5) / 256, (px[1] + 0.5) / 256, (px[2] + 0.5) / 256]
    const ijk: Vec3 = [tc[0] * v.dims.x - 0.5, tc[1] * v.dims.y - 0.5, tc[2] * v.dims.z - 0.5]
    return { lps: indexToLps(v.meta, ijk), ijk, volume: v.key }
  }

  // ------------------------------------------------------------------ frame loop

  /** Canvas backing-store pixel ratio: never more than the quality level will actually render. */
  private canvasDpr() {
    return Math.min(window.devicePixelRatio || 1, this.params ? QUALITY[this.params.quality].dpr : 1.5)
  }

  resize(cssW: number, cssH: number) {
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    this.renderer.setPixelRatio(this.canvasDpr())
    this.renderer.setSize(this.cssW, this.cssH, false)
    this.camera.aspect = this.cssW / this.cssH
    this.camera.updateProjectionMatrix()
    this.markChanged()
  }

  markChanged() {
    this.lastChange = performance.now()
    this.frame = 0
  }

  stats() {
    return {
      frame: this.frame, interactScale: +this.interactScale.toFixed(3), refineScale: +this.refineScale.toFixed(3), dtEma: +this.dtEma.toFixed(2),
      gpuMsInteractive: +this.gpuMsI.toFixed(2), gpuMsRefine: +this.gpuMsR.toFixed(2), cpuMs: +this.lastRenderMs.toFixed(2),
      halfFloat: this.halfFloatOK, timer: !!this.gpuTimer, accSize: [this.acc.width, this.acc.height],
    }
  }

  private initTimer() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
    this.gpuTimer = tq ? { gl, ext: tq, pending: [] } : null
  }

  private pollGpu() {
    const t = this.gpuTimer
    if (!t) return
    const gl = t.gl
    const disjoint = gl.getParameter(t.ext.GPU_DISJOINT_EXT)
    while (t.pending.length) {
      const p = t.pending[0]
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number
      gl.deleteQuery(p.q)
      t.pending.shift()
      if (disjoint) continue
      const ms = ns / 1e6
      if (p.interactive) this.gpuMsI = this.gpuMsI ? this.gpuMsI * 0.6 + ms * 0.4 : ms
      else {
        this.gpuMsR = this.gpuMsR ? this.gpuMsR * 0.6 + ms * 0.4 : ms
        // keep each refinement draw short (slow GPUs, watchdogs): shrink, or grow back when cheap
        if (this.gpuMsR > 70 && this.refineScale > 0.5) this.refineScale = Math.max(0.5, this.refineScale * 0.8)
        else if (this.gpuMsR < 25 && this.refineScale < 1) this.refineScale = Math.min(1, this.refineScale * 1.1)
      }
    }
  }

  private updateFrameUniforms() {
    const v = this.active
    if (!v) return
    this.camera.updateMatrixWorld()
    const u = this.uniforms
    u.uCam.value.copy(this.camera.position).sub(v.T).applyMatrix3(v.Rt)
    const q = this.camera.quaternion
    u.uLight.value.set(-0.38, 0.52, 1).normalize().applyQuaternion(q).applyMatrix3(v.Rt).normalize()
    u.uUp.value.set(0, 1, 0).applyQuaternion(q).applyMatrix3(v.Rt).normalize()
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = now - (this.lastTick || now)
    this.lastTick = now

    // camera animation
    if (this.anim) {
      const a = this.anim
      const k = Math.min(1, (now - a.t0) / a.dur)
      const e = easeInOut(k)
      const s = new THREE.Spherical(
        a.from.radius + (a.to.radius - a.from.radius) * e,
        a.from.phi + (a.to.phi - a.from.phi) * e,
        a.from.theta + (a.to.theta - a.from.theta) * e,
      )
      const tgt = a.tFrom.clone().lerp(a.tTo, e)
      this.controls.target.copy(tgt)
      this.camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(s))
      this.camera.lookAt(tgt)
      if (k >= 1) { this.anim = null; this.controls.update() }
      this.markChanged()
      this.onView?.()
    } else if (this.controls.update(this.autoRotate ? Math.min(dt, 100) / 1000 : null)) {
      this.markChanged()
      this.onView?.()
    }

    this.pollGpu()
    if (!this.active || !this.params) return
    const maxFrames = QUALITY[this.params.quality].frames
    const interactive = this.pointerDown || this.anim !== null || this.autoRotate || now - this.lastChange < 140
    if (!interactive && this.frame >= maxFrames) { this.lastWasInteractive = false; return }

    if (interactive) {
      if (this.lastWasInteractive && dt > 0 && dt < 250) {
        this.dtEma = this.dtEma * 0.85 + dt * 0.15
        if (++this.frameCounter % 4 === 0) {
          // prefer measured GPU time; fall back to frame pacing
          const slow = this.gpuTimer && this.gpuMsI > 0 ? this.gpuMsI > 13 : this.dtEma > 24
          const fast = this.gpuTimer && this.gpuMsI > 0 ? this.gpuMsI < 7 && this.dtEma < 20 : this.dtEma < 18.5
          if (slow) this.interactScale = Math.max(0.3, this.interactScale * 0.88)
          else if (fast) this.interactScale = Math.min(1, this.interactScale * 1.06)
        }
      }
      this.renderFrame(this.interactScale * Math.min(window.devicePixelRatio || 1, 1.25), 0, true)
      this.lastWasInteractive = true
      this.onProgress?.(0, maxFrames, true)
    } else {
      const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.params.quality].dpr) * this.refineScale
      this.renderFrame(dpr, this.frame, false)
      this.frame++
      this.lastWasInteractive = false
      this.onProgress?.(this.frame, maxFrames, false)
    }
  }

  private renderFrame(pixelScale: number, index: number, interactive: boolean) {
    const t0 = performance.now()
    const w = Math.max(1, Math.round(this.cssW * pixelScale))
    const h = Math.max(1, Math.round(this.cssH * pixelScale))
    if (this.acc.width !== w || this.acc.height !== h) this.acc.setSize(w, h)
    this.updateFrameUniforms()
    const u = this.uniforms
    u.uFrame.value = interactive ? 0 : index
    u.uShadows.value = interactive ? 0 : 1
    const baseStep = u.uStep.value as number
    if (interactive) u.uStep.value = baseStep * 1.3
    if (index > 0) {
      const jx = halton(index, 2) - 0.5, jy = halton(index, 3) - 0.5
      this.camera.setViewOffset(w, h, jx, jy, w, h)
    }
    this.material.blendAlpha = 1 / (index + 1)
    this.renderer.setRenderTarget(this.acc)
    if (index === 0) { this.renderer.setClearColor(0x000000, 0); this.renderer.clear() }
    const t = this.gpuTimer
    const q = t && t.pending.length < 8 ? t.gl.createQuery() : null
    if (t && q) t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q)
    this.renderer.render(this.scene, this.camera)
    if (t && q) { t.gl.endQuery(t.ext.TIME_ELAPSED_EXT); t.pending.push({ q, interactive }) }
    if (index > 0) this.camera.clearViewOffset()
    u.uStep.value = baseStep
    // present
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear()
    this.renderer.render(this.displayScene, this.screenCam)
    this.lastRenderMs = performance.now() - t0
  }

  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.gpuTimer = null   // query objects and extension die with the context
    this.onError?.('The graphics card reset (GPU context lost). Trying to recover… if nothing happens, reload the page.')
  }

  private onContextRestored = () => {
    // three.js re-initialises its GL state and re-uploads textures lazily; our baked mask must be redone.
    this.initTimer()
    if (this.lastStyle) this.setClassStyles(this.lastStyle.style, this.lastStyle.lut)
    this.markChanged()
    this.onRecovered?.()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    if (this.gpuTimer) { for (const p of this.gpuTimer.pending) this.gpuTimer.gl.deleteQuery(p.q); this.gpuTimer.pending = [] }
    this.controls.dispose()
    for (const v of this.vols.values()) v.tex.dispose()
    this.vols.clear()
    this.labelTex?.dispose()
    this.maskRT?.dispose()
    this.tfTex.dispose(); this.classTex.dispose(); this.styleTex.dispose()
    this.acc.dispose(); this.probeRT.dispose()
    this.material.dispose(); this.probeMaterial.dispose(); this.displayMat.dispose(); this.bakeMat.dispose()
    this.box.geometry.dispose()
    for (const s of [this.displayScene, this.bakeScene]) s.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    this.renderer.dispose()
    this.canvas.remove()
  }
}

/** X-space bounding box (mm) of voxels denser than -400 HU (strided scan, ~10 ms). */
function bodyBounds(data: Uint8Array, meta: RenderGrid, size: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const [nx, ny, nz] = meta.dims
  const thr = Math.round(((-400 - meta.huMin) / (meta.huMax - meta.huMin)) * 255)
  let x0 = nx, y0 = ny, z0 = nz, x1 = -1, y1 = -1, z1 = -1
  for (let k = 0; k < nz; k += 2) for (let j = 0; j < ny; j += 2) {
    const row = (k * ny + j) * nx
    for (let i = 0; i < nx; i += 2) {
      if (data[row + i] > thr) {
        if (i < x0) x0 = i; if (i > x1) x1 = i
        if (j < y0) y0 = j; if (j > y1) y1 = j
        if (k < z0) z0 = k; if (k > z1) z1 = k
      }
    }
  }
  if (x1 < 0) return [new THREE.Vector3(), size.clone()]
  const s = size.clone().divide(new THREE.Vector3(nx, ny, nz))
  const lo = new THREE.Vector3(Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.max(0, z0 - 2)).multiply(s)
  const hi = new THREE.Vector3(Math.min(nx, x1 + 3), Math.min(ny, y1 + 3), Math.min(nz, z1 + 3)).multiply(s)
  return [lo, hi]
}

function affine(m3: THREE.Matrix3, t: THREE.Vector3): THREE.Matrix4 {
  const e = m3.elements
  return new THREE.Matrix4().set(e[0], e[3], e[6], t.x, e[1], e[4], e[7], t.y, e[2], e[5], e[8], t.z, 0, 0, 0, 1)
}

function sameDefines(a: Record<string, unknown> | undefined, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a ?? {}), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return kb.every((k) => (a ?? {})[k] === b[k])
}
