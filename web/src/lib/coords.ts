/**
 * Coordinate helpers.
 *
 * Patient space: DICOM LPS millimetres (+x = patient Left, +y = Posterior, +z = Superior).
 * three.js world: millimetres, centred on manifest.worldCenterLPS, oriented so the patient
 * stands upright facing the default camera:
 *     world.x = +L,   world.y = +S,   world.z = +A  (= -P)
 * i.e.  world = M · (lps - center),  M = [[1,0,0],[0,0,1],[0,-1,0]]   (a proper rotation)
 * Looking from +z toward the origin you see the patient from the front, with the patient's
 * left on screen right (same as an AP radiograph / coronal CT convention).
 */
import type { GridMeta, Vec3 } from './data'

export function lpsToWorld(p: Vec3, center: Vec3): Vec3 {
  const x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2]
  return [x, z, -y]
}

export function worldToLps(w: Vec3, center: Vec3): Vec3 {
  return [w[0] + center[0], -w[2] + center[1], w[1] + center[2]]
}

/** Column `c` (0..2) of the row-major direction matrix. */
export function dirCol(dir: number[], c: number): Vec3 {
  return [dir[c], dir[3 + c], dir[6 + c]]
}

/** Continuous voxel index (i,j,k) -> LPS mm. */
export function indexToLps(g: GridMeta, ijk: Vec3): Vec3 {
  const d = g.direction, s = g.spacing, o = g.origin
  const a = ijk[0] * s[0], b = ijk[1] * s[1], c = ijk[2] * s[2]
  return [
    o[0] + d[0] * a + d[1] * b + d[2] * c,
    o[1] + d[3] * a + d[4] * b + d[5] * c,
    o[2] + d[6] * a + d[7] * b + d[8] * c,
  ]
}

/** LPS mm -> continuous voxel index (direction is orthonormal, so inverse = transpose). */
export function lpsToIndex(g: GridMeta, p: Vec3): Vec3 {
  const d = g.direction, s = g.spacing, o = g.origin
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2]
  return [
    (d[0] * x + d[3] * y + d[6] * z) / s[0],
    (d[1] * x + d[4] * y + d[7] * z) / s[1],
    (d[2] * x + d[5] * y + d[8] * z) / s[2],
  ]
}

/** Axis-aligned LPS bounding box of a grid (voxel centres). */
export function gridBoundsLps(g: GridMeta): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const i of [0, g.dims[0] - 1]) for (const j of [0, g.dims[1] - 1]) for (const k of [0, g.dims[2] - 1]) {
    const p = indexToLps(g, [i, j, k])
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]) }
  }
  return { min, max }
}

export function insideGrid(g: GridMeta, p: Vec3): boolean {
  const ijk = lpsToIndex(g, p)
  return ijk.every((v, a) => v >= -0.5 && v <= g.dims[a] - 0.5)
}

/** Nearest-voxel value lookup (returns null outside the grid). */
export function sampleNearest(g: GridMeta, data: ArrayLike<number>, p: Vec3): number | null {
  const ijk = lpsToIndex(g, p).map(Math.round) as Vec3
  if (ijk.some((v, a) => v < 0 || v >= g.dims[a])) return null
  return data[ijk[0] + g.dims[0] * (ijk[1] + g.dims[1] * ijk[2])]
}

export const fmtMM = (v: number) => `${v.toFixed(1)} mm`
export const fmtLps = (p: Vec3) => `L ${p[0].toFixed(1)}  P ${p[1].toFixed(1)}  S ${p[2].toFixed(1)}`
