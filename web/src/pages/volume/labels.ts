/**
 * Display-side clean-up of the AI label grid used by the volume renderer.
 *
 * The regenerated labels split the central pulmonary artery / left atrium / pulmonary veins out of the
 * lung-vessel labels, but leave a 1-voxel rim of `lung_veins` (and some `lung_arteries`) wrapped around
 * the left atrium, the pericardium and the great vessels. Gated or drawn as a vessel, that rim outlines the
 * left atrium as a rounded "mass" at the hilum (Lungs & airways) or a hollow shell (Anatomy colours).
 * A lung-vessel voxel that touches (6-neighbourhood) one of those heart structures is handed to that
 * structure. One pass only: real vessels are left alone, they just lose that single boundary voxel.
 * Classes are matched by NAME (never by id), and the input array is not modified: the decoded grid is
 * shared with other pages through loadGrid's cache.
 */
import type { LabelClass } from '../../lib/data'

const HEART_SIDE = [
  'heart_atrium_left', 'heart_atrium_right', 'heart_ventricle_left', 'heart_ventricle_right', 'heart_myocardium',
  'atrial_appendage_left', 'pericardium', 'aorta', 'superior_vena_cava', 'inferior_vena_cava',
]
/** lung-vessel label -> the central vessel of the OTHER circulation, which it must not touch either */
const RIMS: [string, string][] = [['lung_veins', 'pulmonary_artery'], ['lung_arteries', 'pulmonary_vein']]

export function cleanVesselRims(dims: [number, number, number], labels: Uint8Array, classes: LabelClass[]): { data: Uint8Array; changed: number } {
  const id = new Map(classes.map((c) => [c.name, c.id]))
  // anchor[vesselId][otherId] = 1 when a vessel voxel next to `otherId` is a rim voxel
  const anchors = new Map<number, Uint8Array>()
  for (const [vessel, other] of RIMS) {
    const v = id.get(vessel)
    if (v === undefined) continue
    const a = new Uint8Array(256)
    for (const n of [...HEART_SIDE, other]) { const k = id.get(n); if (k !== undefined) a[k] = 1 }
    anchors.set(v, a)
  }
  if (!anchors.size) return { data: labels, changed: 0 }
  const [nx, ny, nz] = dims
  const sxy = nx * ny
  const isVessel = new Uint8Array(256)
  for (const k of anchors.keys()) isVessel[k] = 1
  const out = labels.slice()
  let changed = 0
  const nb = [1, -1, nx, -nx, sxy, -sxy]
  const counts = new Uint8Array(256)
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      const row = k * sxy + j * nx
      for (let i = 1; i < nx - 1; i++) {
        const p = row + i
        const lab = labels[p]
        if (!isVessel[lab]) continue
        const a = anchors.get(lab)!
        // most frequent anchor among the 6 neighbours (read from the ORIGINAL grid: no cascading)
        let best = 0, bestN = 0
        for (const d of nb) {
          const q = labels[p + d]
          if (!a[q]) continue
          const c = ++counts[q]
          if (c > bestN) { best = q; bestN = c }
        }
        if (!bestN) continue
        for (const d of nb) counts[labels[p + d]] = 0
        out[p] = best
        changed++
      }
    }
  }
  return { data: out, changed }
}
