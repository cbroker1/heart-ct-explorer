/** Cross-page actions: jump from a 3D point to the slice explorer. */
import type { Manifest, Vec3 } from '../../lib/data'
import { insideGrid, worldToLps } from '../../lib/coords'
import { useApp } from '../../lib/store'
import { navigate } from '../../components/ui'

/** Pick the best series + window to look at a point of a given anatomy group. */
export function seriesFor(manifest: Manifest, group: string | null, lps: Vec3): { series?: string; window?: string } {
  const vol = (k: string) => manifest.volumes.find((v) => v.key === k)
  const ok = (k: string) => {
    const v = vol(k)
    return v && insideGrid(v, lps) ? k : undefined
  }
  if (group === 'lungs' || group === 'airways-lung') return { series: ok('axial_lung') ?? ok('thin_lung'), window: 'lung' }
  if (group === 'bones') return { series: ok('axial_st') ?? ok('thin_lung'), window: 'bone' }
  if (group === 'calcium') return { series: ok('calcium') ?? ok('axial_st'), window: 'calcium' }
  if (group === 'heart' || group === 'vessels') return { series: ok('calcium') ?? ok('axial_st'), window: 'soft' }
  return { series: ok('axial_st') ?? ok('thin_lung'), window: 'soft' }
}

/** Set the shared cursor to a world point and open the slice explorer there (axial). */
export function showInSlices(manifest: Manifest, world: Vec3, group: string | null) {
  const lps = worldToLps(world, manifest.worldCenterLPS)
  useApp.getState().setCursor(lps)
  const { series, window } = seriesFor(manifest, group, lps)
  const q = [
    series ? `series=${series}` : '',
    `lps=${lps.map((v) => v.toFixed(1)).join(',')}`,
    'plane=axial',
    window ? `window=${window}` : '',
  ].filter(Boolean).join('&')
  navigate(`/slices?${q}`)
}

/** The group to use for series choice: airways that live inside the lungs read best in the lung window. */
export function sliceGroupFor(name: string, group: string): string {
  if (name === 'lung_airways' || name === 'trachea' || name === 'lung_arteries' || name === 'lung_veins') return 'airways-lung'
  return group
}
