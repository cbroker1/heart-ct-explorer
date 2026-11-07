/**
 * CPU-side probes shared by the hover readout (controller), the crosshair readout (status bar) and the
 * renderer: slab-aware HU sampling, and blank "padding" slices (a slice the scanner filled with a single
 * value everywhere, i.e. no image data at all, like the top slice of the 3 mm chest series).
 */
import type { GridMeta, Vec3, VolumeMeta } from '../../lib/data'
import { dirCol } from '../../lib/coords'
import { clamp, dot, madd, nearest, slotToLps, toIndex, type SlotModel } from './geom'
import type { SlabMode } from './state'

/** Grid spacing along a direction (for slab sampling density). */
export function normalSpacing(meta: GridMeta, n: Vec3): number {
  let best = 0
  let bestDot = 0
  for (let a = 0; a < 3; a++) {
    const d = Math.abs(dot(dirCol(meta.direction, a), n))
    if (d > bestDot) { bestDot = d; best = a }
  }
  return meta.spacing[best]
}

/** Samples taken through a slab of `mm` along `n` (the GL frame uses the same count). */
export function slabSamples(meta: GridMeta, n: Vec3, mm: number): number {
  return clamp(Math.ceil(mm / Math.max(0.25, normalSpacing(meta, n))) + 1, 2, 160)
}

// ------------------------------------------------------------------ blank (padding) slices
const blankCache = new WeakMap<Int16Array, Uint8Array | null>()

/**
 * Flags (one per k index) for slices holding a single value everywhere. Only axial stacks are checked:
 * an axial plane through the chest is never uniform for real, whereas an edge slice of the coronal or
 * sagittal reformats can simply be air outside the body. Cached per array; ~10 ms for the biggest series.
 */
export function blankSlices(meta: GridMeta, vol: Int16Array): Uint8Array | null {
  const hit = blankCache.get(vol)
  if (hit !== undefined) return hit
  let out: Uint8Array | null = null
  if (Math.abs(dirCol(meta.direction, 2)[2]) > 0.999) {
    const [nx, ny, nz] = meta.dims
    const plane = nx * ny
    for (let k = 0; k < nz; k++) {
      const o = k * plane
      const v0 = vol[o]
      let i = 1
      while (i < plane && vol[o + i] === v0) i++
      if (i === plane) (out ??= new Uint8Array(nz))[k] = 1
    }
  }
  blankCache.set(vol, out)
  return out
}

/** The k range [lo, hi] left after trimming blank slices off both ends of the stack. */
export function dataKRange(meta: GridMeta, vol: Int16Array): [number, number] {
  const nz = meta.dims[2]
  const b = blankSlices(meta, vol)
  if (!b) return [0, nz - 1]
  let lo = 0
  let hi = nz - 1
  while (lo < hi && b[lo]) lo++
  while (hi > lo && b[hi]) hi--
  return b[lo] ? [0, nz - 1] : [lo, hi]
}

/** True when the voxel nearest to p sits on a blank slice of this series. */
export function onBlankSlice(meta: GridMeta, vol: Int16Array | null, p: Vec3): boolean {
  const b = vol ? blankSlices(meta, vol) : null
  if (!b) return false
  const k = Math.round(toIndex(meta, p)[2])
  return k >= 0 && k < b.length && b[k] === 1
}

/** True when a view shows exactly one of those blank slices (its plane is the series' own slice plane). */
export function viewOnBlankSlice(sl: SlotModel, vol: Int16Array | null): boolean {
  if (!vol || Math.abs(dot(dirCol(sl.meta.direction, 2), sl.def.scroll)) < 0.999) return false
  return onBlankSlice(sl.meta, vol, slotToLps(sl, sl.rect.x + sl.rect.w / 2, sl.rect.y + sl.rect.h / 2))
}

// ------------------------------------------------------------------ HU probe
/**
 * HU at p as the views draw it: the nearest voxel, or the MIP / MinIP / mean through the slab along n.
 * Blank slices count as "no data" (they are skipped, like the renderer does). Null outside the grid.
 */
export function probeHU(meta: VolumeMeta, vol: Int16Array, p: Vec3, n: Vec3, slab: SlabMode, slabMM: number): number | null {
  if (slab === 'none') return onBlankSlice(meta, vol, p) ? null : nearest(meta, vol, p)
  const cnt = slabSamples(meta, n, slabMM)
  let acc = slab === 'mip' ? -Infinity : slab === 'minip' ? Infinity : 0
  let used = 0
  for (let s = 0; s < cnt; s++) {
    const q = madd(p, n, (s - (cnt - 1) / 2) * (slabMM / (cnt - 1)))
    if (onBlankSlice(meta, vol, q)) continue
    const v = nearest(meta, vol, q)
    if (v === null) continue
    used++
    if (slab === 'mip') acc = Math.max(acc, v)
    else if (slab === 'minip') acc = Math.min(acc, v)
    else acc += v
  }
  if (!used) return null
  return slab === 'avg' ? acc / used : acc
}
