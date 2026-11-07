/**
 * Raw WebGL2 multiplanar renderer: ONE context, up to 3 viewports via gl.viewport/scissor.
 * Volumes are uploaded once as R16I 3D textures (in z-chunks, so the UI stays responsive), the anatomy
 * labels and calcium candidates as R8UI 3D textures with 256x1 RGBA colour LUTs.
 */
import type { GridMeta, Vec3 } from '../../lib/data'
import { invAffine } from './geom'
import { dataKRange } from './probe'
import { FRAG, VERT } from './shaders'

export interface ViewDraw {
  /** device-pixel rect, GL origin (bottom-left) */
  x: number
  y: number
  w: number
  h: number
  key: string
  p0: Vec3
  pdx: Vec3
  pdy: Vec3
  normal: Vec3
  winLo: number
  winW: number
  slabMode: number
  slabN: number
  slabStep: number
  /** draw the anatomy-label overlay (and hover/selection rings) in this view */
  labels: boolean
}

export interface FrameDraw {
  labMode: 0 | 1 | 2
  labAlpha: number
  sel: number
  hov: number
  edgePx: number
  lesOn: boolean
  calcOn: boolean
  calcThr: number
}

interface Grid3D {
  tex: WebGLTexture
  dims: Vec3
  inv: Float32Array
  ready: boolean
  /** k slices holding image data; blank padding slices at either end of the stack are drawn as "outside" */
  kRange: [number, number]
}

type Uniforms = Record<string, WebGLUniformLocation | null>

const UNIFORMS = [
  'uVol', 'uLab', 'uLes', 'uLabLut', 'uLesLut', 'uVolM', 'uLabM', 'uLesM', 'uVolDims', 'uVolK', 'uLabDims', 'uLesDims',
  'uP0', 'uPdx', 'uPdy', 'uN', 'uWin', 'uSlabMode', 'uSlabN', 'uSlabStep', 'uLabOn', 'uLabMode', 'uLabAlpha',
  'uSel', 'uHov', 'uEdge', 'uLesOn', 'uCalcOn', 'uCalcThr', 'uBg',
]

const BG: Vec3 = [0.012, 0.016, 0.022]       // inside a viewport, outside the scanned volume
const GUTTER: [number, number, number] = [0.043, 0.055, 0.075] // lines between viewports

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

export class GLUnavailableError extends Error {}
/** Thrown when an upload is abandoned because the renderer was disposed or the context was lost. */
export class UploadCancelled extends Error {}

export class MprRenderer {
  readonly gl: WebGL2RenderingContext
  readonly max3D: number
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private u: Uniforms = {}
  private vols = new Map<string, Grid3D>()
  private lab: Grid3D | null = null
  private les: Grid3D | null = null
  private labLut: WebGLTexture
  private lesLut: WebGLTexture
  private dummyI: WebGLTexture
  private dummyU: WebGLTexture
  private disposed = false
  private epoch = 0

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    })
    if (!gl) throw new GLUnavailableError('WebGL2 is not available in this browser.')
    this.gl = gl
    this.max3D = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number
    this.prog = this.link(VERT, FRAG)
    this.vao = gl.createVertexArray()!
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(this.prog, n)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.dummyI = this.tex3D(gl.R16I, gl.RED_INTEGER, gl.SHORT, [1, 1, 1], new Int16Array(1))
    this.dummyU = this.tex3D(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, [1, 1, 1], new Uint8Array(1))
    this.labLut = this.lut(new Uint8Array(256 * 4))
    this.lesLut = this.lut(new Uint8Array(256 * 4))
  }

  get isLost() { return this.gl.isContextLost() }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s))
      }
      return s
    }
    const p = gl.createProgram()!
    const v = sh(gl.VERTEX_SHADER, vs)
    const f = sh(gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(p))
    }
    gl.deleteShader(v)
    gl.deleteShader(f)
    return p
  }

  private params3D() {
    const gl = this.gl
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  }

  private tex3D(internal: number, format: number, type: number, dims: Vec3, data: ArrayBufferView): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_3D, t)
    this.params3D()
    gl.texImage3D(gl.TEXTURE_3D, 0, internal, dims[0], dims[1], dims[2], 0, format, type, data)
    return t
  }

  private lut(rgba: Uint8Array): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    return t
  }

  setLabelLut(rgba: Uint8Array) { this.updateLut(this.labLut, rgba) }
  setLesionLut(rgba: Uint8Array) { this.updateLut(this.lesLut, rgba) }

  private updateLut(t: WebGLTexture, rgba: Uint8Array) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
  }

  /** Check a grid fits this GPU's 3D texture limit. */
  checkFits(meta: GridMeta): string | null {
    const big = Math.max(...meta.dims)
    return big > this.max3D
      ? `This series is ${big} voxels across, but this device's GPU allows at most ${this.max3D} per 3D texture.`
      : null
  }

  /** Chunked upload of a 3D grid; resolves when complete, rejects if the renderer is disposed/lost. */
  private async upload(
    meta: GridMeta, internal: number, format: number, type: number,
    data: Int16Array | Uint8Array, onProgress?: (done: number, total: number) => void,
  ): Promise<Grid3D> {
    const err = this.checkFits(meta)
    if (err) throw new Error(err)
    const gl = this.gl
    const epoch = this.epoch
    const [w, h, d] = meta.dims
    const t = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_3D, t)
    this.params3D()
    gl.texStorage3D(gl.TEXTURE_3D, 1, internal, w, h, d)
    const grid: Grid3D = { tex: t, dims: [w, h, d], inv: invAffine(meta), ready: false, kRange: [0, d - 1] }
    const per = Math.max(1, Math.floor(6e6 / (w * h)))
    for (let z = 0; z < d; z += per) {
      if (this.disposed || epoch !== this.epoch || gl.isContextLost()) {
        if (!gl.isContextLost()) gl.deleteTexture(t)
        throw new UploadCancelled('upload cancelled')
      }
      const nz = Math.min(per, d - z)
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_3D, t)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z, w, h, nz, format, type, data.subarray(z * w * h, (z + nz) * w * h))
      onProgress?.(z + nz, d)
      if (z + nz < d) await nextFrame()
    }
    grid.ready = true
    return grid
  }

  hasVolume(key: string) { return !!this.vols.get(key)?.ready }

  async uploadVolume(key: string, meta: GridMeta, data: Int16Array, onProgress?: (done: number, total: number) => void) {
    const gl = this.gl
    const g = await this.upload(meta, gl.R16I, gl.RED_INTEGER, gl.SHORT, data, onProgress)
    g.kRange = dataKRange(meta, data)
    const old = this.vols.get(key)
    if (old) gl.deleteTexture(old.tex)
    this.vols.set(key, g)
  }

  /** Free every volume texture except `keep`; returns the keys that were dropped. */
  dropVolumesExcept(keep: (string | null | undefined)[]): string[] {
    const dropped: string[] = []
    for (const [k, g] of this.vols) {
      if (!keep.includes(k)) {
        this.gl.deleteTexture(g.tex)
        this.vols.delete(k)
        dropped.push(k)
      }
    }
    return dropped
  }

  volumeKeys() { return [...this.vols.keys()] }

  async uploadLabels(meta: GridMeta, data: Uint8Array) {
    const gl = this.gl
    const g = await this.upload(meta, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data)
    if (this.lab) gl.deleteTexture(this.lab.tex)
    this.lab = g
  }

  async uploadLesions(meta: GridMeta, data: Uint8Array) {
    const gl = this.gl
    const g = await this.upload(meta, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data)
    if (this.les) gl.deleteTexture(this.les.tex)
    this.les = g
  }

  get labelsReady() { return !!this.lab?.ready }
  get lesionsReady() { return !!this.les?.ready }

  resize(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
  }

  draw(views: ViewDraw[], f: FrameDraw) {
    const gl = this.gl
    if (this.disposed || gl.isContextLost()) return
    const u = this.u
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(GUTTER[0], GUTTER[1], GUTTER[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)

    const lab = this.lab?.ready ? this.lab : null
    const les = this.les?.ready ? this.les : null
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, lab ? lab.tex : this.dummyU)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, les ? les.tex : this.dummyU)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.labLut)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.lesLut)
    gl.uniform1i(u.uVol, 0)
    gl.uniform1i(u.uLab, 1)
    gl.uniform1i(u.uLes, 2)
    gl.uniform1i(u.uLabLut, 3)
    gl.uniform1i(u.uLesLut, 4)
    const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    gl.uniformMatrix4fv(u.uLabM, false, lab ? lab.inv : I4)
    gl.uniformMatrix4fv(u.uLesM, false, les ? les.inv : I4)
    gl.uniform3i(u.uLabDims, ...(lab ? lab.dims : ([1, 1, 1] as Vec3)))
    gl.uniform3i(u.uLesDims, ...(les ? les.dims : ([1, 1, 1] as Vec3)))
    gl.uniform1i(u.uLabOn, lab ? 1 : 0)
    gl.uniform1i(u.uLabMode, f.labMode)
    gl.uniform1f(u.uLabAlpha, f.labAlpha)
    gl.uniform1i(u.uSel, f.sel)
    gl.uniform1i(u.uHov, f.hov)
    gl.uniform1f(u.uEdge, f.edgePx)
    gl.uniform1i(u.uLesOn, f.lesOn && les ? 1 : 0)
    gl.uniform1i(u.uCalcOn, f.calcOn ? 1 : 0)
    gl.uniform1f(u.uCalcThr, f.calcThr)
    gl.uniform3f(u.uBg, BG[0], BG[1], BG[2])

    gl.enable(gl.SCISSOR_TEST)
    for (const v of views) {
      if (v.w <= 0 || v.h <= 0) continue
      gl.viewport(v.x, v.y, v.w, v.h)
      gl.scissor(v.x, v.y, v.w, v.h)
      const vol = this.vols.get(v.key)
      if (!vol?.ready) {
        gl.clearColor(BG[0], BG[1], BG[2], 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        continue
      }
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_3D, vol.tex)
      gl.uniformMatrix4fv(u.uVolM, false, vol.inv)
      gl.uniform3i(u.uVolDims, vol.dims[0], vol.dims[1], vol.dims[2])
      gl.uniform2f(u.uVolK, vol.kRange[0], vol.kRange[1])
      gl.uniform3f(u.uP0, v.p0[0], v.p0[1], v.p0[2])
      gl.uniform3f(u.uPdx, v.pdx[0], v.pdx[1], v.pdx[2])
      gl.uniform3f(u.uPdy, v.pdy[0], v.pdy[1], v.pdy[2])
      gl.uniform3f(u.uN, v.normal[0], v.normal[1], v.normal[2])
      gl.uniform2f(u.uWin, v.winLo, 1 / Math.max(1, v.winW))
      gl.uniform1i(u.uSlabMode, v.slabMode)
      gl.uniform1i(u.uSlabN, v.slabN)
      gl.uniform1f(u.uSlabStep, v.slabStep)
      gl.uniform1i(u.uLabOn, lab && v.labels ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Free every GPU resource; `release` also drops the context (not wanted after a context loss). */
  dispose(release = true) {
    if (this.disposed) return
    this.disposed = true
    this.epoch++
    const gl = this.gl
    if (!gl.isContextLost()) {
      for (const g of this.vols.values()) gl.deleteTexture(g.tex)
      if (this.lab) gl.deleteTexture(this.lab.tex)
      if (this.les) gl.deleteTexture(this.les.tex)
      gl.deleteTexture(this.labLut)
      gl.deleteTexture(this.lesLut)
      gl.deleteTexture(this.dummyI)
      gl.deleteTexture(this.dummyU)
      gl.deleteVertexArray(this.vao)
      gl.deleteProgram(this.prog)
    }
    this.vols.clear()
    this.lab = null
    this.les = null
    if (!release) return // context lost: the canvas is reused by the renderer created on restore
    // Shrink the drawing buffer right away; in production also drop the context itself. (Dev skips the
    // explicit loss: React StrictMode mounts twice and Chrome logs a warning for every loseContext call.)
    this.canvas.width = 1
    this.canvas.height = 1
    if (import.meta.env.PROD && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
