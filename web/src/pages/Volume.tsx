/**
 * Volume rendering page (#/volume): GPU ray-marched views of the real CT.
 * Renderer: ./volume/VolumeRenderer.ts (raw three.js). Presets & label styling: ./volume/presets.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { loadGrid, type GridMeta, type LabelClass, type Manifest, type Vec3 } from '../lib/data'
import { fmtLps, indexToLps, lpsToIndex, worldToLps } from '../lib/coords'
import { LoaderOverlay, Segmented, Slider, Toggle, navigate } from '../components/ui'
import { QUALITY, VolumeRenderer, type Quality, type RenderGrid, type RenderParams } from './volume/VolumeRenderer'
import {
  DEFAULT_GROUPS, GROUP_INFO, GROUP_ORDER, HEART_REGION_NAMES, PRESETS, classStyling, presetByKey,
  type GroupKey, type Preset, type PresetKey, type ViewName, type VolumeKey,
} from './volume/presets'
import { buildLUT, evalTF, histogram, linearToSrgb, rgbToCss, tissueName, transformPoints } from './volume/tf'
import { Legend, OrientationCube, RangeSlider, TFStrip, cubeTransform, patientDir, DIR_WORDS } from './volume/components'
import { cleanVesselRims } from './volume/labels'
import './volume/volume.css'

type Clip = [[number, number], [number, number], [number, number]]
const FULL_CLIP: Clip = [[0, 1], [0, 1], [0, 1]]
/** Front ~95 mm of the chest box removed: skin, sternum and the front of the ribs. */
const OPEN_CHEST: Clip = [[0, 1], [0.25, 1], [0, 1]]
/** 3 cm coronal slab through the hila and both lungs. */
const LUNG_SLAB: Clip = [[0, 1], [0.42, 0.5], [0, 1]]
const sameClip = (a: Clip, b: Clip) => a.every((r, i) => Math.abs(r[0] - b[i][0]) < 1e-3 && Math.abs(r[1] - b[i][1]) < 1e-3)
/** Extra weight of bone (HU above +120) in the virtual radiograph; the DRR shader gets the same value via `win`. */
const DRR_BONE_BOOST = 2.2
/** Labels that wrap the whole trunk: every X-ray ray crosses them, so they only "win" a ray when nothing else does. */
const BODY_WALL_NAMES = new Set(['body_trunc', 'autochthon_left', 'autochthon_right'])
interface Tweak { s1: number; s2: number; opacity: number }
interface PointInfo {
  lps: Vec3; name: string; group: string | null; hu: number | null; tissue: string; volume: VolumeKey
  /** X-ray picks: what casts the shadow, as shares of the (virtual) X-ray absorption along the whole ray */
  ray?: { share: number; also: { name: string; share: number }[] }
}
type VolError = { msg: string; scope: 'gpu' | 'chest' | 'heart' }
const pct = (f: number) => `${Math.max(1, Math.round(f * 100))} %`

function NoWebGL2(props: { detail?: string }) {
  return (
    <div className="page-pad">
      <div className="card vol-nogl">
        <div className="eyebrow">Volume rendering</div>
        <h2>This view needs WebGL2</h2>
        <p className="muted">
          The volume renderer ray-marches the full 3D scan on your graphics card, which needs WebGL2. Your browser or device
          doesn’t offer it right now. A recent Chrome, Edge, Firefox or Safari (15+) with hardware acceleration enabled will work.
        </p>
        <p className="muted">Meanwhile, the <a href="#/slices">Slice explorer</a> and <a href="#/anatomy">3D anatomy</a> pages work on most devices.</p>
        {props.detail && <p className="mono faint" style={{ fontSize: 11 }}>{props.detail}</p>}
      </div>
    </div>
  )
}

export default function Volume() {
  const manifest = useApp((s) => s.manifest)
  // No throwaway probe context: support is checked here, actual context creation in VolumeView.
  const [gl2] = useState(() => typeof window !== 'undefined' && 'WebGL2RenderingContext' in window)
  const [glFail, setGlFail] = useState<string | null>(null)
  if (!manifest) return null
  if (!gl2 || glFail !== null) return <NoWebGL2 detail={glFail ?? undefined} />
  return <VolumeView m={manifest} onNoGL={setGlFail} />
}

function VolumeView({ m, onNoGL }: { m: Manifest; onNoGL: (detail: string) => void }) {
  const setCursor = useApp((s) => s.setCursor)
  const classes = m.renderLabels.classes
  const classById = useMemo(() => {
    const map = new Map<number, LabelClass>()
    for (const c of classes) map.set(c.id, c)
    return map
  }, [classes])

  // ------------------------------------------------------------------ state
  // deep link: #/volume?preset=heart (kept in sync with replaceState, so links to a look are shareable)
  const [presetKey, setPresetKey] = useState<PresetKey>(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const k = q.get('preset') as PresetKey | null
    return k && PRESETS.some((p) => p.key === k && (p.volume !== 'heart' || m.heartRender)) ? k : 'cinematic'
  })
  const preset = presetByKey(presetKey)
  const presetKeyRef = useRef(presetKey)
  presetKeyRef.current = presetKey
  const [tweaks, setTweaks] = useState<Record<PresetKey, Tweak>>(
    () => Object.fromEntries(PRESETS.map((p) => [p.key, { s1: p.s1.def, s2: p.s2.def, opacity: 1 }])) as Record<PresetKey, Tweak>,
  )
  const tweak = tweaks[presetKey]
  const setTweak = (patch: Partial<Tweak>) => setTweaks((t) => ({ ...t, [presetKey]: { ...t[presetKey], ...patch } }))
  const [quality, setQuality] = useState<Quality>('medium')
  const [lighting, setLighting] = useState(true)
  const [shadows, setShadows] = useState(true)
  // one clip box per preset (a slab made for MIP should not silently crop the X-ray)
  const [clips, setClips] = useState<Partial<Record<PresetKey, Clip>>>({})
  const clip = clips[presetKey] ?? FULL_CLIP
  const setClip = (c: Clip) => setClips((s) => ({ ...s, [presetKey]: c }))
  const [groups, setGroups] = useState<Record<GroupKey, boolean>>(DEFAULT_GROUPS)
  const [bodyWall, setBodyWall] = useState(0.3)
  const [isolateHeart, setIsolateHeart] = useState(true)
  const [cartilage, setCartilage] = useState(true)
  const [glass, setGlass] = useState(1)
  const [autoRotate, setAutoRotate] = useState(false)
  const [reducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [gateRampOverride, setGateRampOverride] = useState<[number, number] | null>(null) // dev tuning only
  const [load, setLoad] = useState<{ label: string; loaded: number; total: number } | null>({ label: 'Loading 3D volume…', loaded: 0, total: m.render.bytes + m.renderLabels.bytes })
  const [error, setError] = useState<VolError | null>(null)
  const [ready, setReady] = useState<{ chest: boolean; heart: boolean }>({ chest: false, heart: false })
  const [hover, setHover] = useState<(PointInfo & { x: number; y: number }) | null>(null)
  const [pin, setPin] = useState<PointInfo | null>(null)
  const [touched, setTouched] = useState(false)
  const hoverRef = useRef<HTMLDivElement>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const rRef = useRef<VolumeRenderer | null>(null)
  const dataRef = useRef<{ chest: Uint8Array | null; heart: Uint8Array | null; labels: Uint8Array | null }>({ chest: null, heart: null, labels: null })
  const histRef = useRef<{ chest: Float32Array | null; heart: Float32Array | null }>({ chest: null, heart: null })
  const cubeRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<Record<'l' | 'r' | 't' | 'b', HTMLSpanElement | null>>({ l: null, r: null, t: null, b: null })
  const pinMarkRef = useRef<HTMLDivElement>(null)
  const refineRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<PointInfo | null>(null)
  pinRef.current = pin
  // The shared crosshair (store.cursor) when another page moved it away from its default. A point picked
  // here also becomes the shared cursor: that one is not echoed back as a "shared" marker once its pin closes.
  const cursor = useApp((s) => s.cursor)
  const ownPickRef = useRef<Vec3 | null>(null)
  const sharedCursor = useMemo(() => {
    if (!cursor || cursor === ownPickRef.current) return null
    const c = m.worldCenterLPS
    return Math.hypot(cursor[0] - c[0], cursor[1] - c[1], cursor[2] - c[2]) > 1 ? cursor : null
  }, [cursor, m])
  const sharedRef = useRef<Vec3 | null>(null)
  sharedRef.current = pin ? null : sharedCursor
  const sharedMarkRef = useRef<HTMLDivElement>(null)

  const gridOf = useCallback((k: VolumeKey): RenderGrid => (k === 'heart' && m.heartRender ? m.heartRender : m.render), [m])
  const activeReady = preset.volume === 'heart' ? ready.heart : ready.chest

  // ------------------------------------------------------------------ overlays updated straight from the render loop
  const updateOverlays = useCallback(() => {
    const r = rRef.current
    if (!r) return
    const { right, up } = r.viewBasis()
    const set = (k: 'l' | 'r' | 't' | 'b', x: number, y: number, z: number) => {
      const el = markRef.current[k]
      if (!el) return
      const d = patientDir(x, y, z)
      if (el.textContent !== d) {
        el.textContent = d
        el.title = d.split('').map((c) => DIR_WORDS[c]).join(' + ')
      }
    }
    set('r', right.x, right.y, right.z)
    set('l', -right.x, -right.y, -right.z)
    set('t', up.x, up.y, up.z)
    set('b', -up.x, -up.y, -up.z)
    if (cubeRef.current) cubeRef.current.style.transform = cubeTransform(r.camera.matrixWorldInverse.elements)
    const place = (el: HTMLDivElement | null, lps: Vec3 | null) => {
      if (!el) return
      const p = lps ? r.projectLps(lps, m.worldCenterLPS) : null
      if (p) { el.style.display = 'block'; el.style.transform = `translate(${p.x}px, ${p.y}px)` } else el.style.display = 'none'
    }
    place(pinMarkRef.current, pinRef.current?.lps ?? null)
    place(sharedMarkRef.current, sharedRef.current)
  }, [m])

  // ------------------------------------------------------------------ renderer lifecycle
  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) return
    let r: VolumeRenderer
    try {
      r = new VolumeRenderer(host)
    } catch (e) {
      host.querySelector('canvas')?.remove()
      onNoGL(String((e as Error)?.message ?? e))
      return
    }
    rRef.current = r
    r.onError = (msg) => setError({ msg, scope: 'gpu' })
    r.onRecovered = () => setError((e) => (e?.scope === 'gpu' ? null : e))
    r.onView = updateOverlays
    r.onProgress = (f, total, interactive) => {
      const el = refineRef.current
      if (!el) return
      const done = !interactive && f >= total
      el.style.setProperty('--p', interactive ? '0' : String(f / total))
      el.dataset.state = interactive ? 'moving' : done ? 'done' : 'refining'
    }
    const ro = new ResizeObserver(() => {
      const b = host.getBoundingClientRect()
      r.resize(b.width, b.height)
      updateOverlays()
    })
    ro.observe(host)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __vol?: unknown }).__vol = {
        r, setPresetKey, setQuality, setBodyWall, setClips, setGroups, setLighting, setShadows, setTweaks, setAutoRotate, setIsolateHeart, setGlass, setGateRampOverride, PRESETS,
        bump: () => setTweaks((t) => ({ ...t, [presetKeyRef.current]: { ...t[presetKeyRef.current], s1: t[presetKeyRef.current].s1 + 1e-6 } })),
      }
    }
    return () => {
      ro.disconnect()
      r.dispose()
      if (rRef.current === r) rRef.current = null
    }
  }, [updateOverlays, onNoGL])

  // ------------------------------------------------------------------ data loading
  useEffect(() => {
    let cancelled = false
    const prog = [0, 0]
    const total = m.render.bytes + m.renderLabels.bytes
    const report = () => { if (!cancelled) setLoad({ label: 'Loading 3D volume…', loaded: prog[0] + prog[1], total }) }
    Promise.all([
      loadGrid(m.render, (l) => { prog[0] = l; report() }),
      loadGrid(m.renderLabels, (l) => { prog[1] = l; report() }),
    ])
      .then(([vol, lab]) => {
        if (cancelled) return
        const r = rRef.current
        if (!r) return
        // a cleaned COPY (the decoded grid is shared with other pages through loadGrid's cache)
        const labels = cleanVesselRims(m.renderLabels.dims, lab as Uint8Array, m.renderLabels.classes).data
        dataRef.current.chest = vol as Uint8Array
        dataRef.current.labels = labels
        histRef.current.chest = histogram(vol as Uint8Array)
        r.setLabels(m.renderLabels, labels)
        r.addVolume('chest', m.render, vol as Uint8Array, m.renderLabels, m.worldCenterLPS)
        setReady((s) => ({ ...s, chest: true }))
        setLoad(null)
      })
      .catch((e) => {
        if (cancelled) return
        setLoad(null)
        setError({ msg: `Could not load the volume: ${(e as Error)?.message ?? e}`, scope: 'chest' })
      })
    return () => { cancelled = true }
  }, [m])

  useEffect(() => {
    if (preset.volume !== 'heart' || ready.heart || !m.heartRender || !ready.chest) return
    const hm = m.heartRender
    let cancelled = false
    setError((e) => (e?.scope === 'heart' ? null : e))   // coming back to the heart look retries a failed download
    setLoad({ label: 'Loading heart close-up…', loaded: 0, total: hm.bytes })
    loadGrid(hm, (l, t) => { if (!cancelled) setLoad({ label: 'Loading heart close-up…', loaded: l, total: t }) })
      .then((vol) => {
        if (cancelled) return
        const r = rRef.current
        if (!r) return
        dataRef.current.heart = vol as Uint8Array
        histRef.current.heart = histogram(vol as Uint8Array)
        r.addVolume('heart', hm, vol as Uint8Array, m.renderLabels, m.worldCenterLPS)
        // frame the camera on the AI heart label (+ great vessels), not the whole 16 cm field of view
        const lab = dataRef.current.labels
        if (lab) {
          const ids = new Set(classes.filter((c) => HEART_REGION_NAMES.includes(c.name) && c.name !== 'inferior_vena_cava').map((c) => c.id))
          const b = labelBoundsLps(m.renderLabels, lab, ids)
          if (b) {
            // keep it inside the heart scan's own box
            const hb = gridBoxLps(hm)
            const lo = b.min.map((v, a) => Math.max(v, hb.min[a])) as Vec3
            const hi = b.max.map((v, a) => Math.min(v, hb.max[a])) as Vec3
            r.setFocusBounds('heart', lo, hi, m.worldCenterLPS)
          }
        }
        setReady((s) => ({ ...s, heart: true }))
        setLoad(null)
      })
      .catch((e) => {
        if (cancelled) return
        setLoad(null)
        setError({ msg: `Could not load the heart scan: ${(e as Error)?.message ?? e}`, scope: 'heart' })
      })
    // switching away mid-download: drop the overlay (the download continues and stays cached for next time)
    return () => { cancelled = true; setLoad(null) }
  }, [preset.volume, ready.heart, ready.chest, m, classes])

  // ------------------------------------------------------------------ renderer parameters
  const styling = useMemo(() => classStyling(presetKey, classes, { groups, cartilage, isolateHeart }), [presetKey, classes, groups, cartilage, isolateHeart])
  useEffect(() => {
    if (ready.chest) rRef.current?.setClassStyles(styling.style, styling.lut)
  }, [styling, ready.chest])

  const points = useMemo(() => (preset.tf ? transformPoints(preset.tf, tweak.s1, tweak.s2, preset.pivot) : null), [preset, tweak.s1, tweak.s2])
  const grid = gridOf(preset.volume)
  useEffect(() => {
    if (points && rRef.current) rRef.current.setTF(buildLUT(points, grid.huMin, grid.huMax))
  }, [points, grid])

  const win = useMemo((): [number, number, number, number] => {
    if (preset.mode === 'drr') return [48 - tweak.s1, 290 / tweak.s2, DRR_BONE_BOOST, 1.12]
    if (preset.mode === 'mip') return [tweak.s1 - tweak.s2 / 2, tweak.s2, 0, 1]
    return [0, 1, 0, 1]
  }, [preset.mode, tweak.s1, tweak.s2])

  useEffect(() => {
    const r = rRef.current
    if (!r) return
    const p: RenderParams = {
      mode: preset.mode,
      volume: preset.volume,
      opacity: tweak.opacity,
      gateFloor: presetKey === 'cinematic' ? bodyWall : presetKey === 'skeleton' ? 0.12 : 0,
      skinVeil: presetKey === 'cinematic',
      gateRamp: gateRampOverride ?? (presetKey === 'heart' ? [0.2, 0.36] : [0.05, 0.32]),
      grad: preset.grad,
      shading: preset.shading,
      lighting,
      shadows,
      quality,
      clip,
      win,
      flags: { gate: styling.gate, solid: styling.solid, glass: styling.glass, tint: styling.tint, boneProtect: false },
      solidAlpha: presetKey === 'skeleton' ? 0.14 : presetKey === 'cinematic' ? 0.3 : 3,
      glass: (presetKey === 'lungs' ? 0.62 : 0.55) * glass,
    }
    r.setParams(p)
  }, [preset, presetKey, tweak.opacity, bodyWall, lighting, shadows, quality, clip, win, styling, glass, activeReady, gateRampOverride])

  // X-ray: a distant source (narrow field of view) like a real 180 cm chest film, viewed from the front.
  const prevPresetRef = useRef<PresetKey>(presetKey)
  useEffect(() => {
    const r = rRef.current
    if (!r) return
    const prev = presetByKey(prevPresetRef.current)
    prevPresetRef.current = presetKey
    r.setFov(preset.mode === 'drr' ? 13 : 30)
    if (preset.mode === 'drr' && prev.key !== presetKey && prev.volume === preset.volume && activeReady) r.flyTo('front')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey])

  // fly the camera when the active volume changes (and on first load)
  const lastVol = useRef<VolumeKey | null>(null)
  useEffect(() => {
    const r = rRef.current
    if (!r || !activeReady) return
    if (lastVol.current !== preset.volume) {
      const first = lastVol.current === null
      r.flyTo(preset.view, { fromFar: first, duration: first ? 1800 : 950 })
      lastVol.current = preset.volume
    }
  }, [activeReady, preset.volume, preset.view])

  useEffect(() => { rRef.current?.setAutoRotate(autoRotate) }, [autoRotate])

  // ------------------------------------------------------------------ picking
  /** `viewDir` (unit, LPS): for label surfaces, whose edge rarely sits exactly on a density edge. */
  const describe = useCallback((lps: Vec3, vol: VolumeKey, viewDir?: Vec3): PointInfo => {
    const d = dataRef.current
    let name = 'Unlabelled'
    let group: string | null = null
    const g = gridOf(vol)
    const arr = vol === 'heart' ? d.heart : d.chest
    const huAt = (p: Vec3) => { const v = arr ? sampleU8(g, arr, p) : null; return v === null ? null : g.huMin + (v / 255) * (g.huMax - g.huMin) }
    let hu = huAt(lps)
    if (d.labels) {
      let lab = sampleU8(m.renderLabels, d.labels, lps)
      // On a surface the nearest label voxel can belong to the neighbour (1.5 mm label grid): if we got
      // the generic body/outside label, prefer a specific structure right next to the point.
      const generic = (id: number | null) => id === null || id === 0 || classById.get(id)?.name === 'body_trunc'
      if (generic(lab)) {
        const alt = nearbySpecificLabel(m.renderLabels, d.labels, lps, (id) => !generic(id), hu !== null && hu > 180 ? 'bones' : null, classById)
        if (alt !== null) lab = alt
      }
      const c = lab ? classById.get(lab) : undefined
      if (c) { name = c.display; group = c.group } else if (lab === 0) name = 'Outside the labelled anatomy'
      // A label surface's outermost voxel is often partial volume (a "right ventricle" at -577 HU): report the
      // median density of the first 8 mm of that structure along the line of sight instead.
      if (viewDir && c && arr) {
        const hus: number[] = []
        for (let s = 0; s <= 8; s += 0.75) {
          const p: Vec3 = [lps[0] + viewDir[0] * s, lps[1] + viewDir[1] * s, lps[2] + viewDir[2] * s]
          if (sampleU8(m.renderLabels, d.labels, p) !== c.id) { if (hus.length) break; continue }
          const h = huAt(p)
          if (h !== null) hus.push(h)
        }
        if (hus.length) hu = hus.sort((x, y) => x - y)[Math.floor(hus.length / 2)]
      }
    }
    const huR = hu === null ? null : Math.round(hu)
    return { lps, name, group, hu: huR, tissue: huR === null ? '' : tissueName(huR), volume: vol }
  }, [m, classById, gridOf])

  /**
   * X-ray picking. A radiograph pixel is the sum of everything on its ray, so instead of one voxel we walk the
   * whole ray (same attenuation model as the DRR shader) and report the labelled structure that absorbs most
   * of it, ignoring the body wall unless nothing else is there. The point is the middle of that structure's
   * longest stretch along the ray.
   */
  const describeRay = useCallback((a: Vec3, b: Vec3, vol: VolumeKey): PointInfo | null => {
    const d = dataRef.current
    const g = gridOf(vol)
    const arr = vol === 'heart' ? d.heart : d.chest
    if (!arr || !d.labels) return null
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.75))
    const total = new Map<number, number>()
    const best = new Map<number, { w: number; p: Vec3 }>()   // per label: its heaviest contiguous run
    let sum = 0
    let run: { id: number; w: number; x: number; y: number; z: number } | null = null
    const closeRun = () => {
      if (!run || run.w <= 0) return
      const prev = best.get(run.id)
      if (!prev || run.w > prev.w) best.set(run.id, { w: run.w, p: [run.x / run.w, run.y / run.w, run.z / run.w] })
    }
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n
      const p: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
      const v = sampleU8(g, arr, p)
      if (v === null) continue
      const hu = g.huMin + (v / 255) * (g.huMax - g.huMin)
      const w = Math.max(hu + 1000, 0) + DRR_BONE_BOOST * Math.max(hu - 120, 0)
      const id = sampleU8(m.renderLabels, d.labels, p) ?? 0
      sum += w
      total.set(id, (total.get(id) ?? 0) + w)
      if (!run || run.id !== id) { closeRun(); run = { id, w: 0, x: 0, y: 0, z: 0 } }
      run.w += w; run.x += p[0] * w; run.y += p[1] * w; run.z += p[2] * w
    }
    closeRun()
    if (sum <= 0) return null
    const ranked = [...total.entries()].filter(([id]) => id !== 0).sort((x, y) => y[1] - x[1])
    if (!ranked.length) return null
    const wall = (id: number) => BODY_WALL_NAMES.has(classById.get(id)?.name ?? '')
    const inner = ranked.find(([id, w]) => !wall(id) && w / sum >= 0.08)
    const [id, w] = inner ?? ranked[0]
    const c = classById.get(id)
    const lps = best.get(id)?.p ?? a
    const v = sampleU8(g, arr, lps)
    const hu = v === null ? null : Math.round(g.huMin + (v / 255) * (g.huMax - g.huMin))
    const also = ranked.filter(([k, s]) => k !== id && s / sum >= 0.03).slice(0, 3)
      .map(([k, s]) => ({ name: classById.get(k)?.display ?? 'Unlabelled', share: s / sum }))
    return { lps, name: c?.display ?? 'Unlabelled', group: c?.group ?? null, hu, tissue: hu === null ? '' : tissueName(hu), volume: vol, ray: { share: w / sum, also } }
  }, [m, classById, gridOf])

  const probeAt = useCallback((clientX: number, clientY: number): PointInfo | null => {
    const r = rRef.current, host = canvasHostRef.current
    if (!r || !host) return null
    const b = host.getBoundingClientRect()
    if (preset.mode === 'drr') {
      const ray = r.rayThroughClip(clientX - b.left, clientY - b.top)
      return ray ? describeRay(ray.a, ray.b, ray.volume) : null
    }
    const hit = r.probe(clientX - b.left, clientY - b.top)
    if (!hit) return null
    let dir: Vec3 | undefined
    if (preset.mode === 'label') {
      const c = worldToLps(r.camera.position.toArray() as Vec3, m.worldCenterLPS)
      const v: Vec3 = [hit.lps[0] - c[0], hit.lps[1] - c[1], hit.lps[2] - c[2]]
      const n = Math.hypot(...v) || 1
      dir = [v[0] / n, v[1] / n, v[2] / n]
    }
    return describe(hit.lps, hit.volume, dir)
  }, [describe, describeRay, preset.mode, m])

  const pending = useRef<{ x: number; y: number } | null>(null)
  const probeRaf = useRef(0)
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const pointers = useRef(new Set<number>())   // a pinch or two-finger pan never counts as a tap
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons) { if (hover) setHover(null); return }
    pending.current = { x: e.clientX, y: e.clientY }
    if (!probeRaf.current) {
      probeRaf.current = requestAnimationFrame(() => {
        probeRaf.current = 0
        const p = pending.current
        const host = canvasHostRef.current
        if (!p || !host) return
        const info = probeAt(p.x, p.y)
        const b = host.getBoundingClientRect()
        setHover(info ? { ...info, x: p.x - b.left, y: p.y - b.top } : null)
      })
    }
  }
  useEffect(() => () => cancelAnimationFrame(probeRaf.current), [])
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.isPrimary) pointers.current.clear()   // a primary pointer starts a new gesture (self-heals a missed pointerup)
    pointers.current.add(e.pointerId)
    down.current = pointers.current.size > 1 ? null : { x: e.clientX, y: e.clientY, t: performance.now() }
    if (!touched) setTouched(true)
  }
  const onPointerCancel = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); down.current = null }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const d0 = down.current
    down.current = null
    if (!d0 || e.button > 0) return
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 5 || performance.now() - d0.t > 450) return
    const info = probeAt(e.clientX, e.clientY)
    setPin(info)
    if (info) { ownPickRef.current = info.lps; setCursor(info.lps) }
    requestAnimationFrame(updateOverlays)
  }
  // keep the hover tooltip inside the stage (flip it left / up near the right / bottom edge)
  useLayoutEffect(() => {
    const el = hoverRef.current, host = canvasHostRef.current
    if (!el || !host || !hover) return
    const W = host.clientWidth, H = host.clientHeight, w = el.offsetWidth, h = el.offsetHeight
    el.style.left = `${hover.x + 14 + w > W - 6 ? Math.max(6, hover.x - 14 - w) : hover.x + 14}px`
    el.style.top = `${hover.y + 14 + h > H - 6 ? Math.max(6, hover.y - 14 - h) : hover.y + 14}px`
  }, [hover])
  useEffect(() => { updateOverlays() }, [pin, sharedCursor, updateOverlays])

  const openInSlices = (p: PointInfo) => {
    // the picked structure decides first (a rib -> bone window, a lung lobe -> lung window), then the look
    const lung = p.group === 'lungs' || presetKey === 'lungs' || (presetKey === 'mip' && win[0] + win[1] / 2 < -100)
    const wnd = p.group === 'bones' ? 'bone' : lung ? 'lung'
      : presetKey === 'skeleton' || presetKey === 'mip' ? 'bone' : p.volume === 'heart' ? 'mediastinum' : 'soft'
    const series = p.volume === 'heart' ? 'calcium' : lung ? 'thin_lung' : 'axial_st'
    navigate(`/slices?series=${series}&lps=${p.lps.map((v) => v.toFixed(1)).join(',')}&plane=axial&window=${wnd}`)
  }

  // ------------------------------------------------------------------ actions
  const choosePreset = (k: PresetKey) => {
    setPresetKey(k)
    setHover(null)
    // an X-ray pick describes a whole line of sight; in a 3D look it becomes an ordinary point (the same spot)
    if (pin?.ray && presetByKey(k).mode !== 'drr') setPin(describe(pin.lps, pin.volume))
  }
  useEffect(() => {
    const [path, qs] = window.location.hash.replace(/^#/, '').split('?')
    if (path !== '/volume') return
    const q = new URLSearchParams(qs ?? '')
    if (q.get('preset') === presetKey) return
    q.set('preset', presetKey)
    history.replaceState(history.state, '', `#/volume?${q.toString()}`)
  }, [presetKey])
  const flyTo = (v: ViewName) => rRef.current?.flyTo(v)
  const resetView = () => { setClip(FULL_CLIP); rRef.current?.flyTo(preset.view) }
  const saveImage = async () => {
    const r = rRef.current
    if (!r) return
    const blob = await r.snapshot()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-chest-ct-${presetKey}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled
  const toggleFullscreen = () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.().catch(() => undefined)
  }

  // ------------------------------------------------------------------ legend
  const legendItems = useMemo(() => {
    if (preset.mode === 'label') {
      return GROUP_ORDER.filter((g) => groups[g]).map((g) => ({ color: GROUP_INFO[g].color, label: GROUP_INFO[g].label, note: g === 'lungs' || g === 'body' ? 'glass' : undefined }))
    }
    if (preset.mode === 'mip') {
      return [
        { color: '#ffffff', label: `White ≥ ${Math.round(win[0] + win[1])} HU`, note: win[0] + win[1] > 600 ? 'bone' : 'dense' },
        { color: '#7a7f86', label: `Grey ≈ ${Math.round(win[0] + win[1] / 2)} HU` },
        { color: '#000000', label: `Black ≤ ${Math.round(win[0])} HU`, ring: true },
      ]
    }
    return preset.legend.map((it) => {
      if (it.color) return { color: it.color === 'transparent' ? 'transparent' : it.color, label: it.label, note: it.note, ring: it.color === 'transparent' }
      const hu = it.hu ?? 0
      const shifted = preset.pivot + tweak.s1 + (hu - preset.pivot) * tweak.s2
      const c = points ? evalTF(points, shifted) : [0.5, 0.5, 0.5, 1]
      return { color: rgbToCss([linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])]), label: it.label, note: it.note }
    })
  }, [preset, groups, win, points, tweak.s1, tweak.s2])

  const hist = preset.volume === 'heart' ? histRef.current.heart : histRef.current.chest
  const gm = gridOf(preset.volume)
  const sizeMM: Vec3 = [gm.dims[0] * gm.spacing[0], gm.dims[1] * gm.spacing[1], gm.dims[2] * gm.spacing[2]]
  const fmtClip = (axis: number) => (v: [number, number]) => {
    const total = Math.round(sizeMM[axis])
    if (v[0] <= 0.001 && v[1] >= 0.999) return `all ${total} mm`
    return `keeps ${Math.round((v[1] - v[0]) * sizeMM[axis])} of ${total} mm`
  }
  const clipChanged = clip.some(([a, b]) => a > 0.001 || b < 0.999)
  const chestOpen = sameClip(clip, OPEN_CHEST)
  // a failed heart-scan download only blocks the heart look; every chest look keeps working
  const shownError = error && (error.scope !== 'heart' || preset.volume === 'heart') ? error : null

  // ------------------------------------------------------------------ render
  const fmtS = (spec: Preset['s1']) => (v: number) => {
    if (spec.unit === '×') return `${v.toFixed(2)}×`
    const s = spec.label === 'Shift' || spec.label === 'Exposure' ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) : String(v)
    return `${s} ${spec.unit}`
  }

  return (
    <div className="viewer vol-root">
      <div className="stage vol-stage" ref={stageRef}>
        <div className="vol-canvas-host" ref={canvasHostRef} role="img"
          aria-label={`3D volume rendering of the CT scan, ${preset.name} style. Drag to rotate, scroll to zoom, click a spot to identify it.`}
          onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
          onPointerLeave={() => setHover(null)} />
        <div className="vol-refine" ref={refineRef} data-state="refining" aria-hidden />

        {/* title */}
        <div className="vol-title">
          <div className="eyebrow">Volume rendering · {preset.volume === 'heart' ? 'heart scan' : 'chest scan'}</div>
          <div className="vol-title-row">
            <h2>{preset.name}</h2>
            {preset.usesLabels && preset.mode !== 'drr' && preset.mode !== 'mip' && (
              <span className="chip info" title="Some structures are shaped or coloured using the AI segmentation (an estimate).">AI labels</span>
            )}
          </div>
          <div className="vol-quick">
            {presetKey === 'cinematic' && (
              <button className={`vol-qbtn ${chestOpen ? 'on' : ''}`} onClick={() => setClip(chestOpen ? FULL_CLIP : OPEN_CHEST)}
                title="Cut away the front of the chest wall to look straight at the heart">
                {chestOpen ? 'Close the chest' : 'Open the chest'}
              </button>
            )}
            {presetKey === 'heart' && (
              <button className={`vol-qbtn ${isolateHeart ? 'on' : ''}`} onClick={() => setIsolateHeart((v) => !v)}
                title="Show only the heart and great vessels (AI label), or the whole 16 cm heart-scan box">
                {isolateHeart ? 'Heart only' : 'Whole scan box'}
              </button>
            )}
            {presetKey === 'anatomy' && (
              <button className={`vol-qbtn ${groups.bones ? 'on' : ''}`} onClick={() => setGroups((g) => ({ ...g, bones: !g.bones }))}>
                {groups.bones ? 'Hide bones' : 'Show bones'}
              </button>
            )}
            {preset.mode === 'drr' && (
              <>
                <button className="vol-qbtn" onClick={() => flyTo('front')}>Front</button>
                <button className="vol-qbtn" onClick={() => flyTo('left')}>Lateral</button>
              </>
            )}
            {preset.mode === 'mip' && (
              <button className={`vol-qbtn ${clipChanged ? 'on' : ''}`}
                onClick={() => { if (clipChanged) { setClip(FULL_CLIP); setTweak({ s1: preset.s1.def, s2: preset.s2.def }) } else { setTweak({ s1: -330, s2: 1150 }); setClip(LUNG_SLAB); flyTo('front') } }}
                title="A 3 cm coronal slab through the lungs with a lung window">
                {clipChanged ? 'Whole volume' : 'Lung vessel slab'}
              </button>
            )}
          </div>
        </div>

        {/* stage tools */}
        <div className="vol-tools">
          <button className={`btn small ${autoRotate ? 'cyan' : 'ghost'}`} onClick={() => setAutoRotate((a) => !a)} disabled={reducedMotion}
            title={reducedMotion ? 'Off because your system asks for reduced motion' : 'Spin slowly around the body'}>
            <IconSpin /> <span className="hide-sm">Auto-rotate</span>
          </button>
          <button className="btn small ghost" onClick={resetView} title="Reset camera and clip box"><IconReset /> <span className="hide-sm">Reset</span></button>
          <button className="btn small ghost" onClick={() => void saveImage()} title="Save this view as a PNG image" aria-label="Save image"><IconCamera /></button>
          {canFullscreen && <button className="btn small ghost" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen"><IconFull /></button>}
        </div>

        {/* orientation markers */}
        <span className="vol-mark l" ref={(el) => { markRef.current.l = el }} />
        <span className="vol-mark r" ref={(el) => { markRef.current.r = el }} />
        <span className="vol-mark t" ref={(el) => { markRef.current.t = el }} />
        <span className="vol-mark b" ref={(el) => { markRef.current.b = el }} />

        {/* legend (desktop) */}
        <div className="vol-legend-stage">
          <Legend title={preset.mode === 'label' ? 'Colours = AI labels' : preset.mode === 'drr' ? 'Reading the X-ray' : 'Colour key'} items={legendItems} />
        </div>

        {/* cube + views */}
        <div className="vol-nav">
          <OrientationCube cubeRef={cubeRef} onPick={flyTo} />
          <div className="vol-views">
            <button className="btn small ghost" onClick={() => flyTo('front')} title="Look from the front">Front</button>
            <button className="btn small ghost" onClick={() => flyTo('left')} title="Look from the patient's left side">Side</button>
            <button className="btn small ghost" onClick={() => flyTo('top')} title="Look down from the head">Top</button>
          </div>
        </div>

        {/* pinned point marker + card */}
        <div className="vol-pin-mark" ref={pinMarkRef} style={{ display: 'none' }}><span /></div>
        <div className="vol-pin-mark shared" ref={sharedMarkRef} style={{ display: 'none' }} title="Shared crosshair: the last point you picked, here earlier or on another page (e.g. Slices)"><span /></div>
        {pin ? (
          <div className="vol-pin panel">
            <button className="vol-pin-x" onClick={() => setPin(null)} aria-label="Close">×</button>
            <div className="eyebrow">{pin.ray ? 'What casts this shadow' : 'Picked point'}</div>
            <div className="vol-pin-name">{pin.name}{pin.group && <span className="muted"> · AI label</span>}</div>
            {pin.ray ? (
              <>
                <div className="vol-pin-row" title="Share of the virtual X-ray absorption summed along this whole line of sight (bone counts extra, as on a real film)">
                  <b className="mono">{pct(pin.ray.share)}</b> <span className="muted">of the X-ray absorption along this line of sight</span>
                </div>
                {pin.ray.also.length > 0 && (
                  <div className="vol-pin-also muted">Also on it: {pin.ray.also.map((a) => `${a.name} ${pct(a.share)}`).join(' · ')}</div>
                )}
              </>
            ) : (
              <div className="vol-pin-row">
                {pin.hu !== null && <span><b className="mono">{pin.hu > 0 ? '+' : ''}{pin.hu} HU</b> <span className="muted">≈ {pin.tissue}</span></span>}
              </div>
            )}
            <div className="mono muted vol-pin-lps" title={`Patient coordinates in millimetres (L = left, P = posterior, S = superior)${pin.ray ? ', in the middle of this structure along the ray' : ''}`}>{fmtLps(pin.lps)} mm</div>
            <button className="btn small cyan" onClick={() => openInSlices(pin)}>Open this point in Slices →</button>
          </div>
        ) : (
          <div className={`vol-hint ${touched ? 'gone' : ''}`}>
            <span className="vol-hint-mouse">Drag to rotate · scroll or pinch to zoom · right-drag to pan · click a spot to identify it</span>
            <span className="vol-hint-touch">Drag to rotate · pinch to zoom · tap to identify</span>
          </div>
        )}

        {hover && !pin && (
          <div className="tooltip vol-hover" ref={hoverRef}>
            <b>{hover.name}</b>{hover.group && <span className="muted"> · AI label</span>}
            {hover.ray
              ? <div className="muted"><span className="mono">{pct(hover.ray.share)}</span> of the X-ray absorption here</div>
              : hover.hu !== null && <div className="muted"><span className="mono">{hover.hu > 0 ? '+' : ''}{hover.hu} HU</span> · {hover.tissue}</div>}
          </div>
        )}

        {load && <LoaderOverlay label={load.label} loaded={load.loaded} total={load.total} />}
        {shownError && (
          <div className="vol-error">
            <div className="card">
              <h3 style={{ color: 'var(--danger)' }}>{shownError.scope === 'heart' ? 'The heart close-up could not load' : 'The 3D renderer hit a problem'}</h3>
              <p className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{shownError.msg}</p>
              <div className="row wrap" style={{ gap: 8 }}>
                {shownError.scope === 'heart' && (
                  <button className="btn small cyan" onClick={() => choosePreset('cinematic')}>Show the chest scan instead</button>
                )}
                <button className="btn small" onClick={() => window.location.reload()}>Reload</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ side panel */}
      <aside className="side vol-side">
        <div className="group vol-presets-group">
          <div className="eyebrow">Look</div>
          <div className="vol-presets">
            {PRESETS.map((p) => {
              const disabled = p.volume === 'heart' && !m.heartRender
              return (
                <button key={p.key} data-preset={p.key} disabled={disabled} className={`vol-preset ${p.key === presetKey ? 'on' : ''}`}
                  onClick={() => choosePreset(p.key)} title={p.tagline}>
                  <span className="sw" style={{ background: p.swatch }} />
                  <span className="txt"><span className="nm">{p.name}</span><span className="tg">{p.tagline}</span></span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="group">
          <p className="vol-blurb">{preset.blurb.replace('{n}', String(classes.length))}</p>
        </div>

        <div className="vol-legend-side">
          <Legend title="Colour key" items={legendItems} />
        </div>

        {/* transfer function / window */}
        {preset.mode !== 'label' && (
          <div className="group">
            <h3>{preset.mode === 'tf' ? 'Transfer function' : preset.mode === 'mip' ? 'Window' : 'Film'}</h3>
            {(preset.mode === 'tf' || preset.mode === 'mip') && (
              <>
                <TFStrip points={points} hist={hist} huMin={gm.huMin} huMax={gm.huMax}
                  mipWindow={preset.mode === 'mip' ? [win[0], win[0] + win[1]] : null}
                  onShift={preset.mode === 'tf' ? (d) => setTweaks((t) => ({ ...t, [presetKey]: { ...t[presetKey], s1: clamp(Math.round(t[presetKey].s1 + d), preset.s1.min, preset.s1.max) } })) : undefined} />
                <p className="vol-cap">
                  {preset.mode === 'tf'
                    ? 'Curve = opacity, fill = colour, grey = how much of this scan sits at each density (HU). Drag the chart to slide it.'
                    : 'Grey ramp from black to white across the window, over this scan’s density histogram.'}
                </p>
              </>
            )}
            <div className="vol-sliders">
              <span title={preset.s1.hint}><Slider label={preset.s1.label} value={tweak.s1} min={preset.s1.min} max={preset.s1.max} step={preset.s1.step} format={fmtS(preset.s1)} onChange={(v) => setTweak({ s1: v })} /></span>
              <span title={preset.s2.hint}><Slider label={preset.s2.label} value={tweak.s2} min={preset.s2.min} max={preset.s2.max} step={preset.s2.step} format={fmtS(preset.s2)} onChange={(v) => setTweak({ s2: v })} /></span>
              {preset.showOpacity && (
                <span title="Multiplies every opacity in the transfer function. Lower = more see-through.">
                  <Slider label="Opacity" value={tweak.opacity} min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setTweak({ opacity: v })} />
                </span>
              )}
              {presetKey === 'cinematic' && (
                <span title="Opacity of the AI-labelled body wall (skin, fat and muscle outside the ribs). 100% = a normal solid render.">
                  <Slider label="Body wall" value={bodyWall} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={setBodyWall} />
                </span>
              )}
              {presetKey === 'lungs' && (
                <span title="How strongly the glass lung surfaces show.">
                  <Slider label="Lobe glass" value={glass} min={0} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setGlass} />
                </span>
              )}
            </div>
            {preset.mode === 'mip' && (
              <div className="row wrap" style={{ gap: 6, margin: '2px 0 8px' }}>
                <button className="btn small" title="Bone window" onClick={() => setTweak({ s1: 450, s2: 1600 })}>Bone</button>
                <button className="btn small" title="A 3 cm coronal slab through the lungs with a lung window: the vessel tree, like the radiologist's MIP series"
                  onClick={() => { setTweak({ s1: -330, s2: 1150 }); setClip(LUNG_SLAB); flyTo('front') }}>Lung vessel slab</button>
                <button className="btn small ghost" onClick={() => { setTweak({ s1: preset.s1.def, s2: preset.s2.def }); setClip(FULL_CLIP) }}>Full</button>
              </div>
            )}
            {preset.mode === 'drr' && (
              <div className="row wrap" style={{ gap: 6, margin: '2px 0 8px' }}>
                <button className="btn small" onClick={() => flyTo('front')} title="Like a PA chest X-ray">Front (PA-like)</button>
                <button className="btn small" onClick={() => flyTo('left')} title="Like a lateral chest X-ray">Lateral</button>
              </div>
            )}
            {presetKey === 'heart' && (
              <Toggle label="Isolate the heart (AI label)" checked={isolateHeart} onChange={setIsolateHeart} />
            )}
            {presetKey === 'skeleton' && (
              <Toggle label="Costal cartilage (AI label)" checked={cartilage} onChange={setCartilage} swatch="#bfe3dc" />
            )}
            {(preset.mode === 'tf' || preset.mode === 'mip' || preset.mode === 'drr') && (
              <button className="btn small ghost vol-resetbtn" onClick={() => setTweak({ s1: preset.s1.def, s2: preset.s2.def, opacity: 1 })}>Reset sliders</button>
            )}
          </div>
        )}

        {preset.mode === 'label' && (
          <div className="group">
            <h3>Show</h3>
            {GROUP_ORDER.map((g) => (
              <span key={g} title={GROUP_INFO[g].hint}>
                <Toggle label={GROUP_INFO[g].label} swatch={GROUP_INFO[g].color} checked={groups[g]} onChange={(v) => setGroups((s) => ({ ...s, [g]: v }))} />
              </span>
            ))}
            <span title="How strongly the glass surfaces (lungs, pericardial sac, skin) show.">
              <Slider label="Glass" value={glass} min={0} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setGlass} />
            </span>
          </div>
        )}

        <div className="group">
          <h3>Clip box</h3>
          <RangeSlider label="Right ↔ Left" value={clip[0]} ends={['R', 'L']} onChange={(v) => setClip([v, clip[1], clip[2]])}
            format={fmtClip(0)} title="Cut away the patient's right or left side" />
          <RangeSlider label="Front ↔ Back" value={clip[1]} ends={['A', 'P']} onChange={(v) => setClip([clip[0], v, clip[2]])}
            format={fmtClip(1)} title="Cut away the front (anterior) or back (posterior)" />
          <RangeSlider label="Feet ↔ Head" value={clip[2]} ends={['I', 'S']} onChange={(v) => setClip([clip[0], clip[1], v])}
            format={fmtClip(2)} title="Cut away the bottom (inferior) or top (superior)" />
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {preset.volume === 'chest' && (
              <button className="btn small" onClick={() => setClip(OPEN_CHEST)} title="Remove the front of the chest wall to look straight at the heart">Open the chest</button>
            )}
            <button className="btn small" onClick={() => setClip([clip[0], clip[1], [0, 0.5]])} title="Keep only the lower half: look down onto a cross-section">Half slab</button>
            <button className="btn small ghost" disabled={!clipChanged} onClick={() => setClip(FULL_CLIP)}>Reset clip</button>
          </div>
        </div>

        <div className="group">
          <h3>Rendering</h3>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }} title="Smaller ray steps and more refinement passes when the view is still">Quality</span>
            <Segmented<Quality> value={quality} onChange={setQuality}
              options={(Object.keys(QUALITY) as Quality[]).map((q) => ({ value: q, label: QUALITY[q].label, title: `Ray step ${QUALITY[q].step}× voxel, ${QUALITY[q].frames} refinement passes` }))} />
          </div>
          {(preset.mode === 'tf') && (
            <>
              <Toggle label="Lighting (headlight)" checked={lighting} onChange={setLighting} />
              {lighting && <Toggle label="Soft shadows (when still)" checked={shadows} onChange={setShadows} />}
            </>
          )}
          {!reducedMotion && <Toggle label="Auto-rotate" checked={autoRotate} onChange={setAutoRotate} />}
          <div className="vol-views-side">
            {(['front', 'left', 'right', 'back', 'top', 'bottom'] as ViewName[]).map((v) => (
              <button key={v} className="btn small ghost" onClick={() => flyTo(v)}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
        </div>

        <div className="group vol-about">
          <h3>About this volume</h3>
          <table className="data">
            <tbody>
              <tr><td>Source</td><td>{preset.volume === 'heart' ? 'Calcium-score heart scan (ECG-gated)' : 'Thin lung series, smoothed'}</td></tr>
              <tr><td>Grid</td><td className="mono">{gm.dims.join(' × ')} voxels</td></tr>
              <tr><td>Voxel</td><td className="mono">{gm.spacing.map((s) => s.toFixed(2)).join(' × ')} mm</td></tr>
              <tr><td>Box</td><td className="mono">{sizeMM.map((s) => Math.round(s)).join(' × ')} mm</td></tr>
            </tbody>
          </table>
          <p className="vol-cap">
            HU = Hounsfield units, the CT density scale: air −1000, fat ≈ −100, water 0, muscle/blood ≈ +40, bone +300 and up.
            This was a scan without contrast dye, so blood and heart muscle look alike.
          </p>
          <p className="disclaimer">Not a medical device. The official radiologist report is what counts.</p>
        </div>
      </aside>
    </div>
  )
}

const VIEW_LABEL: Record<ViewName, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Head', bottom: 'Feet', hero: 'Hero', heroHeart: 'Hero' }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** LPS bounding box of the voxels whose label is in `ids` (strided scan). */
function labelBoundsLps(g: GridMeta, data: Uint8Array, ids: Set<number>): { min: Vec3; max: Vec3 } | null {
  const [nx, ny, nz] = g.dims
  const lut = new Uint8Array(256)
  for (const id of ids) lut[id] = 1
  let x0 = nx, y0 = ny, z0 = nz, x1 = -1, y1 = -1, z1 = -1
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j += 2) {
    const row = (k * ny + j) * nx
    for (let i = 0; i < nx; i += 2) {
      if (lut[data[row + i]]) {
        if (i < x0) x0 = i; if (i > x1) x1 = i
        if (j < y0) y0 = j; if (j > y1) y1 = j
        if (k < z0) z0 = k; if (k > z1) z1 = k
      }
    }
  }
  if (x1 < 0) return null
  const a = indexToLps(g, [x0 - 1, y0 - 1, z0 - 1]), b = indexToLps(g, [x1 + 2, y1 + 2, z1 + 1])
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] }
}

function gridBoxLps(g: GridMeta): { min: Vec3; max: Vec3 } {
  const a = indexToLps(g, [-0.5, -0.5, -0.5]), b = indexToLps(g, [g.dims[0] - 0.5, g.dims[1] - 0.5, g.dims[2] - 0.5])
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] }
}

/** Most common label in the 3x3x3 neighbourhood that passes `ok` (preferring `preferGroup`). */
function nearbySpecificLabel(g: GridMeta, data: Uint8Array, lps: Vec3, ok: (id: number) => boolean, preferGroup: string | null,
  classById: Map<number, LabelClass>): number | null {
  const c = lpsToIndex(g, lps).map(Math.round)
  const counts = new Map<number, number>()
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = c[0] + dx, j = c[1] + dy, k = c[2] + dz
    if (i < 0 || j < 0 || k < 0 || i >= g.dims[0] || j >= g.dims[1] || k >= g.dims[2]) continue
    const id = data[i + g.dims[0] * (j + g.dims[1] * k)]
    if (!ok(id)) continue
    const w = preferGroup && classById.get(id)?.group === preferGroup ? 100 : 1
    counts.set(id, (counts.get(id) ?? 0) + w)
  }
  let best: number | null = null, bestN = 0
  for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n }
  return best
}

function sampleU8(g: GridMeta, data: Uint8Array, lps: Vec3): number | null {
  const ijk = lpsToIndex(g, lps).map(Math.round)
  if (ijk.some((v, a) => v < 0 || v >= g.dims[a])) return null
  return data[ijk[0] + g.dims[0] * (ijk[1] + g.dims[1] * ijk[2])]
}

function IconSpin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />
    </svg>
  )
}
function IconReset() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
    </svg>
  )
}
function IconCamera() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
function IconFull() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  )
}
