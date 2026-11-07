/**
 * Deep links: #/slices?series=<key>&lps=<x>,<y>,<z>&plane=<axial|coronal|sagittal>&window=<preset | c,w>
 * (all optional). Applied on mount and on every hashchange while the page is open.
 */
import type { Manifest, Vec3 } from '../../lib/data'
import { useApp } from '../../lib/store'
import type { Plane } from './geom'
import { isLungSeries, isPresetKey, PRESET_BY_KEY, presetFor, type PresetKey } from './presets'
import { useSlc } from './state'

export interface DeepLink {
  series?: string
  lps?: Vec3
  plane?: Plane
  window?: { c: number; w: number; preset: PresetKey | null }
  layout?: 'single' | '3up' | 'compare'
}

export function parseDeepLink(hash: string, m: Manifest): DeepLink | null {
  const h = hash.replace(/^#/, '')
  const [path, qs] = h.split('?')
  if (path !== '/slices' || !qs) return null
  const q = new URLSearchParams(qs)
  const out: DeepLink = {}
  const series = q.get('series')
  if (series && m.volumes.some((v) => v.key === series)) out.series = series
  const lps = q.get('lps')
  if (lps) {
    const v = lps.split(/[,;\s]+/).filter(Boolean).map(Number)
    if (v.length === 3 && v.every(Number.isFinite)) out.lps = [v[0], v[1], v[2]]
  }
  const plane = q.get('plane')
  if (plane === 'axial' || plane === 'coronal' || plane === 'sagittal') out.plane = plane
  const win = q.get('window')
  if (win) {
    if (isPresetKey(win)) out.window = { c: PRESET_BY_KEY[win].c, w: PRESET_BY_KEY[win].w, preset: win }
    else {
      const v = win.split(/[,/:]/).map(Number)
      if (v.length === 2 && v.every(Number.isFinite) && v[1] > 0) out.window = { c: v[0], w: v[1], preset: presetFor(v[0], v[1]) }
    }
  }
  const layout = q.get('layout')
  if (layout === 'single' || layout === '3up' || layout === 'compare') out.layout = layout
  return Object.keys(out).length ? out : null
}

/** Push a parsed deep link into the stores. Returns true if anything was applied. */
export function applyDeepLink(d: DeepLink): boolean {
  const app = useApp.getState()
  const slc = useSlc.getState()
  const patch: Parameters<typeof slc.set>[0] = {}
  if (d.series && d.series !== app.sliceSeries) {
    // no window in the link: like picking the series by hand, hop to its default window when switching
    // between a lung-kernel and a soft-tissue series (a lung window on a soft-tissue series looks broken)
    const prev = app.manifest?.volumes.find((v) => v.key === app.sliceSeries)
    const next = app.manifest?.volumes.find((v) => v.key === d.series)
    if (!d.window && prev && next && isLungSeries(prev) !== isLungSeries(next)) {
      const [c, w] = next.defaultWindow
      patch.win = { c, w, preset: presetFor(c, w) }
    }
    app.setSliceSeries(d.series)
  }
  if (d.plane) patch.plane = d.plane
  if (d.layout) { patch.layout = d.layout; patch.layoutChosen = true }
  if (d.window) patch.win = d.window
  if (d.lps) {
    app.setCursor(d.lps)
    patch.pendingFocus = { p: d.lps, zoom: null, fov: 120, onlyIfHidden: false }
  }
  slc.set(patch)
  return true
}

export function buildDeepLink(series: string, p: Vec3, plane: Plane, win: { c: number; w: number; preset: PresetKey | null }): string {
  const w = win.preset ?? `${Math.round(win.c)},${Math.round(win.w)}`
  const lps = p.map((v) => v.toFixed(2)).join(',')
  return `#/slices?series=${encodeURIComponent(series)}&lps=${lps}&plane=${plane}&window=${encodeURIComponent(w)}`
}
