/**
 * 3D Anatomy (#/anatomy): the AI-segmented anatomy of the scan as glossy 3D surfaces, with presets,
 * a cut-away that paints the real CT on the cut, exploding, calcium-candidate markers and labels.
 * Implementation lives in ./anatomy/.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { formatBytes, loadJSON } from '../lib/data'
import { lpsToWorld } from '../lib/coords'
import type { CalciumReport } from '../lib/reports'
import { useApp } from '../lib/store'
import { LoaderOverlay } from '../components/ui'
import Scene from './anatomy/Scene'
import { Sidebar } from './anatomy/Sidebar'
import { Overlays } from './anatomy/Overlays'
import { useCTVolume } from './anatomy/ct'
import { PRESETS, type CameraView } from './anatomy/meta'
import { rig, setView } from './anatomy/rig'
import { useAnat, type ClipState } from './anatomy/state'
import './anatomy/anatomy.css'

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: String((e as Error)?.message ?? e) }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="ana-nogl">
          <div className="card">
            <h3 style={{ color: 'var(--danger)' }}>The 3D view could not start</h3>
            <p className="muted mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.error}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export interface AnatomyApi {
  setPreset: (key: string) => boolean
  setCamera: (view: CameraView, transition?: boolean) => boolean
  select: (name: string | null) => boolean
  setClip: (c: Partial<ClipState> & { position?: number }) => void
  setExplode: (v: number) => void
  set: (p: { calcium?: boolean; labels?: boolean; autoRotate?: boolean; search?: string }) => void
  state: () => Record<string, unknown>
  /** Page coordinates of a structure's surface anchor (name) or of a calcium candidate (id). */
  screen: (what: string | number) => { x: number; y: number } | null
  perf: () => Promise<Record<string, number | undefined> | null>
}
declare global {
  interface Window { __anatomy?: AnatomyApi }
}

export default function Anatomy() {
  const manifest = useApp((s) => s.manifest)!
  const webgl2 = useMemo(hasWebGL2, [])
  const stageRef = useRef<HTMLDivElement>(null)
  // Keep the user's view when coming back to the page; re-initialise only for a different model.
  useMemo(() => {
    if (useAnat.getState().nodes !== manifest.meshes.nodes) useAnat.getState().init(manifest.meshes.nodes)
  }, [manifest])
  const ready = useAnat((s) => s.ready)
  useEffect(() => () => useAnat.setState({ ready: false, hover: null }), [])

  // Keep the app-wide "selected structure" in sync (other pages can highlight the same anatomy).
  useEffect(() => {
    const st = useAnat.getState()
    const shared = useApp.getState().selectedStructure
    if (shared && !st.selection && st.nodes.some((n) => n.name === shared)) st.select({ kind: 'structure', name: shared, point: null })
    return useAnat.subscribe((s, prev) => {
      if (s.selection === prev.selection) return
      const app = useApp.getState()
      if (s.selection?.kind === 'structure') { if (app.selectedStructure !== s.selection.name) app.setSelectedStructure(s.selection.name) }
      else if (!s.selection && prev.selection?.kind === 'structure') app.setSelectedStructure(null)
    })
  }, [])

  const [calcium, setCalcium] = useState<CalciumReport | null>(null)
  const calciumRef = useRef<CalciumReport | null>(null)
  calciumRef.current = calcium
  useEffect(() => {
    let live = true
    loadJSON<CalciumReport>(manifest.files.calcium ?? 'calcium.json').then((r) => { if (live) setCalcium(r) }).catch(() => {})
    return () => { live = false }
  }, [manifest])

  const clipEnabled = useAnat((s) => s.clip.enabled)
  const ct = useCTVolume(manifest, clipEnabled)

  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 820px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)')
    const on = () => setCompact(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const [dpr, setDpr] = useState(() => Math.min(2, window.devicePixelRatio || 1))

  // Keyboard: Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') useAnat.getState().select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Debug / test hooks.
  useEffect(() => {
    const api: AnatomyApi = {
      setPreset: (key) => {
        const p = PRESETS.find((x) => x.key === key)
        if (!p) return false
        useAnat.getState().applyPreset(key)
        setView(p.view, false)
        return true
      },
      setCamera: (view, transition = false) => {
        setView(view, transition)
        return true
      },
      select: (name) => {
        const st = useAnat.getState()
        if (!name) { st.select(null); return true }
        if (!st.nodes.some((n) => n.name === name)) return false
        st.select({ kind: 'structure', name, point: null })
        return true
      },
      setClip: ({ position, ...c }) => {
        const st = useAnat.getState()
        st.setClip(c)
        if (position !== undefined) useAnat.getState().setClipPos(position)
      },
      setExplode: (v) => useAnat.getState().setExplode(v),
      set: (p) => useAnat.getState().set(p),
      state: () => {
        const st = useAnat.getState()
        const cam = rig.camera
        return {
          ready: st.ready, preset: st.preset, mode: st.mode, clip: st.clip, explode: st.explode,
          visible: Object.entries(st.visible).filter(([, v]) => v).map(([k]) => k).length,
          camera: cam ? cam.position.toArray().map((v) => Math.round(v)) : null,
          meshes: rig.structures.length,
          triangles: rig.gl?.info.render.triangles, calls: rig.gl?.info.render.calls,
        }
      },
      perf: async () => {
        const gl = rig.gl
        if (!gl) return null
        gl.info.autoReset = false
        gl.info.reset()
        const t0 = performance.now()
        let frames = 0
        await new Promise<void>((res) => {
          const tick = () => { frames++; if (frames < 30) requestAnimationFrame(tick); else res() }
          requestAnimationFrame(tick)
        })
        const ms = (performance.now() - t0) / frames
        const r = { trianglesPerFrame: Math.round(gl.info.render.triangles / frames), callsPerFrame: Math.round(gl.info.render.calls / frames), msPerFrame: Math.round(ms * 10) / 10, programs: gl.info.programs?.length, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }
        gl.info.autoReset = true
        return r
      },
      screen: (what) => {
        const cam = rig.camera
        const el = rig.gl?.domElement
        if (!cam || !el) return null
        let p: THREE.Vector3 | null = null
        if (typeof what === 'number') {
          const c = calciumRef.current?.candidates.find((k) => k.id === what)
          if (c) p = new THREE.Vector3(...lpsToWorld(c.centerLPS, manifest.worldCenterLPS))
        } else {
          const s = rig.structures.find((x) => x.name === what)
          if (s) p = s.centroid.clone().add(s.offset).add(s.anchor)
        }
        if (!p) return null
        p.project(cam)
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + ((p.x + 1) / 2) * r.width), y: Math.round(r.top + ((1 - p.y) / 2) * r.height) }
      },
    }
    window.__anatomy = api
    return () => { if (window.__anatomy === api) delete window.__anatomy }
  }, [manifest])

  return (
    <div className="viewer ana">
      <div className="stage ana-stage" ref={stageRef}>
        {webgl2 ? (
          <Boundary>
            <Canvas
              className="ana-canvas"
              dpr={dpr}
              gl={{ antialias: true, stencil: true, alpha: true, powerPreference: 'high-performance' }}
              camera={{ fov: 30, near: 2, far: 9000, position: [0, 120, 1500] }}
              onCreated={({ gl }) => {
                gl.localClippingEnabled = true
                gl.toneMapping = THREE.ACESFilmicToneMapping
                gl.toneMappingExposure = 1.05
              }}
              onPointerMissed={() => useAnat.getState().select(null)}
            >
              <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d * 0.75))} />
              <Suspense fallback={null}>
                <Scene manifest={manifest} vol={ct.vol} calcium={calcium} compact={compact} />
              </Suspense>
            </Canvas>
          </Boundary>
        ) : (
          <div className="ana-nogl">
            <div className="card">
              <h3>3D needs WebGL 2</h3>
              <p className="muted">This browser or device does not offer WebGL 2, so the 3D anatomy cannot be drawn. Try a recent Chrome, Edge, Firefox or Safari.</p>
            </div>
          </div>
        )}
        {webgl2 && <Overlays manifest={manifest} calcium={calcium} stageRef={stageRef} ct={ct} />}
        {webgl2 && !ready && <LoaderOverlay label={`Building your 3D anatomy · ${manifest.meshes.nodes.length} structures, ${formatBytes(manifest.meshes.bytes)}`} />}
      </div>
      <Sidebar manifest={manifest} calcium={calcium} ct={{ ...ct, ready: !!ct.vol }} />
    </div>
  )
}
