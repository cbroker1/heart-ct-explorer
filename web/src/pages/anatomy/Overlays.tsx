/** DOM overlays on top of the 3D stage: presets, tools, camera views, hover tooltip, selection card. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Manifest, MeshNode, Vec3 } from '../../lib/data'
import type { CalciumCandidate, CalciumReport } from '../../lib/reports'
import { fmtLps, lpsToWorld, worldToLps } from '../../lib/coords'
import { showInSlices, sliceGroupFor } from './actions'
import { tissueFor } from './ct'
import { blurbFor, CAND_COLORS, CAND_LABEL, groupLabel, PRESETS, sourceLabel, VIEWS } from './meta'
import { captureScreenshot, flyToStructure, presetView, rig, setView, shiftView } from './rig'
import { useAnat } from './state'
import { fmtVol } from './Sidebar'
import { LabelLayer } from './labels'

const Icon = {
  rotate: <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" /></svg>,
  labels: <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1.6" fill="currentColor" /></svg>,
  camera: <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M4 7h3.5L9 5h6l1.5 2H20v12H4z" /><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>,
  home: <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M4 11.5 12 4l8 7.5V20h-5.5v-5h-5v5H4z" /></svg>,
  close: <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden><path stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>,
}

function PresetBar() {
  const preset = useAnat((s) => s.preset)
  const apply = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    useAnat.getState().applyPreset(key)
    setView(p.view)
  }
  return (
    <div className="ana-presets" role="toolbar" aria-label="Presets">
      {PRESETS.map((p) => (
        <button key={p.key} className={`ana-chip${preset === p.key ? ' on' : ''}${p.key === 'xray' ? ' xr' : ''}`} title={p.hint} onClick={() => apply(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  )
}

function Toolbar() {
  const autoRotate = useAnat((s) => s.autoRotate)
  const labels = useAnat((s) => s.labels)
  const set = useAnat((s) => s.set)
  return (
    <div className="ana-tools" role="toolbar" aria-label="View tools">
      <button className={`ana-ib${autoRotate ? ' on' : ''}`} onClick={() => set({ autoRotate: !autoRotate })} title="Auto-rotate" aria-label="Auto-rotate" aria-pressed={autoRotate}>{Icon.rotate}</button>
      <button className={`ana-ib${labels ? ' on' : ''}`} onClick={() => set({ labels: !labels })} title="Floating labels" aria-label="Floating labels" aria-pressed={labels}>{Icon.labels}</button>
      <button className="ana-ib" onClick={() => setView(presetView())} title="Reset the view" aria-label="Reset the view">{Icon.home}</button>
      <button className="ana-ib" onClick={() => captureScreenshot()} title="Download a PNG screenshot" aria-label="Download a PNG screenshot">{Icon.camera}</button>
    </div>
  )
}

function ViewBar() {
  return (
    <div className="ana-views" role="toolbar" aria-label="Camera views">
      {VIEWS.map((v) => (
        <button key={v.key} onClick={() => setView(v.key)} title={v.title}>
          <span className="ana-vl">{v.label}</span><span className="ana-vs">{v.short}</span>
        </button>
      ))}
    </div>
  )
}

const huText = (hu: number | null | undefined) => (hu === null || hu === undefined ? null : `≈ ${Math.round(hu)} HU · ${tissueFor(hu)}`)

function Tooltip({ stageRef, nodes, cands }: { stageRef: RefObject<HTMLDivElement | null>; nodes: Map<string, MeshNode>; cands: Map<number, CalciumCandidate> }) {
  const hover = useAnat((s) => s.hover)
  const ref = useRef<HTMLDivElement>(null)
  const pos = useRef({ x: -999, y: -999, w: 0, h: 0 })
  const place = () => {
    const el = ref.current
    if (!el) return
    const p = pos.current
    const r = el.getBoundingClientRect()
    let x = p.x + 16, y = p.y + 18
    if (x + r.width > p.w - 8) x = p.x - r.width - 14
    if (y + r.height > p.h - 8) y = p.y - r.height - 14
    el.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`
  }
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      pos.current = { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
      place()
    }
    el.addEventListener('pointermove', move)
    return () => el.removeEventListener('pointermove', move)
  }, [stageRef])
  useLayoutEffect(place)
  if (!hover || (hover.kind === 'structure' && hover.src === 'list')) return null
  let body: ReactNode = null
  if (hover.kind === 'structure') {
    const n = nodes.get(hover.name)
    if (!n) return null
    body = (
      <>
        <div className="t1"><span className="ana-sw" style={{ background: n.color }} />{n.display}</div>
        <div className="t2">{groupLabel(n.group)} · <span className="mono">{fmtVol(n.volumeML)} mL</span> <span className="faint">(AI estimate)</span></div>
        {hover.hu !== undefined && huText(hover.hu) && <div className="t3 mono">CT on the cut {huText(hover.hu)}</div>}
      </>
    )
  } else if (hover.kind === 'candidate') {
    const c = cands.get(hover.id)
    if (!c) return null
    body = (
      <>
        <div className="t1"><span className="ana-sw round" style={{ background: CAND_COLORS[c.finalClass] ?? CAND_COLORS.other }} />Calcium candidate #{c.id}</div>
        <div className="t2">Peak <span className="mono">{Math.round(c.peakHU)} HU</span> · <span className="mono">{c.volume_mm3.toFixed(1)} mm³</span></div>
        <div className="t3">Verdict: <b>{CAND_LABEL[c.finalClass] ?? c.finalClass}</b></div>
      </>
    )
  } else {
    const n = hover.name ? nodes.get(hover.name) : undefined
    body = (
      <>
        <div className="t1"><span className="ana-sw ct" />Your CT on the cut</div>
        <div className="t2 mono">{huText(hover.hu) ?? 'outside the scan'}</div>
        {n && <div className="t3">AI label here: <span style={{ color: n.color }}>{n.display}</span></div>}
      </>
    )
  }
  return <div ref={ref} className="tooltip ana-tip">{body}</div>
}

/** Height of the preset-chip row on phones (the picture is centred in the space below it). */
const CHIPS_H = 44

function Card({ manifest, nodes, cands, threshold }: { manifest: Manifest; nodes: Map<string, MeshNode>; cands: Map<number, CalciumCandidate>; threshold: number }) {
  const sel = useAnat((s) => s.selection)
  const select = useAnat((s) => s.select)
  const setVisible = useAnat((s) => s.setVisible)
  const isolate = useAnat((s) => s.isolate)
  const ref = useRef<HTMLDivElement>(null)
  // When the card hides a big part of a small 3D view, slide the picture into the part that is still
  // visible (above the card on phones, left of it on narrow screens); slide it back when it closes.
  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.parentElement
    if (!el || !stage) return
    const s = stage.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    let left = 0, up = 0
    if (r.width > s.width * 0.8) up = Math.max(0, (s.height - CHIPS_H - (r.top - s.top)) / 2)
    else if (r.width > s.width * 0.3) left = Math.max(0, (s.right - r.left) / 2)
    if (left < 4 && up < 4) return
    shiftView(left, up)
    return () => shiftView(0, 0)
  }, [sel])
  if (!sel) return null
  const close = <button className="ana-ib sm ana-card-x" onClick={() => select(null)} aria-label="Close">{Icon.close}</button>
  if (sel.kind === 'candidate') {
    const c = cands.get(sel.id)
    if (!c) return null
    const host = c.chamber ? nodes.get(c.chamber) : undefined
    const color = CAND_COLORS[c.finalClass] ?? CAND_COLORS.other
    const counted = c.finalClass === 'coronary'
    return (
      <div ref={ref} className="ana-card panel" role="dialog" aria-label={`Calcium candidate ${c.id}`}>
        {close}
        <div className="eyebrow" style={{ color }}>Calcium candidate</div>
        <h3>#{c.id} · {CAND_LABEL[c.finalClass] ?? c.finalClass}</h3>
        <div className="ana-stats">
          <div><b className="mono">{Math.round(c.peakHU)}</b><small>HU peak</small></div>
          <div><b className="mono">{c.volume_mm3.toFixed(1)}</b><small>mm³</small></div>
          <div><b className="mono">{c.nSlices}</b><small>{c.nSlices === 1 ? 'slice' : 'slices'}</small></div>
        </div>
        <p className="ana-blurb">
          A spot brighter than {threshold} HU found {host ? <>in the <b>{host.display}</b> region</> : 'near the heart'}.{' '}
          {counted
            ? 'It counts toward the DIY coronary calcium score.'
            : c.finalClass === 'review'
              ? 'The rules flagged it for a closer look; it is not counted in the current DIY score.'
              : 'It does not count toward the coronary calcium score.'}
        </p>
        {(c.reviewNote || c.ruleReasons?.length > 0) && (
          <ul className="ana-reasons">
            {c.reviewNote ? <li>{c.reviewNote}</li> : c.ruleReasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <div className="ana-card-actions">
          <button className="btn small cyan" onClick={() => showInSlices(manifest, lpsToWorld(c.centerLPS, manifest.worldCenterLPS), 'calcium')}>Show in slices →</button>
        </div>
      </div>
    )
  }
  const n = nodes.get(sel.name)
  if (!n) return null
  const s = rig.structures.find((x) => x.name === n.name)
  const point: Vec3 | null = sel.point ?? (s ? (s.centroid.clone().add(s.anchor).toArray() as Vec3) : null)
  const src = sourceLabel(n)
  return (
    <div ref={ref} className="ana-card panel" role="dialog" aria-label={n.display}>
      {close}
      <div className="eyebrow"><span className="ana-sw" style={{ background: n.color }} />{groupLabel(n.group)}</div>
      <h3>{n.display}</h3>
      <div className="ana-stats">
        <div title="Volume inside the scanned slab, measured on the AI segmentation"><b className="mono">{fmtVol(n.volumeML)}</b><small>mL · AI estimate</small></div>
        <div className="ana-tri" title="Number of triangles in this 3D surface"><b className="mono">{(n.triangles / 1000).toFixed(1)}k</b><small>triangles</small></div>
      </div>
      <p className="ana-blurb">{blurbFor(n)}</p>
      {sel.point && (
        <p className={`ana-where mono${sel.hu != null ? ' has-hu' : ''}`} title="Patient coordinates of the point you clicked (DICOM LPS millimetres)">
          <span className="ana-pt">{sel.viaCT ? 'Picked on the CT cut' : 'Picked point'} · {fmtLps(worldToLps(sel.point, manifest.worldCenterLPS))}</span>
          {sel.hu != null && <span>CT density {huText(sel.hu)}</span>}
        </p>
      )}
      {src && <p className="ana-src">Traced by {src}</p>}
      <div className="ana-card-actions">
        {point && <button className="btn small cyan" onClick={() => showInSlices(manifest, point, sliceGroupFor(n.name, n.group))}>Show in slices →</button>}
        <button className="btn small" onClick={() => { isolate(n.name); if (s) flyToStructure(s) }} title="Show only this structure">Isolate</button>
        <button className="btn small ghost" onClick={() => { setVisible(n.name, false); select(null) }}>Hide</button>
      </div>
    </div>
  )
}

function Hint() {
  const [show, setShow] = useState(true)
  const touch = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, [])
  const hasSel = useAnat((s) => !!s.selection)
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 9000)
    const off = () => setShow(false)
    window.addEventListener('wheel', off, { once: true })
    // The first drag/tap on the 3D view means the gesture has been found.
    const canvas = rig.gl?.domElement
    canvas?.addEventListener('pointerdown', off, { once: true })
    return () => { clearTimeout(t); window.removeEventListener('wheel', off); canvas?.removeEventListener('pointerdown', off) }
  }, [])
  useEffect(() => { if (hasSel) setShow(false) }, [hasSel])
  return (
    <div className={`ana-hint${show ? '' : ' gone'}`} aria-hidden={!show}>
      {touch ? 'One finger to orbit · pinch to zoom · tap any structure' : 'Drag to orbit · scroll to zoom · right-drag to pan · click any structure'}
    </div>
  )
}

export function Overlays({ manifest, calcium, stageRef, ct }: {
  manifest: Manifest
  calcium: CalciumReport | null
  stageRef: RefObject<HTMLDivElement | null>
  ct: { loading: boolean; loaded: number; total: number }
}) {
  const nodes = useMemo(() => new Map(manifest.meshes.nodes.map((n) => [n.name, n])), [manifest])
  const cands = useMemo(() => new Map((calcium?.candidates ?? []).map((c) => [c.id, c])), [calcium])
  const ready = useAnat((s) => s.ready)
  const clipOn = useAnat((s) => s.clip.enabled)
  const pct = ct.total ? Math.round((100 * ct.loaded) / ct.total) : 0
  return (
    <div className={`ana-ov${ready ? ' ready' : ''}`}>
      <LabelLayer nodes={nodes} />
      <PresetBar />
      <Toolbar />
      <ViewBar />
      <Tooltip stageRef={stageRef} nodes={nodes} cands={cands} />
      <Card manifest={manifest} nodes={nodes} cands={cands} threshold={Number(calcium?.method.thresholdHU ?? 130)} />
      {clipOn && ct.loading && <div className="ana-toast mono">Loading your CT for the cut · {pct}%</div>}
      {ready && <Hint />}
    </div>
  )
}
