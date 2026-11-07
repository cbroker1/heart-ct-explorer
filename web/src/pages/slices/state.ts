/**
 * Page-local state for the slice explorer (zustand). Module-level, so the layout, window and overlay
 * choices survive navigating away and back. The shared crosshair (`cursor`) and the selected series
 * (`sliceSeries`) live in the app store (lib/store.ts).
 */
import { create } from 'zustand'
import type { Vec3 } from '../../lib/data'
import type { Layout, Plane, Xf } from './geom'
import type { PresetKey } from './presets'

export type SlabMode = 'none' | 'mip' | 'minip' | 'avg'
export type Tool = 'cross' | 'ruler'
export type LabelMode = 'fill' | 'outline'

export interface Ruler { id: number; plane: Plane; u: number; step: number; a: Vec3; b: Vec3; series: string }
export interface Win { c: number; w: number; preset: PresetKey | null }

const FITTED: Xf = { fitted: true, ca: 0, cb: 0, s: 1 }

export interface SlcState {
  layout: Layout
  /** true once the user (or a deep link) picked a layout; until then mobile defaults to single */
  layoutChosen: boolean
  plane: Plane
  partner: string
  /** the user picked the compare partner explicitly (otherwise it follows the main series) */
  partnerChosen: boolean
  win: Win
  labels: boolean
  labelMode: LabelMode
  labelOpacity: number
  hiddenGroups: string[]
  hoverIdentify: boolean
  calcHi: boolean
  lesions: boolean
  slab: SlabMode
  slabMM: number
  cine: boolean
  cineFps: number
  tool: Tool
  rulers: Ruler[]
  draft: Ruler | null
  xf: Record<Plane, Xf>
  active: number
  /** centre (and optionally zoom) every view on a point once the stage has a size */
  pendingFocus: {
    p: Vec3
    /** absolute zoom relative to fit, or null to keep the current zoom */
    zoom: number | null
    /** alternatively: zoom so the smaller viewport side spans about this many mm (never below fit) */
    fov?: number
    onlyIfHidden: boolean
  } | null
  set: (patch: Partial<SlcState>) => void
  setXf: (plane: Plane, xf: Xf) => void
  resetViews: (plane?: Plane) => void
  setWindow: (c: number, w: number, preset: PresetKey | null) => void
}

export const useSlc = create<SlcState>((set) => ({
  layout: '3up',
  layoutChosen: false,
  plane: 'axial',
  partner: 'cr_vessel_suppress',
  partnerChosen: false,
  win: { c: 50, w: 350, preset: 'mediastinum' },
  labels: true,
  labelMode: 'outline',
  labelOpacity: 0.75,
  hiddenGroups: ['body'],
  hoverIdentify: true,
  calcHi: false,
  lesions: true,
  slab: 'none',
  slabMM: 10,
  cine: false,
  cineFps: 12,
  tool: 'cross',
  rulers: [],
  draft: null,
  xf: { axial: { ...FITTED }, coronal: { ...FITTED }, sagittal: { ...FITTED } },
  active: 0,
  pendingFocus: null,
  set: (patch) => set(patch),
  setXf: (plane, xf) => set((s) => ({ xf: { ...s.xf, [plane]: xf } })),
  resetViews: (plane) =>
    set((s) => ({
      xf: plane
        ? { ...s.xf, [plane]: { ...FITTED } }
        : { axial: { ...FITTED }, coronal: { ...FITTED }, sagittal: { ...FITTED } },
    })),
  setWindow: (c, w, preset) => set({ win: { c, w: Math.max(1, w), preset } }),
}))

// ------------------------------------------------------------------ hover probe (high-frequency, kept separate)
export interface HoverInfo {
  slot: number
  p: Vec3
  series: string
  hu: number | null
  label: number
  lesion: number
}

export const useHover = create<{ hover: HoverInfo | null; setHover: (h: HoverInfo | null) => void }>((set) => ({
  hover: null,
  setHover: (h) => set({ hover: h }),
}))

// ------------------------------------------------------------------ loading / GPU state
/** download -> upload -> ready (on the GPU); 'cpu' = downloaded and cached in memory but not on the GPU */
export interface LoadEntry { phase: 'download' | 'upload' | 'ready' | 'cpu' | 'error'; loaded: number; total: number; error?: string }

export interface LoadState {
  entries: Record<string, LoadEntry>
  /** series actually on screen (the requested one may still be loading) */
  shown: { main: string | null; partner: string | null }
  labelsReady: boolean
  lesionsReady: boolean
  finderReady: boolean
  glError: string | null
  /** the user has scrolled/clicked/touched the image at least once (hides the onboarding hint) */
  interacted: boolean
  /** views-area size in CSS px */
  size: { w: number; h: number }
  setEntry: (key: string, e: LoadEntry) => void
  set: (patch: Partial<Omit<LoadState, 'set' | 'setEntry'>>) => void
}

export const useLoad = create<LoadState>((set) => ({
  entries: {},
  shown: { main: null, partner: null },
  labelsReady: false,
  lesionsReady: false,
  finderReady: false,
  glError: null,
  interacted: false,
  size: { w: 0, h: 0 },
  setEntry: (key, e) => set((s) => ({ entries: { ...s.entries, [key]: e } })),
  set: (patch) => set(patch),
}))
