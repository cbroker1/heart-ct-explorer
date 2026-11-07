/** Window presets, HU vocabulary and small formatting helpers for the slice explorer. */
import type { VolumeMeta } from '../../lib/data'

export type PresetKey = 'soft' | 'mediastinum' | 'lung' | 'bone' | 'calcium' | 'liver' | 'fat'

export interface WindowPreset {
  key: PresetKey
  label: string
  c: number
  w: number
  hint: string
}

/** Same values as the deep-link contract in WEB_SPEC.md. */
export const PRESETS: WindowPreset[] = [
  { key: 'mediastinum', label: 'Mediastinum', c: 50, w: 350, hint: 'Heart, great vessels and the soft tissue between the lungs.' },
  { key: 'soft', label: 'Soft tissue', c: 40, w: 400, hint: 'General soft-tissue view: muscle, organs, fat and blood.' },
  { key: 'lung', label: 'Lung', c: -600, w: 1500, hint: 'Air-filled lung: vessels, airways and any small nodules.' },
  { key: 'bone', label: 'Bone', c: 500, w: 2000, hint: 'Ribs, spine and sternum. Very dense things stay readable.' },
  { key: 'calcium', label: 'Calcium', c: 200, w: 600, hint: 'Dense, calcified spots pop out. The scanner default for the calcium scan.' },
  { key: 'liver', label: 'Liver', c: 60, w: 160, hint: 'A narrow window that exaggerates small density differences inside organs.' },
  { key: 'fat', label: 'Fat', c: -100, w: 300, hint: 'Separates fat (dark grey) from water-density tissue (light grey).' },
]

export const PRESET_BY_KEY: Record<PresetKey, WindowPreset> = Object.fromEntries(PRESETS.map((p) => [p.key, p])) as Record<PresetKey, WindowPreset>

export function isPresetKey(k: string): k is PresetKey {
  return k in PRESET_BY_KEY
}

/** Preset whose centre/width exactly match, if any. */
export function presetFor(c: number, w: number): PresetKey | null {
  const p = PRESETS.find((q) => q.c === c && q.w === w)
  return p ? p.key : null
}

/** Lung-kernel series look best in a lung window; soft-tissue series in a soft-tissue one. */
export function isLungSeries(v: VolumeMeta): boolean {
  return v.defaultWindow[0] < -300
}

/** Plain-English density class for a Hounsfield value (typical ranges, unenhanced CT). */
export function huTissue(hu: number): string {
  if (hu < -900) return 'air'
  if (hu < -500) return 'aerated lung'
  if (hu < -150) return 'lung edge / mixed'
  if (hu < -30) return 'fat'
  if (hu < 20) return 'water-like fluid'
  if (hu < 100) return 'soft tissue / blood'
  if (hu < 130) return 'dense soft tissue'
  if (hu < 1200) return 'calcium / bone (≥130 HU)'
  if (hu < 2500) return 'dense cortical bone'
  return 'metal-dense'
}

export const fmt1 = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1)).replace('-', '−')
export const fmt0 = (v: number) => Math.round(v).toString().replace('-', '−')

/** Human label for a calcium candidate's final class (calcium.json). */
export function candidateClassLabel(c: string): string {
  switch (c) {
    case 'noise': return 'likely noise'
    case 'review': return 'needs review'
    case 'coronary': return 'coronary calcium'
    case 'aortic': return 'aortic calcium'
    case 'valvular': return 'valve calcium'
    case 'noise-artifact': return 'noise / artifact'
    case 'bone': return 'bone'
    default: return c
  }
}

/** The most instructive series to compare a given series with. */
export const DEFAULT_PARTNER: Record<string, string> = {
  thin_lung: 'cr_vessel_suppress',
  cr_vessel_suppress: 'thin_lung',
  axial_st: 'axial_lung',
  axial_lung: 'axial_st',
  calcium: 'axial_st',
  axial_lung_mip: 'axial_lung',
  cor_st: 'axial_st',
  sag_st: 'axial_st',
}
