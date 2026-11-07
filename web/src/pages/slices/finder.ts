/**
 * Structure finder: one scan over the anatomy label grid (in idle-friendly chunks) gives every class its
 * voxel count, centroid and a guaranteed-inside "anchor" voxel (the class voxel closest to the centroid;
 * a curved structure like a rib or a lung has its centroid outside itself). Cached for the session.
 */
import type { LabelGridMeta, Vec3 } from '../../lib/data'
import { indexToLps } from '../../lib/coords'

export interface StructureInfo {
  id: number
  voxels: number
  centroid: Vec3
  /** LPS of a voxel well inside the class, nearest to the centroid */
  anchor: Vec3
}

let cache: Promise<Map<number, StructureInfo>> | null = null

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0))

export function structureIndex(meta: LabelGridMeta, data: Uint8Array): Promise<Map<number, StructureInfo>> {
  if (!cache) {
    cache = build(meta, data)
    cache.catch(() => { cache = null })
  }
  return cache
}

async function build(meta: LabelGridMeta, data: Uint8Array): Promise<Map<number, StructureInfo>> {
  const [nx, ny, nz] = meta.dims
  const [sx, sy, sz] = meta.spacing
  const cnt = new Float64Array(256)
  const si = new Float64Array(256)
  const sj = new Float64Array(256)
  const sk = new Float64Array(256)
  const plane = nx * ny
  const CH = 12
  for (let k0 = 0; k0 < nz; k0 += CH) {
    const k1 = Math.min(nz, k0 + CH)
    for (let k = k0; k < k1; k++) {
      let idx = k * plane
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++, idx++) {
          const c = data[idx]
          if (c) { cnt[c]++; si[c] += i; sj[c] += j; sk[c] += k }
        }
      }
    }
    await yieldToUI()
  }
  const ci = new Float64Array(256), cj = new Float64Array(256), ck = new Float64Array(256)
  for (let c = 1; c < 256; c++) if (cnt[c]) { ci[c] = si[c] / cnt[c]; cj[c] = sj[c] / cnt[c]; ck[c] = sk[c] / cnt[c] }

  // Second pass: the class voxel nearest to each centroid, preferring the deepest available level of
  // "inside-ness" (at least D voxels of the same class on all six sides), so the crosshair lands well inside
  // the structure (mid-lumen for the aorta, mid-lobe for a lung) instead of on its edge.
  const LEVELS = [3, 5, 8, 12]
  const NL = LEVELS.length
  const best = new Float64Array(256 * (NL + 1)).fill(Infinity) // slot 0 = any voxel, 1..NL = depth levels
  const bi = new Int32Array(256 * (NL + 1)), bj = new Int32Array(256 * (NL + 1)), bk = new Int32Array(256 * (NL + 1))
  for (let k0 = 0; k0 < nz; k0 += CH) {
    const k1 = Math.min(nz, k0 + CH)
    for (let k = k0; k < k1; k++) {
      let idx = k * plane
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++, idx++) {
          const c = data[idx]
          if (!c) continue
          const dx = (i - ci[c]) * sx, dy = (j - cj[c]) * sy, dz = (k - ck[c]) * sz
          const d2 = dx * dx + dy * dy + dz * dz
          const base = c * (NL + 1)
          if (d2 < best[base]) { best[base] = d2; bi[base] = i; bj[base] = j; bk[base] = k }
          for (let l = 0; l < NL; l++) {
            const D = LEVELS[l]
            if (i < D || j < D || k < D || i >= nx - D || j >= ny - D || k >= nz - D) break
            if (data[idx - D] !== c || data[idx + D] !== c || data[idx - D * nx] !== c || data[idx + D * nx] !== c ||
              data[idx - D * plane] !== c || data[idx + D * plane] !== c) break
            const s2 = base + 1 + l
            if (d2 < best[s2]) { best[s2] = d2; bi[s2] = i; bj[s2] = j; bk[s2] = k }
          }
        }
      }
    }
    await yieldToUI()
  }
  const anchorOf = (c: number): Vec3 => {
    const base = c * (NL + 1)
    for (let l = NL; l >= 0; l--) {
      const s2 = base + l
      if (best[s2] < Infinity) return indexToLps(meta, [bi[s2], bj[s2], bk[s2]])
    }
    return indexToLps(meta, [ci[c], cj[c], ck[c]])
  }
  const out = new Map<number, StructureInfo>()
  for (let c = 1; c < 256; c++) {
    if (!cnt[c]) continue
    out.set(c, {
      id: c,
      voxels: cnt[c],
      centroid: indexToLps(meta, [ci[c], cj[c], ck[c]]),
      anchor: anchorOf(c),
    })
  }
  return out
}
