/**
 * View geometry for the slice explorer.
 *
 * Every view is a plane in patient LPS space. A view has an in-plane frame (`right`, `down`: LPS unit
 * vectors for screen +x / +y), a scroll direction (the way "next slice" moves) and a 2D transform
 * (centre `ca`,`cb` in mm along right/down, scale `s` in mm per CSS pixel). Pixels map to LPS as
 *     p = right·(ca + (x − cx)·s) + down·(cb + (y − cy)·s) + scroll·u
 * where u is the slice position along `scroll`. Every grid (volume, labels, lesions) is then sampled
 * by patient position through its own inverse affine, so overlays from other grids line up exactly.
 */
import type { GridMeta, Manifest, Vec3, VolumeMeta } from '../../lib/data'
import { dirCol, indexToLps } from '../../lib/coords'

export type Plane = 'axial' | 'coronal' | 'sagittal'
export const PLANE_ORDER: Plane[] = ['axial', 'coronal', 'sagittal']

export interface PlaneDef {
  key: Plane
  label: string
  short: string
  right: Vec3
  down: Vec3
  scroll: Vec3
  /** Orientation letters at the screen's left, right, top and bottom edges. */
  letters: [string, string, string, string]
  /** LPS axis of the plane normal and its readout letter. */
  axis: 0 | 1 | 2
  axisLetter: 'L' | 'P' | 'S'
  scrollHint: string
}

// Radiological conventions (WEB_SPEC): axial = patient Right on screen left, anterior up;
// coronal = Right on screen left, superior up; sagittal = anterior on screen left, superior up.
export const PLANES: Record<Plane, PlaneDef> = {
  axial: {
    key: 'axial', label: 'Axial', short: 'Ax',
    right: [1, 0, 0], down: [0, 1, 0], scroll: [0, 0, -1],
    letters: ['R', 'L', 'A', 'P'], axis: 2, axisLetter: 'S', scrollHint: 'head → feet',
  },
  coronal: {
    key: 'coronal', label: 'Coronal', short: 'Cor',
    right: [1, 0, 0], down: [0, 0, -1], scroll: [0, 1, 0],
    letters: ['R', 'L', 'S', 'I'], axis: 1, axisLetter: 'P', scrollHint: 'front → back',
  },
  sagittal: {
    key: 'sagittal', label: 'Sagittal', short: 'Sag',
    right: [0, 1, 0], down: [0, 0, -1], scroll: [1, 0, 0],
    letters: ['A', 'P', 'S', 'I'], axis: 0, axisLetter: 'L', scrollHint: 'right → left',
  },
}

// ------------------------------------------------------------------ small vector helpers
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ------------------------------------------------------------------ slices
export interface SliceAxis {
  /** Number of native slices along the scroll direction. */
  n: number
  /** Distance between slices (mm, > 0). */
  step: number
  /** Position (dot(p, scroll)) of slice #1. */
  first: number
  aligned: boolean
}

/** The grid's native slice stack along a scroll direction (general direction matrices supported). */
export function sliceAxis(g: GridMeta, scroll: Vec3): SliceAxis {
  let best = 0
  let bestDot = 0
  for (let a = 0; a < 3; a++) {
    const d = dot(dirCol(g.direction, a), scroll)
    if (Math.abs(d) > Math.abs(bestDot)) { best = a; bestDot = d }
  }
  if (Math.abs(bestDot) > 0.999) {
    const c = g.spacing[best] * Math.sign(bestDot)
    const o = dot(g.origin, scroll)
    const n = g.dims[best]
    return { n, step: Math.abs(c), first: c > 0 ? o : o + (n - 1) * c, aligned: true }
  }
  // Oblique grid: step by the finest spacing across the projected extent.
  let lo = Infinity
  let hi = -Infinity
  for (const p of gridCorners(g, 0)) { const u = dot(p, scroll); lo = Math.min(lo, u); hi = Math.max(hi, u) }
  const step = Math.min(...g.spacing)
  return { n: Math.max(1, Math.floor((hi - lo) / step) + 1), step, first: lo, aligned: false }
}

/** 1-based slice number nearest to position u. */
export function sliceAt(ax: SliceAxis, u: number): number {
  return clamp(Math.round((u - ax.first) / ax.step) + 1, 1, ax.n)
}

export function slicePos(ax: SliceAxis, n: number): number {
  return ax.first + (n - 1) * ax.step
}

/** Grid corners in LPS. pad = 0.5 gives the outer voxel edges, 0 the outer voxel centres. */
export function gridCorners(g: GridMeta, pad = 0.5): Vec3[] {
  const out: Vec3[] = []
  for (const i of [-pad, g.dims[0] - 1 + pad])
    for (const j of [-pad, g.dims[1] - 1 + pad])
      for (const k of [-pad, g.dims[2] - 1 + pad]) out.push(indexToLps(g, [i, j, k]))
  return out
}

/** LPS -> continuous index as a column-major mat4 for GLSL. Voxel centres sit at integer indices. */
export function invAffine(g: GridMeta): Float32Array {
  const d = g.direction
  const s = g.spacing
  const o = g.origin
  const m = new Float32Array(16)
  for (let a = 0; a < 3; a++) {
    let t = 0
    for (let r = 0; r < 3; r++) {
      const v = d[r * 3 + a] / s[a]
      m[r * 4 + a] = v
      t -= v * o[r]
    }
    m[12 + a] = t
  }
  m[15] = 1
  return m
}

/** Continuous voxel index of an LPS point (same maths as coords.lpsToIndex, kept local for speed). */
export function toIndex(g: GridMeta, p: Vec3): Vec3 {
  const d = g.direction, s = g.spacing, o = g.origin
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2]
  return [
    (d[0] * x + d[3] * y + d[6] * z) / s[0],
    (d[1] * x + d[4] * y + d[7] * z) / s[1],
    (d[2] * x + d[5] * y + d[8] * z) / s[2],
  ]
}

/** Nearest voxel value, or null outside the grid. */
export function nearest(g: GridMeta, data: ArrayLike<number>, p: Vec3): number | null {
  const f = toIndex(g, p)
  const i = Math.round(f[0]), j = Math.round(f[1]), k = Math.round(f[2])
  if (i < 0 || j < 0 || k < 0 || i >= g.dims[0] || j >= g.dims[1] || k >= g.dims[2]) return null
  return data[i + g.dims[0] * (j + g.dims[1] * k)]
}

/** Snap each coordinate whose LPS axis is a grid axis to the nearest voxel centre (keeps slices "native"). */
export function snapToGrid(g: GridMeta, p: Vec3): Vec3 {
  const out: Vec3 = [p[0], p[1], p[2]]
  for (let a = 0; a < 3; a++) {
    const col = dirCol(g.direction, a)
    const ax = col.findIndex((v) => Math.abs(v) > 0.999)
    if (ax < 0) continue
    const t = (p[ax] - g.origin[ax]) / (g.spacing[a] * col[ax])
    const k = clamp(Math.round(t), 0, g.dims[a] - 1)
    out[ax] = g.origin[ax] + k * g.spacing[a] * col[ax]
  }
  return out
}

// ------------------------------------------------------------------ layout
export type Layout = '3up' | 'single' | 'compare'

export interface Rect { x: number; y: number; w: number; h: number }

const GAP = 2

export function isLandscape(W: number, H: number) {
  return W >= H * 1.05
}

/** Viewport rectangles (CSS px inside the views area) for a layout. */
export function layoutRects(layout: Layout, W: number, H: number): Rect[] {
  if (layout === 'single') return [{ x: 0, y: 0, w: W, h: H }]
  const land = isLandscape(W, H)
  if (layout === 'compare') {
    if (land) {
      const w1 = Math.floor((W - GAP) / 2)
      return [{ x: 0, y: 0, w: w1, h: H }, { x: w1 + GAP, y: 0, w: W - w1 - GAP, h: H }]
    }
    const h1 = Math.floor((H - GAP) / 2)
    return [{ x: 0, y: 0, w: W, h: h1 }, { x: 0, y: h1 + GAP, w: W, h: H - h1 - GAP }]
  }
  if (land) {
    const bw = Math.round(W * 0.6)
    const rw = W - bw - GAP
    const h1 = Math.floor((H - GAP) / 2)
    return [
      { x: 0, y: 0, w: bw, h: H },
      { x: bw + GAP, y: 0, w: rw, h: h1 },
      { x: bw + GAP, y: h1 + GAP, w: rw, h: H - h1 - GAP },
    ]
  }
  const bh = Math.round(H * 0.58)
  const w1 = Math.floor((W - GAP) / 2)
  return [
    { x: 0, y: 0, w: W, h: bh },
    { x: 0, y: bh + GAP, w: w1, h: H - bh - GAP },
    { x: w1 + GAP, y: bh + GAP, w: W - w1 - GAP, h: H - bh - GAP },
  ]
}

/** Which plane goes in which slot. */
export function slotPlanes(layout: Layout, main: Plane): Plane[] {
  if (layout === 'single') return [main]
  if (layout === 'compare') return [main, main]
  return [main, ...PLANE_ORDER.filter((p) => p !== main)]
}

// ------------------------------------------------------------------ view model
export interface Xf { fitted: boolean; ca: number; cb: number; s: number }

export interface SlotModel {
  i: number
  plane: Plane
  def: PlaneDef
  key: string
  meta: VolumeMeta
  rect: Rect
  ax: SliceAxis
  /** current 1-based slice number and its position along `scroll` (mm) */
  n: number
  u: number
  ca: number
  cb: number
  s: number
  fitS: number
  zoom: number
  /** true for the compare partner */
  partner: boolean
}

export interface ModelInput {
  manifest: Manifest
  layout: Layout
  plane: Plane
  mainKey: string
  partnerKey: string
  W: number
  H: number
  xf: Record<Plane, Xf>
  cursor: Vec3
}

/** Fit transform: the whole grid visible, centred, with a small margin. */
export function fitXf(g: GridMeta, def: PlaneDef, r: Rect): { ca: number; cb: number; s: number } {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
  for (const p of gridCorners(g)) {
    const a = dot(p, def.right), b = dot(p, def.down)
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b)
  }
  const s = Math.max((a1 - a0) / Math.max(1, r.w - 16), (b1 - b0) / Math.max(1, r.h - 16)) * 1.04
  return { ca: (a0 + a1) / 2, cb: (b0 + b1) / 2, s: Math.max(s, 1e-3) }
}

export function volumeByKey(m: Manifest, key: string): VolumeMeta | undefined {
  return m.volumes.find((v) => v.key === key)
}

export function buildSlots(inp: ModelInput): SlotModel[] {
  const { manifest, layout, plane, W, H, xf, cursor } = inp
  if (W < 4 || H < 4) return []
  const main = volumeByKey(manifest, inp.mainKey)
  if (!main) return []
  const partner = volumeByKey(manifest, inp.partnerKey) ?? main
  const rects = layoutRects(layout, W, H)
  const planes = slotPlanes(layout, plane)
  return rects.map((rect, i) => {
    const pl = planes[i]
    const def = PLANES[pl]
    const isPartner = layout === 'compare' && i === 1
    const meta = isPartner ? partner : main
    const ax = sliceAxis(meta, def.scroll)
    const n = sliceAt(ax, dot(cursor, def.scroll))
    const u = slicePos(ax, n)
    // compare views share one transform, fitted to the main series so they stay in lockstep
    const fit = fitXf(main, def, rect)
    const x = xf[pl]
    const t = x.fitted ? fit : x
    return {
      i, plane: pl, def, key: meta.key, meta, rect, ax, n, u,
      ca: t.ca, cb: t.cb, s: t.s, fitS: fit.s, zoom: fit.s / t.s, partner: isPartner,
    }
  })
}

/** CSS px (views-area coordinates) -> LPS on the slot's displayed plane. */
export function slotToLps(sl: SlotModel, x: number, y: number): Vec3 {
  const a = sl.ca + (x - sl.rect.x - sl.rect.w / 2) * sl.s
  const b = sl.cb + (y - sl.rect.y - sl.rect.h / 2) * sl.s
  const { right, down, scroll } = sl.def
  return [
    right[0] * a + down[0] * b + scroll[0] * sl.u,
    right[1] * a + down[1] * b + scroll[1] * sl.u,
    right[2] * a + down[2] * b + scroll[2] * sl.u,
  ]
}

/** LPS -> CSS px (views-area coordinates) on a slot. */
export function lpsToSlot(sl: SlotModel, p: Vec3): [number, number] {
  return [
    sl.rect.x + sl.rect.w / 2 + (dot(p, sl.def.right) - sl.ca) / sl.s,
    sl.rect.y + sl.rect.h / 2 + (dot(p, sl.def.down) - sl.cb) / sl.s,
  ]
}

export function slotAt(slots: SlotModel[], x: number, y: number): SlotModel | null {
  for (const s of slots) {
    const r = s.rect
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return s
  }
  return null
}

/** A pleasant scale-bar length (mm) for a given mm-per-pixel. */
export function niceScale(s: number, targetPx = 80): number {
  const raw = s * targetPx
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200]
  let best = steps[0]
  for (const v of steps) if (Math.abs(v / s - targetPx) < Math.abs(best / s - targetPx)) best = v
  return raw > 0 ? best : 10
}
