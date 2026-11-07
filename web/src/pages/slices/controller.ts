/**
 * Imperative core of the slice explorer: owns the WebGL + overlay canvases, uploads data, renders on
 * demand (one rAF per change, no continuous loop) and turns pointer/wheel/keyboard/touch input into
 * store updates. React only renders the chrome around it.
 */
import type { Manifest, Vec3 } from '../../lib/data'
import { loadGrid } from '../../lib/data'
import { sampleNearest } from '../../lib/coords'
import type { CalciumReport } from '../../lib/reports'
import { useApp } from '../../lib/store'
import { structureIndex } from './finder'
import {
  clamp, dist, dot, madd, slicePos, sliceAt, slotAt, slotToLps, snapToGrid, volumeByKey,
  type SlotModel, type Xf,
} from './geom'
import { modelFromState } from './model'
import { drawOverlay, type Caliper, type CandidateMark } from './overlay'
import { blankSlices, probeHU, slabSamples } from './probe'
import { GLUnavailableError, MprRenderer, UploadCancelled, type ViewDraw } from './renderer'
import { useHover, useLoad, useSlc, type SlabMode } from './state'

// CPU copies (loadGrid caches the promises too; these give synchronous access for hover probes).
// Least-recently-used first. Bounded, so browsing every series doesn't pile ~460 MB onto a phone:
// beyond the budget the oldest series not on screen are dropped (loadGrid's own LRU may still hold them).
const cpuVolumes = new Map<string, Int16Array>()
const CPU_BUDGET_BYTES =
  (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 160 : 320) * 1024 * 1024
let cpuLabels: Uint8Array | null = null
let cpuLesions: Uint8Array | null = null

export function cpuVolume(key: string) { return cpuVolumes.get(key) ?? null }
export function cpuLabelGrid() { return cpuLabels }
export function cpuLesionGrid() { return cpuLesions }

/** Mark a CPU copy as just used (moves it to the young end of the LRU). */
function touchCpu(key: string, data: Int16Array) {
  cpuVolumes.delete(key)
  cpuVolumes.set(key, data)
}

/** Drop the oldest CPU copies beyond the budget, never the ones in `keep`. Returns the dropped keys. */
function trimCpu(keep: Set<string>): string[] {
  let total = 0
  for (const v of cpuVolumes.values()) total += v.byteLength
  const dropped: string[] = []
  for (const [k, v] of cpuVolumes) {
    if (total <= CPU_BUDGET_BYTES) break
    if (keep.has(k)) continue
    cpuVolumes.delete(k)
    total -= v.byteLength
    dropped.push(k)
  }
  return dropped
}

export interface ExamCaliperJSON {
  label: string
  what: string
  series: string
  instance: number
  pointsLPS: Vec3[]
  lengthMM: number
}

const SLAB_CODE: Record<SlabMode, number> = { none: 0, mip: 1, minip: 2, avg: 3 }
const ZOOM_MIN = 0.25
const ZOOM_MAX = 40

type DragMode = 'cross' | 'ruler' | 'wl' | 'pan'
interface Drag {
  mode: DragMode
  slot: number
  x0: number
  y0: number
  t0: number
  moved: boolean
  win0: { c: number; w: number }
  xf0: Xf
  cursor0: Vec3 | null
}
interface Pinch { slot: number; d0: number; m0: [number, number]; xf0: Xf }

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export class SliceController {
  private host: HTMLElement
  private glCanvas: HTMLCanvasElement
  private ovCanvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private renderer: MprRenderer | null = null
  private manifest: Manifest
  private slots: SlotModel[] = []
  private dpr = 1
  private W = 0
  private H = 0
  private raf = 0
  private hoverRaf = 0
  private disposed = false
  private unsubs: (() => void)[] = []
  private ro: ResizeObserver
  /** key -> token of the load in flight (tokens make a stale load's cleanup harmless) */
  private loading = new Map<string, number>()
  private loadSeq = 0
  private labelIds = new Map<string, number>()
  private caliper: Caliper | null = null
  private candidates: CandidateMark[] | null = null

  private pointers = new Map<number, { x: number; y: number }>()
  private drag: Drag | null = null
  private pinch: Pinch | null = null
  private spaceDown = false
  private wheelAcc = 0
  private lastTap = { t: 0, x: 0, y: 0 }
  private pendingHover: { x: number; y: number } | null = null
  /** where a mouse/pen pointer rests over the views, so the readout follows slice changes under it */
  private lastPointer: { x: number; y: number } | null = null
  private hoverLabel = 0
  private hoverLesion = 0
  private cineTimer = 0
  private cineDir = 1
  private rulerSeq = 1

  constructor(host: HTMLElement, manifest: Manifest) {
    this.host = host
    this.manifest = manifest
    for (const c of manifest.labels.classes) this.labelIds.set(c.name, c.id)

    this.glCanvas = document.createElement('canvas')
    this.glCanvas.className = 'slc-gl'
    this.ovCanvas = document.createElement('canvas')
    this.ovCanvas.className = 'slc-ov'
    this.ovCanvas.setAttribute('aria-label', 'CT slice viewports')
    this.ovCanvas.setAttribute('role', 'img')
    this.ovCanvas.dataset.tool = useSlc.getState().tool
    host.prepend(this.ovCanvas)
    host.prepend(this.glCanvas)
    this.ctx = this.ovCanvas.getContext('2d')!

    // GPU state starts empty on every mount; volumes still cached in memory are marked so the picker says so
    const entries: Record<string, { phase: 'cpu'; loaded: number; total: number }> = {}
    for (const k of cpuVolumes.keys()) entries[k] = { phase: 'cpu', loaded: 1, total: 1 }
    useLoad.getState().set({ entries, shown: { main: null, partner: null }, labelsReady: false, lesionsReady: false, glError: null })
    useHover.getState().setHover(null)

    try {
      this.renderer = new MprRenderer(this.glCanvas)
    } catch (e) {
      const msg = e instanceof GLUnavailableError
        ? 'Your browser or device does not support WebGL2, which the slice viewer needs to draw the CT volumes on the GPU.'
        : `Could not start the GPU renderer: ${(e as Error).message ?? e}`
      useLoad.getState().set({ glError: msg })
    }

    this.glCanvas.addEventListener('webglcontextlost', this.onContextLost)
    this.glCanvas.addEventListener('webglcontextrestored', this.onContextRestored)

    const ov = this.ovCanvas
    ov.addEventListener('pointerdown', this.onPointerDown)
    ov.addEventListener('pointermove', this.onPointerMove)
    ov.addEventListener('pointerup', this.onPointerUp)
    ov.addEventListener('pointercancel', this.onPointerUp)
    ov.addEventListener('pointerleave', this.onPointerLeave)
    ov.addEventListener('wheel', this.onWheel, { passive: false })
    ov.addEventListener('dblclick', this.onDblClick)
    ov.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()

    // Re-render whenever anything that affects the picture changes.
    this.unsubs.push(
      useApp.subscribe((s, p) => {
        if (s.sliceSeries !== p.sliceSeries) this.ensureVolumes()
        if (s.cursor !== p.cursor || s.selectedStructure !== p.selectedStructure || s.selectedLesion !== p.selectedLesion || s.sliceSeries !== p.sliceSeries) this.invalidate()
      }),
      useSlc.subscribe((s, p) => {
        if (s.layout !== p.layout || s.partner !== p.partner) this.ensureVolumes()
        if (s.hiddenGroups !== p.hiddenGroups) this.buildLabelLut()
        if (s.cine !== p.cine || s.cineFps !== p.cineFps) this.syncCine()
        if (s.hoverIdentify !== p.hoverIdentify && !s.hoverIdentify) this.hoverLabel = 0
        if (s.tool !== p.tool) this.ovCanvas.dataset.tool = s.tool
        this.invalidate()
      }),
      useLoad.subscribe((s, p) => {
        if (s.shown !== p.shown || s.labelsReady !== p.labelsReady || s.lesionsReady !== p.lesionsReady) this.invalidate()
      }),
    )

    if (document.fonts?.ready) document.fonts.ready.then(() => this.invalidate()).catch(() => {})

    this.ensureVolumes()
    void this.loadOverlays()
    this.syncCine()
    ;(window as unknown as Record<string, unknown>).__slices = this.debugApi()
  }

  // ------------------------------------------------------------------ public API (used by React chrome)
  setReports(calcium: CalciumReport | null, caliper: ExamCaliperJSON | null) {
    const cls = new Map((this.manifest.lesions?.classes ?? []).map((c) => [c.id, c]))
    this.candidates = calcium
      ? calcium.candidates.map((c) => {
          const lc = cls.get(c.id)
          const fc = c.finalClass ?? c.ruleClass
          return {
            id: c.id,
            p: c.centerLPS,
            color: lc?.color ?? '#ffd60a',
            strong: fc !== 'noise' && fc !== 'noise-artifact',
            r: Math.sqrt(Math.max(c.maxArea_mm2, 0.5) / Math.PI),
          }
        })
      : null
    if (caliper && caliper.pointsLPS?.length === 2) {
      const len = caliper.lengthMM ?? dist(caliper.pointsLPS[0], caliper.pointsLPS[1])
      this.caliper = {
        a: caliper.pointsLPS[0], b: caliper.pointsLPS[1], lengthMM: len,
        text: `Radiologist caliper: ${len.toFixed(1)} mm (ascending aorta)`,
        short: `Radiologist: ${len.toFixed(1)} mm`,
      }
    } else this.caliper = null
    this.invalidate()
  }

  /** Step the slice of viewport `i` by `delta` native slices. */
  stepSlice(i: number, delta: number) {
    const sl = this.slots[i]
    if (!sl) return
    const c = this.cursor()
    const n = sliceAt(sl.ax, dot(c, sl.def.scroll))
    this.setSlice(i, n + delta)
  }

  /** Jump viewport `i` to 1-based slice `n` (moves the shared crosshair along that view's normal). */
  setSlice(i: number, n: number) {
    const sl = this.slots[i]
    if (!sl) return
    const nn = clamp(Math.round(n), 1, sl.ax.n)
    const c = this.cursor()
    const u = slicePos(sl.ax, nn)
    useApp.getState().setCursor(madd(c, sl.def.scroll, u - dot(c, sl.def.scroll)))
  }

  resetSlot(i: number) {
    const sl = this.slots[i]
    if (sl) useSlc.getState().resetViews(sl.plane)
  }

  invalidate = () => {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.hoverRaf)
    window.clearInterval(this.cineTimer)
    this.unsubs.forEach((u) => u())
    this.ro.disconnect()
    const ov = this.ovCanvas
    ov.removeEventListener('pointerdown', this.onPointerDown)
    ov.removeEventListener('pointermove', this.onPointerMove)
    ov.removeEventListener('pointerup', this.onPointerUp)
    ov.removeEventListener('pointercancel', this.onPointerUp)
    ov.removeEventListener('pointerleave', this.onPointerLeave)
    ov.removeEventListener('wheel', this.onWheel)
    ov.removeEventListener('dblclick', this.onDblClick)
    ov.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.glCanvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.glCanvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.renderer?.dispose()
    this.renderer = null
    this.glCanvas.remove()
    this.ovCanvas.remove()
    useSlc.getState().set({ draft: null, cine: false })
    useHover.getState().setHover(null)
    const w = window as unknown as Record<string, unknown>
    if (w.__slices) delete w.__slices
  }

  // ------------------------------------------------------------------ data
  private cursor(): Vec3 {
    return useApp.getState().cursor ?? this.manifest.worldCenterLPS
  }

  private neededKeys(): string[] {
    const main = useApp.getState().sliceSeries
    const slc = useSlc.getState()
    return slc.layout === 'compare' && slc.partner !== main ? [main, slc.partner] : [main]
  }

  private ensureVolumes() {
    if (!this.renderer || this.disposed) return
    for (const k of this.neededKeys()) {
      if (!this.renderer.hasVolume(k) && !this.loading.has(k)) void this.loadVolume(k)
    }
    this.refreshShown()
  }

  private async loadVolume(key: string) {
    const r = this.renderer
    const meta = volumeByKey(this.manifest, key)
    if (!r || !meta) return
    const setE = useLoad.getState().setEntry
    const fitErr = r.checkFits(meta)
    if (fitErr) { setE(key, { phase: 'error', loaded: 0, total: 0, error: fitErr }); return }
    const token = ++this.loadSeq
    this.loading.set(key, token)
    try {
      let data = cpuVolumes.get(key)
      if (data) touchCpu(key, data)
      else {
        setE(key, { phase: 'download', loaded: 0, total: meta.bytes })
        let last = 0
        const arr = await loadGrid(meta, (l, t) => {
          const now = performance.now()
          if (now - last > 60 && !this.disposed) { last = now; setE(key, { phase: 'download', loaded: l, total: t }) }
        })
        if (!(arr instanceof Int16Array)) throw new Error(`${key}: expected int16 voxels`)
        touchCpu(key, arr)
        data = arr
        this.trimCpuCache()
      }
      blankSlices(meta, data) // index padding slices once, off the hover path
      if (this.disposed || r !== this.renderer) return
      if (!this.neededKeys().includes(key)) {
        // superseded while downloading: keep the CPU copy, skip the GPU upload
        setE(key, { phase: 'cpu', loaded: 1, total: 1 })
        return
      }
      setE(key, { phase: 'upload', loaded: 0, total: meta.dims[2] })
      await r.uploadVolume(key, meta, data, (d, t) => { if (!this.disposed) setE(key, { phase: 'upload', loaded: d, total: t }) })
      if (this.disposed) return
      setE(key, { phase: 'ready', loaded: 1, total: 1 })
    } catch (e) {
      if (e instanceof UploadCancelled) {
        // context lost or page left mid-upload: the restore path (or nobody) takes over
      } else if (!this.disposed && r === this.renderer) {
        setE(key, { phase: 'error', loaded: 0, total: 0, error: (e as Error)?.message ?? String(e) })
      }
    } finally {
      if (this.loading.get(key) === token) this.loading.delete(key)
      if (!this.disposed) { this.refreshShown(); this.invalidate() }
    }
  }

  /** Retry a failed series. */
  retry(key: string) {
    const { [key]: _drop, ...rest } = useLoad.getState().entries
    useLoad.getState().set({ entries: rest })
    this.ensureVolumes()
  }

  private refreshShown() {
    const r = this.renderer
    if (!r) return
    const main = useApp.getState().sliceSeries
    const slc = useSlc.getState()
    const partner = slc.layout === 'compare' ? slc.partner : null
    const prev = useLoad.getState().shown
    const nMain = r.hasVolume(main) ? main : prev.main && r.hasVolume(prev.main) ? prev.main : null
    const nPartner = partner
      ? r.hasVolume(partner) ? partner : prev.partner && r.hasVolume(prev.partner) ? prev.partner : null
      : null
    if (nMain !== prev.main || nPartner !== prev.partner) useLoad.getState().set({ shown: { main: nMain, partner: nPartner } })
    // GPU budget: only the active volume (+ compare partner), plus whatever is on screen while those load.
    const dropped = r.dropVolumesExcept([main, partner, nMain, nPartner])
    for (const k of dropped) {
      if (cpuVolumes.has(k)) useLoad.getState().setEntry(k, { phase: 'cpu', loaded: 1, total: 1 })
      else this.forgetEntry(k)
    }
  }

  /** Keep the CPU cache within budget; series dropped from it no longer show as "cached". */
  private trimCpuCache() {
    const shown = useLoad.getState().shown
    const keep = new Set<string>(this.neededKeys())
    if (shown.main) keep.add(shown.main)
    if (shown.partner) keep.add(shown.partner)
    for (const k of this.loading.keys()) keep.add(k)
    for (const k of trimCpu(keep)) {
      if (!this.renderer?.hasVolume(k)) this.forgetEntry(k)
    }
  }

  private forgetEntry(key: string) {
    const entries = useLoad.getState().entries
    if (entries[key]?.phase !== 'cpu') return
    const { [key]: _drop, ...rest } = entries
    useLoad.getState().set({ entries: rest })
  }

  private async loadOverlays() {
    const m = this.manifest
    const r = this.renderer
    if (!r) return
    try {
      if (!cpuLabels) cpuLabels = (await loadGrid(m.labels)) as Uint8Array
      if (this.disposed || r !== this.renderer) return
      await r.uploadLabels(m.labels, cpuLabels)
      if (this.disposed) return
      this.buildLabelLut()
      useLoad.getState().set({ labelsReady: true })
      structureIndex(m.labels, cpuLabels).then(() => { if (!this.disposed) useLoad.getState().set({ finderReady: true }) }).catch(() => {})
    } catch (e) {
      if (!this.disposed && !(e instanceof UploadCancelled)) console.warn('[slices] anatomy labels unavailable:', e)
    }
    if (!m.lesions) return
    try {
      if (!cpuLesions) cpuLesions = (await loadGrid(m.lesions)) as Uint8Array
      if (this.disposed || r !== this.renderer) return
      await r.uploadLesions(m.lesions, cpuLesions)
      if (this.disposed) return
      const lut = new Uint8Array(256 * 4)
      for (const c of m.lesions.classes) {
        const [R, G, B] = hexToRgb(c.color)
        lut.set([R, G, B, 255], c.id * 4)
      }
      r.setLesionLut(lut)
      useLoad.getState().set({ lesionsReady: true })
    } catch (e) {
      if (!this.disposed && !(e instanceof UploadCancelled)) console.warn('[slices] calcium candidates unavailable:', e)
    }
  }

  private buildLabelLut() {
    if (!this.renderer) return
    const hidden = new Set(useSlc.getState().hiddenGroups)
    const lut = new Uint8Array(256 * 4)
    for (const c of this.manifest.labels.classes) {
      const [R, G, B] = hexToRgb(c.color)
      lut.set([R, G, B, hidden.has(c.group) ? 0 : 255], c.id * 4)
    }
    this.renderer.setLabelLut(lut)
    this.invalidate()
  }

  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.renderer?.dispose(false)
    useLoad.getState().set({ shown: { main: null, partner: null }, labelsReady: false, lesionsReady: false, entries: {} })
  }

  private onContextRestored = () => {
    if (this.disposed) return
    try {
      this.renderer = new MprRenderer(this.glCanvas)
    } catch (e) {
      useLoad.getState().set({ glError: `The GPU context was lost and could not be restored: ${(e as Error).message}` })
      return
    }
    this.loading.clear()
    this.W = 0 // force the new renderer to (re)apply the drawing-buffer size
    this.resize()
    this.ensureVolumes()
    void this.loadOverlays()
  }

  // ------------------------------------------------------------------ rendering
  private resize() {
    const r = this.host.getBoundingClientRect()
    const W = Math.max(0, Math.floor(r.width))
    const H = Math.max(0, Math.floor(r.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (W === this.W && H === this.H && dpr === this.dpr) return
    this.W = W
    this.H = H
    this.dpr = dpr
    const wd = Math.max(1, Math.round(W * dpr))
    const hd = Math.max(1, Math.round(H * dpr))
    for (const c of [this.glCanvas, this.ovCanvas]) {
      c.style.width = `${W}px`
      c.style.height = `${H}px`
    }
    this.renderer?.resize(wd, hd)
    if (this.ovCanvas.width !== wd) this.ovCanvas.width = wd
    if (this.ovCanvas.height !== hd) this.ovCanvas.height = hd
    useLoad.getState().set({ size: { w: W, h: H } })
    this.slots = modelFromState(this.manifest)
    this.frame()
  }

  private frame = () => {
    this.raf = 0
    if (this.disposed) return
    let slots = modelFromState(this.manifest)
    const pf = useSlc.getState().pendingFocus
    if (pf && slots.length) {
      this.applyFocus(slots, pf)
      slots = modelFromState(this.manifest)
    }
    this.slots = slots
    // the slice under a resting pointer may have changed (keys, cine, scrubber): refresh its readout
    if (this.lastPointer && !this.drag && !this.pinch) this.queueHover(this.lastPointer.x, this.lastPointer.y)
    const r = this.renderer
    if (!r || r.isLost || !slots.length) return
    const slc = useSlc.getState()
    const app = useApp.getState()
    const dpr = this.dpr
    const Hc = Math.max(1, Math.round(this.H * dpr))
    const slab = SLAB_CODE[slc.slab]
    const views: ViewDraw[] = slots.map((sl) => {
      const X0 = Math.round(sl.rect.x * dpr)
      const X1 = Math.round((sl.rect.x + sl.rect.w) * dpr)
      const Yt = Math.round(sl.rect.y * dpr)
      const Yb = Math.round((sl.rect.y + sl.rect.h) * dpr)
      const { right, down, scroll } = sl.def
      const s = sl.s
      const ka = sl.ca - (sl.rect.x + sl.rect.w / 2) * s
      const kb = sl.cb + (Hc / dpr - sl.rect.y - sl.rect.h / 2) * s
      const p0: Vec3 = [
        right[0] * ka + down[0] * kb + scroll[0] * sl.u,
        right[1] * ka + down[1] * kb + scroll[1] * sl.u,
        right[2] * ka + down[2] * kb + scroll[2] * sl.u,
      ]
      let slabN = 1
      let slabStep = 0
      if (slab) {
        const T = slc.slabMM
        slabN = slabSamples(sl.meta, scroll, T)
        slabStep = T / (slabN - 1)
      }
      return {
        x: X0, y: Hc - Yb, w: X1 - X0, h: Yb - Yt, key: sl.key,
        p0, pdx: [right[0] * s / dpr, right[1] * s / dpr, right[2] * s / dpr],
        pdy: [-down[0] * s / dpr, -down[1] * s / dpr, -down[2] * s / dpr],
        normal: scroll,
        winLo: slc.win.c - slc.win.w / 2, winW: slc.win.w,
        slabMode: slab, slabN, slabStep,
        // compare: keep the partner image clean so the difference between the two series is what you see
        labels: !sl.partner,
      }
    })
    const sel = app.selectedStructure ? this.labelIds.get(app.selectedStructure) ?? 0 : 0
    r.draw(views, {
      labMode: slc.labels ? (slc.labelMode === 'fill' ? 1 : 2) : 0,
      labAlpha: slc.labelOpacity,
      sel,
      hov: slc.hoverIdentify ? this.hoverLabel : 0,
      edgePx: Math.max(1, Math.round(dpr)),
      lesOn: slc.lesions,
      calcOn: slc.calcHi,
      calcThr: 130,
    })
    drawOverlay(this.ctx, {
      W: this.W, H: this.H, dpr, slots,
      cursor: this.cursor(),
      rulers: slc.rulers,
      draft: slc.draft,
      caliper: this.caliper,
      candidates: slc.lesions && useLoad.getState().lesionsReady ? this.candidates : null,
      selectedLesion: app.selectedLesion,
      hoverLesion: this.hoverLesion,
    })
  }

  private applyFocus(slots: SlotModel[], pf: { p: Vec3; zoom: number | null; fov?: number; onlyIfHidden: boolean }) {
    const st = useSlc.getState()
    const xf = { ...st.xf }
    const done = new Set<string>()
    for (const sl of slots) {
      if (done.has(sl.plane)) continue
      done.add(sl.plane)
      const a = dot(pf.p, sl.def.right), b = dot(pf.p, sl.def.down)
      const x = sl.rect.w / 2 + (a - sl.ca) / sl.s
      const y = sl.rect.h / 2 + (b - sl.cb) / sl.s
      const inset = Math.min(60, sl.rect.w * 0.12)
      const visible = x > inset && y > inset && x < sl.rect.w - inset && y < sl.rect.h - inset
      if (pf.onlyIfHidden && visible) continue
      const zoom = pf.fov ? clamp((sl.fitS * Math.min(sl.rect.w, sl.rect.h)) / pf.fov, 1, 4) : pf.zoom
      const s = zoom ? sl.fitS / zoom : sl.s
      xf[sl.plane] = { fitted: false, ca: a, cb: b, s }
    }
    st.set({ xf, pendingFocus: null })
  }

  // ------------------------------------------------------------------ interaction helpers
  private local(e: { clientX: number; clientY: number }) {
    const r = this.ovCanvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private resolvedXf(sl: SlotModel): Xf {
    return { fitted: false, ca: sl.ca, cb: sl.cb, s: sl.s }
  }

  private setCursorAt(sl: SlotModel, x: number, y: number) {
    const r = sl.rect
    const p = slotToLps(sl, clamp(x, r.x, r.x + r.w - 1), clamp(y, r.y, r.y + r.h - 1))
    useApp.getState().setCursor(snapToGrid(sl.meta, p))
  }

  private zoomAt(sl: SlotModel, x: number, y: number, f: number) {
    const s = clamp(sl.s / f, sl.fitS / ZOOM_MAX, sl.fitS / ZOOM_MIN)
    const mx = x - sl.rect.x - sl.rect.w / 2
    const my = y - sl.rect.y - sl.rect.h / 2
    const qa = sl.ca + mx * sl.s
    const qb = sl.cb + my * sl.s
    useSlc.getState().setXf(sl.plane, { fitted: false, ca: qa - mx * s, cb: qb - my * s, s })
  }

  /** Zoom the active view by a factor about its centre (toolbar / keyboard). */
  zoomActive(f: number) {
    const i = clamp(useSlc.getState().active, 0, this.slots.length - 1)
    const sl = this.slots[i]
    if (sl) this.zoomAt(sl, sl.rect.x + sl.rect.w / 2, sl.rect.y + sl.rect.h / 2, f)
  }

  private markInteracted() {
    if (!useLoad.getState().interacted) useLoad.getState().set({ interacted: true })
  }

  private probeHU(sl: SlotModel, p: Vec3): number | null {
    const vol = cpuVolumes.get(sl.key)
    if (!vol) return null
    const slc = useSlc.getState()
    return probeHU(sl.meta, vol, p, sl.def.scroll, slc.slab, slc.slabMM)
  }

  private queueHover(x: number, y: number) {
    this.pendingHover = { x, y }
    if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.processHover)
  }

  private processHover = () => {
    this.hoverRaf = 0
    const h = this.pendingHover
    this.pendingHover = null
    if (!h || this.disposed) return
    const sl = slotAt(this.slots, h.x, h.y)
    if (!sl) { this.clearHover(); return }
    const p = slotToLps(sl, h.x, h.y)
    const labels = cpuLabels ? sampleNearest(this.manifest.labels, cpuLabels, p) ?? 0 : 0
    const lesion = cpuLesions && this.manifest.lesions ? sampleNearest(this.manifest.lesions, cpuLesions, p) ?? 0 : 0
    useHover.getState().setHover({ slot: sl.i, p, series: sl.key, hu: this.probeHU(sl, p), label: labels, lesion })
    const hl = useSlc.getState().hoverIdentify ? labels : 0
    if (hl !== this.hoverLabel || lesion !== this.hoverLesion) {
      this.hoverLabel = hl
      this.hoverLesion = lesion
      this.invalidate()
    }
  }

  private clearHover() {
    if (useHover.getState().hover) useHover.getState().setHover(null)
    if (this.hoverLabel || this.hoverLesion) {
      this.hoverLabel = 0
      this.hoverLesion = 0
      this.invalidate()
    }
  }

  // ------------------------------------------------------------------ pointer / touch
  private onPointerDown = (e: PointerEvent) => {
    const { x, y } = this.local(e)
    // clicking the image takes keyboard focus away from e.g. the structure search box
    const ae = document.activeElement as HTMLElement | null
    if (ae && ae !== document.body && isTypingTarget(ae)) ae.blur()
    this.pointers.set(e.pointerId, { x, y })
    try { this.ovCanvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    this.markInteracted()
    if (e.pointerType === 'touch' && this.pointers.size === 2) { this.startPinch(); return }
    if (this.pointers.size > 1) return
    const sl = slotAt(this.slots, x, y)
    if (!sl) return
    const slc = useSlc.getState()
    if (slc.active !== sl.i) slc.set({ active: sl.i })
    let mode: DragMode
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) mode = 'wl'
    else if (e.button === 1 || (e.button === 0 && (this.spaceDown || e.altKey))) mode = 'pan'
    else if (e.button === 0) mode = slc.tool === 'ruler' ? 'ruler' : 'cross'
    else return
    e.preventDefault()
    this.drag = {
      mode, slot: sl.i, x0: x, y0: y, t0: performance.now(), moved: false,
      win0: { c: slc.win.c, w: slc.win.w }, xf0: this.resolvedXf(sl), cursor0: useApp.getState().cursor,
    }
    this.ovCanvas.dataset.drag = mode
    if (mode === 'cross') {
      this.setCursorAt(sl, x, y)
      // clicking right on a calcium candidate selects it app-wide (the Calcium page can follow)
      if (cpuLesions && this.manifest.lesions && useSlc.getState().lesions) {
        const id = sampleNearest(this.manifest.lesions, cpuLesions, slotToLps(sl, x, y)) ?? 0
        if (id > 0 && useApp.getState().selectedLesion !== id) useApp.getState().setSelectedLesion(id)
      }
    }
    if (mode === 'ruler') {
      const p = slotToLps(sl, x, y)
      slc.set({ draft: { id: this.rulerSeq++, plane: sl.plane, u: sl.u, step: sl.ax.step, a: p, b: p, series: sl.key } })
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    const { x, y } = this.local(e)
    if (e.pointerType !== 'touch') this.lastPointer = { x, y }
    const pt = this.pointers.get(e.pointerId)
    if (pt) { pt.x = x; pt.y = y }
    if (this.pinch) { this.updatePinch(); return }
    const d = this.drag
    if (d && pt) {
      const sl = this.slots[d.slot]
      if (!sl) return
      if (Math.hypot(x - d.x0, y - d.y0) > 4) d.moved = true
      const slc = useSlc.getState()
      switch (d.mode) {
        case 'cross':
          this.setCursorAt(sl, x, y)
          break
        case 'ruler': {
          const r = sl.rect
          const p = slotToLps(sl, clamp(x, r.x, r.x + r.w), clamp(y, r.y, r.y + r.h))
          if (slc.draft) slc.set({ draft: { ...slc.draft, b: p } })
          break
        }
        case 'wl': {
          const w = clamp(d.win0.w * Math.exp((x - d.x0) * 0.006), 1, 6000)
          const c = clamp(d.win0.c + (y - d.y0) * d.win0.w * 0.0025, -1400, 3000)
          slc.setWindow(Math.round(c), Math.round(w), null)
          break
        }
        case 'pan':
          slc.setXf(sl.plane, { fitted: false, ca: d.xf0.ca - (x - d.x0) * d.xf0.s, cb: d.xf0.cb - (y - d.y0) * d.xf0.s, s: d.xf0.s })
          break
      }
      if (d.mode !== 'wl' && d.mode !== 'pan') this.queueHover(x, y)
      return
    }
    if (e.pointerType !== 'touch') this.queueHover(x, y)
  }

  private onPointerUp = (e: PointerEvent) => {
    const { x, y } = this.local(e)
    this.pointers.delete(e.pointerId)
    try { this.ovCanvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    // touch has no hover: once the finger lifts, the readout falls back to the crosshair
    if (e.pointerType === 'touch' && this.pointers.size === 0) {
      this.pendingHover = null
      this.clearHover()
    }
    if (this.pinch) {
      if (this.pointers.size < 2) { this.pinch = null; this.drag = null }
      return
    }
    const d = this.drag
    this.drag = null
    delete this.ovCanvas.dataset.drag
    if (!d) return
    if (d.mode === 'ruler') {
      const slc = useSlc.getState()
      const dr = slc.draft
      if (dr && dist(dr.a, dr.b) >= 1) slc.set({ rulers: [...slc.rulers, dr].slice(-24), draft: null })
      else slc.set({ draft: null })
    }
    // double-tap (touch) resets the view, like double-click
    if (e.pointerType === 'touch' && !d.moved && performance.now() - d.t0 < 300) {
      const now = performance.now()
      if (now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30) {
        this.resetSlot(d.slot)
        this.lastTap.t = 0
      } else this.lastTap = { t: now, x, y }
    }
  }

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    this.lastPointer = null
    if (!this.drag && !this.pinch) this.clearHover()
  }

  private startPinch() {
    const pts = [...this.pointers.values()]
    const mx = (pts[0].x + pts[1].x) / 2
    const my = (pts[0].y + pts[1].y) / 2
    const sl = slotAt(this.slots, mx, my) ?? (this.drag ? this.slots[this.drag.slot] : null)
    // undo the single-finger action that started a moment ago
    const d = this.drag
    if (d?.mode === 'cross' && d.cursor0) useApp.getState().setCursor(d.cursor0)
    if (d?.mode === 'ruler') useSlc.getState().set({ draft: null })
    this.drag = null
    if (!sl) return
    this.pinch = { slot: sl.i, d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)), m0: [mx, my], xf0: this.resolvedXf(sl) }
  }

  private updatePinch() {
    const p = this.pinch
    if (!p) return
    const sl = this.slots[p.slot]
    const pts = [...this.pointers.values()]
    if (!sl || pts.length < 2) return
    const d = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
    const mx = (pts[0].x + pts[1].x) / 2
    const my = (pts[0].y + pts[1].y) / 2
    const cx = sl.rect.x + sl.rect.w / 2
    const cy = sl.rect.y + sl.rect.h / 2
    const s = clamp(p.xf0.s * (p.d0 / d), sl.fitS / ZOOM_MAX, sl.fitS / ZOOM_MIN)
    const qa = p.xf0.ca + (p.m0[0] - cx) * p.xf0.s
    const qb = p.xf0.cb + (p.m0[1] - cy) * p.xf0.s
    useSlc.getState().setXf(sl.plane, { fitted: false, ca: qa - (mx - cx) * s, cb: qb - (my - cy) * s, s })
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const { x, y } = this.local(e)
    const sl = slotAt(this.slots, x, y)
    if (!sl) return
    this.markInteracted()
    const slc = useSlc.getState()
    if (slc.active !== sl.i) slc.set({ active: sl.i })
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(sl, x, y, Math.exp(-e.deltaY * unit * 0.0022))
      return
    }
    const dy = (e.deltaY || (e.shiftKey ? e.deltaX : 0)) * unit
    const mult = e.shiftKey ? 5 : 1
    if (!dy) return
    if (Math.abs(dy) >= 50) {
      this.wheelAcc = 0
      this.stepSlice(sl.i, Math.sign(dy) * mult)
    } else {
      this.wheelAcc += dy
      if (Math.abs(this.wheelAcc) >= 28) {
        const steps = Math.trunc(this.wheelAcc / 28)
        this.wheelAcc -= steps * 28
        this.stepSlice(sl.i, steps * mult)
      }
    }
    this.queueHover(x, y)
  }

  private onDblClick = (e: MouseEvent) => {
    const { x, y } = this.local(e)
    const sl = slotAt(this.slots, x, y)
    if (sl) this.resetSlot(sl.i)
  }

  private onContextMenu = (e: Event) => e.preventDefault()

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const slc = useSlc.getState()
    const i = clamp(slc.active, 0, Math.max(0, this.slots.length - 1))
    switch (e.key) {
      case ' ':
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return
        this.spaceDown = true
        this.ovCanvas.dataset.space = '1'
        break
      case 'ArrowUp': this.stepSlice(i, -1); break
      case 'ArrowDown': this.stepSlice(i, 1); break
      case 'PageUp': this.stepSlice(i, -10); break
      case 'PageDown': this.stepSlice(i, 10); break
      case 'Home': this.setSlice(i, 1); break
      case 'End': { const sl = this.slots[i]; if (sl) this.setSlice(i, sl.ax.n); break }
      case '+': case '=': this.zoomActive(1.25); break
      case '-': case '_': this.zoomActive(0.8); break
      case '0': slc.resetViews(); break
      case 'Escape':
        if (slc.draft || slc.tool === 'ruler') slc.set({ draft: null, tool: 'cross' })
        else return
        break
      default: return
    }
    e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') { this.spaceDown = false; delete this.ovCanvas.dataset.space }
  }

  private onBlur = () => {
    this.spaceDown = false
    delete this.ovCanvas.dataset.space
  }

  // ------------------------------------------------------------------ cine
  private syncCine() {
    window.clearInterval(this.cineTimer)
    this.cineTimer = 0
    const { cine, cineFps } = useSlc.getState()
    if (!cine || this.disposed) return
    this.cineTimer = window.setInterval(() => {
      const slc = useSlc.getState()
      const i = clamp(slc.active, 0, Math.max(0, this.slots.length - 1))
      const sl = this.slots[i]
      if (!sl || sl.ax.n < 2) return
      const n = sliceAt(sl.ax, dot(this.cursor(), sl.def.scroll))
      let next = n + this.cineDir
      if (next > sl.ax.n || next < 1) { this.cineDir = -this.cineDir; next = n + this.cineDir }
      this.setSlice(i, next)
    }, 1000 / clamp(cineFps, 1, 60))
  }

  // ------------------------------------------------------------------ debug hook (used by screenshot tests)
  private debugApi() {
    return {
      slots: () => this.slots.map((s) => ({ i: s.i, plane: s.plane, key: s.key, n: s.n, N: s.ax.n, u: s.u, zoom: s.zoom, rect: s.rect })),
      setCursor: (p: Vec3) => useApp.getState().setCursor(p),
      cursor: () => this.cursor(),
      state: () => {
        const { set: _s, setXf: _x, resetViews: _r, setWindow: _w, ...rest } = useSlc.getState()
        return rest
      },
      set: (patch: Record<string, unknown>) => useSlc.getState().set(patch),
      series: (k: string) => useApp.getState().setSliceSeries(k),
      load: () => {
        const { set: _s, setEntry: _e, ...rest } = useLoad.getState()
        return rest
      },
      hover: () => useHover.getState().hover,
      probe: (x: number, y: number) => { this.pendingHover = { x, y }; this.processHover(); return useHover.getState().hover },
      step: (i: number, d: number) => this.stepSlice(i, d),
      gpu: () => ({ volumes: this.renderer?.volumeKeys() ?? [], max3D: this.renderer?.max3D ?? 0 }),
      /** average GPU time of n full redraws (forces a pipeline flush each time) */
      bench: (n = 20) => {
        const gl = this.renderer?.gl
        if (!gl) return null
        const px = new Uint8Array(4)
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        this.frame(); sync()
        const t0 = performance.now()
        for (let i = 0; i < n; i++) { this.frame(); sync() }
        return +((performance.now() - t0) / n).toFixed(2)
      },
      toScreen: (p: Vec3) => this.slots.map((s) => {
        const a = dot(p, s.def.right), b = dot(p, s.def.down)
        return [s.rect.x + s.rect.w / 2 + (a - s.ca) / s.s, s.rect.y + s.rect.h / 2 + (b - s.cb) / s.s]
      }),
    }
  }
}
