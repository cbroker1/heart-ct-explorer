/**
 * Global app state shared across pages (zustand).
 * The crosshair lives in patient LPS mm so every view (2D slices, 3D anatomy, volume render)
 * can follow the same point regardless of which series/grid it displays.
 */
import { create } from 'zustand'
import type { Manifest, Vec3 } from './data'

export interface AppState {
  manifest: Manifest | null
  manifestError: string | null
  setManifest: (m: Manifest) => void
  setManifestError: (e: string) => void

  /** Shared crosshair / focus point in LPS mm. */
  cursor: Vec3 | null
  setCursor: (p: Vec3 | null) => void

  /** Currently highlighted anatomy structure (LabelClass.name) — hover/click in any view. */
  selectedStructure: string | null
  setSelectedStructure: (name: string | null) => void

  /** Currently selected calcium-candidate lesion id (from calcium.json). */
  selectedLesion: number | null
  setSelectedLesion: (id: number | null) => void

  /** Volume key last used in the slice explorer. */
  sliceSeries: string
  setSliceSeries: (k: string) => void
}

export const useApp = create<AppState>((set) => ({
  manifest: null,
  manifestError: null,
  setManifest: (m) => set((s) => ({ manifest: m, cursor: s.cursor ?? m.worldCenterLPS })),
  setManifestError: (e) => set({ manifestError: e }),

  cursor: null,
  setCursor: (p) => set({ cursor: p }),

  selectedStructure: null,
  setSelectedStructure: (name) => set({ selectedStructure: name }),

  selectedLesion: null,
  setSelectedLesion: (id) => set({ selectedLesion: id }),

  sliceSeries: 'axial_st',
  setSliceSeries: (k) => set({ sliceSeries: k }),
}))
