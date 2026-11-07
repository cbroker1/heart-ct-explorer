/** Page-local state for the 3D anatomy viewer (zustand). The 3D scene reads it in useFrame via getState(). */
import { create } from 'zustand'
import type { MeshNode, Vec3 } from '../../lib/data'
import { PRESETS, type ClipAxis, type RenderMode, type SliceMode, type WindowKey } from './meta'

export interface ClipState {
  enabled: boolean
  axis: ClipAxis
  /** Plane position per axis, in world mm along +X (sagittal), +Y (axial) or +Z (coronal). */
  pos: Record<ClipAxis, number>
  /** false = keep the default half (inferior / posterior / patient-right), true = keep the other half. */
  flip: boolean
  slice: SliceMode
  window: WindowKey
  tint: boolean
}

export type HoverInfo =
  | { kind: 'structure'; name: string; hu?: number | null; src: '3d' | 'list' }
  | { kind: 'candidate'; id: number }
  | { kind: 'ct'; hu: number | null; name?: string }

export type Selection =
  | { kind: 'structure'; name: string; point: Vec3 | null; viaCT?: boolean; hu?: number | null }
  | { kind: 'candidate'; id: number }

export interface AnatomyState {
  nodes: MeshNode[]
  /** Group slider value; effective opacity = groupOpacity × node.defaultOpacity / groupDefault. */
  groupDefault: Record<string, number>
  visible: Record<string, boolean>
  groupOpacity: Record<string, number>
  mode: RenderMode
  preset: string | null
  hover: HoverInfo | null
  selection: Selection | null
  clip: ClipState
  explode: number
  calcium: boolean
  labels: boolean
  autoRotate: boolean
  search: string
  open: Record<string, boolean>
  ready: boolean
  /** World bounds of all structures (unexploded), set once the meshes are built. */
  bounds: { min: number[]; max: number[] } | null
  sweep: boolean

  init: (nodes: MeshNode[]) => void
  setVisible: (name: string, v: boolean) => void
  setGroupVisible: (group: string, v: boolean) => void
  setGroupOpacity: (group: string, v: number) => void
  applyPreset: (key: string) => void
  setMode: (m: RenderMode) => void
  setHover: (h: HoverInfo | null) => void
  select: (s: Selection | null) => void
  isolate: (name: string) => void
  setClip: (c: Partial<ClipState>) => void
  setClipPos: (v: number) => void
  setExplode: (v: number) => void
  set: (p: Partial<Pick<AnatomyState, 'calcium' | 'labels' | 'autoRotate' | 'search' | 'ready' | 'sweep'>>) => void
  toggleOpen: (group: string) => void
}

export function effectiveOpacity(n: MeshNode, s: Pick<AnatomyState, 'groupOpacity' | 'groupDefault'>): number {
  const gd = s.groupDefault[n.group] || 1
  const go = s.groupOpacity[n.group] ?? gd
  return Math.max(0, Math.min(1, (go * n.defaultOpacity) / gd))
}

const OVERLAPPING = ['heart', 'pericardium']

const defaultClip: ClipState = {
  enabled: false, axis: 'axial', pos: { axial: 0, coronal: 0, sagittal: 0 }, flip: false, slice: 'full', window: 'soft', tint: true,
}

export const useAnat = create<AnatomyState>()((set, get) => ({
  nodes: [],
  groupDefault: {},
  visible: {},
  groupOpacity: {},
  mode: 'solid',
  preset: 'chest',
  hover: null,
  selection: null,
  clip: defaultClip,
  explode: 0,
  calcium: false,
  labels: false,
  autoRotate: false,
  search: '',
  open: { heart: true, vessels: true },
  ready: false,
  bounds: null,
  sweep: false,

  init: (nodes) => {
    const groupDefault: Record<string, number> = {}
    for (const n of nodes) groupDefault[n.group] = Math.max(groupDefault[n.group] ?? 0, n.defaultOpacity)
    const chest = PRESETS[0]
    set({
      nodes,
      groupDefault,
      groupOpacity: { ...groupDefault, ...(chest.opacity ?? {}) },
      visible: Object.fromEntries(nodes.map((n) => [n.name, chest.show(n)])),
      preset: chest.key,
      mode: 'solid',
    })
  },
  setVisible: (name, v) => set((s) => ({ visible: { ...s.visible, [name]: v }, preset: null })),
  setGroupVisible: (group, v) =>
    set((s) => {
      const visible = { ...s.visible }
      for (const n of s.nodes) {
        if (n.group !== group) continue
        if (!v) visible[n.name] = false
        // The whole-heart shell and the pericardium wrap the chambers: leave them as they are.
        else if (!OVERLAPPING.includes(n.name)) visible[n.name] = true
      }
      return { visible, preset: null }
    }),
  setGroupOpacity: (group, v) => set((s) => ({ groupOpacity: { ...s.groupOpacity, [group]: v }, preset: null })),
  applyPreset: (key) => {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    const s = get()
    const groupOpacity = { ...s.groupDefault, ...(p.opacity ?? {}) }
    set({
      visible: Object.fromEntries(s.nodes.map((n) => [n.name, p.show(n)])),
      groupOpacity,
      mode: p.mode ?? 'solid',
      preset: key,
    })
  },
  setMode: (m) => set({ mode: m, preset: null }),
  setHover: (h) => {
    const cur = get().hover
    if (h === cur) return
    if (h && cur && JSON.stringify(h) === JSON.stringify(cur)) return
    set({ hover: h })
  },
  select: (sel) => set({ selection: sel }),
  isolate: (name) =>
    set((s) => ({ visible: Object.fromEntries(s.nodes.map((n) => [n.name, n.name === name])), preset: null, mode: s.mode })),
  setClip: (c) => set((s) => ({ clip: { ...s.clip, ...c } })),
  setClipPos: (v) => set((s) => ({ clip: { ...s.clip, pos: { ...s.clip.pos, [s.clip.axis]: v } } })),
  setExplode: (v) => set({ explode: v }),
  set: (p) => set(p),
  toggleOpen: (group) => set((s) => ({ open: { ...s.open, [group]: !s.open[group] } })),
}))
