/** React chrome around the GL stage: per-view corner text + scrubbers, toolbar, status bar, hint. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LabelClass, Manifest, Vec3 } from '../../lib/data'
import type { CalciumCandidate, CalciumReport } from '../../lib/reports'
import { sampleNearest } from '../../lib/coords'
import { useApp } from '../../lib/store'
import { cpuLabelGrid, cpuLesionGrid, cpuVolume, type SliceController } from './controller'
import { buildDeepLink } from './deeplink'
import { clamp, nearest, PLANE_ORDER, PLANES, type SlotModel } from './geom'
import { Icon } from './icons'
import { candidateClassLabel, DEFAULT_PARTNER, fmt0, fmt1, huTissue, PRESET_BY_KEY } from './presets'
import { useHover, useLoad, useSlc, type SlabMode } from './state'

const SLAB_LABEL: Record<SlabMode, string> = { none: '', mip: 'MIP', minip: 'MinIP', avg: 'Average' }

// ------------------------------------------------------------------ per-view chrome
export function ViewChrome(props: { sl: SlotModel; ctrl: SliceController | null; multi: boolean; canEnlarge: boolean }) {
  const { sl, ctrl, multi, canEnlarge } = props
  const win = useSlc((s) => s.win)
  const slab = useSlc((s) => s.slab)
  const slabMM = useSlc((s) => s.slabMM)
  const active = useSlc((s) => s.active === sl.i)
  const set = useSlc((s) => s.set)
  const r = sl.rect
  const compact = r.w < 330 || r.h < 230
  const tiny = r.w < 220 || r.h < 170
  const [L, R, T, B] = sl.def.letters
  const pos = sl.u * Math.sign(sl.def.scroll[sl.def.axis]) // position along the LPS axis of the normal
  const preset = win.preset ? PRESET_BY_KEY[win.preset].label : 'Custom'
  return (
    <div
      className={`slc-chrome ${active && multi ? 'active' : ''} ${compact ? 'compact' : ''} ${tiny ? 'tiny' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
    >
      <div className="slc-scrim top" />
      <div className="slc-scrim bot" />
      <div className="slc-c tl">
        <div className="slc-badge-row">
          <span className={`slc-badge ${sl.partner ? 'partner' : ''}`} title={`${sl.def.label} plane`}>{tiny ? sl.def.short : sl.def.label}</span>
          {canEnlarge && (
            <button className="slc-mini" title={`Make the ${sl.def.label.toLowerCase()} view the big one`} onClick={() => set({ plane: sl.plane })}>
              <Icon.expand />
            </button>
          )}
        </div>
        {!tiny && <div className="slc-ser" title={sl.meta.blurb}>{sl.meta.label}</div>}
        {!compact && (
          <div className="slc-dim" title="Reconstruction kernel · slice thickness · voxel grid">
            {sl.meta.kernel || 'AI-derived'} · {sl.meta.sliceThickness} mm · {sl.meta.dims.join('×')}
          </div>
        )}
      </div>
      <div className="slc-c tr" title={`Slice number along ${sl.def.scrollHint}, and the plane's position in scanner coordinates (mm)`}>
        <div className="slc-slice"><span className="k">{tiny ? '' : 'Slice '}</span>{sl.n}<span className="k"> / {sl.ax.n}</span></div>
        {!tiny && <div className="slc-pos">{sl.def.axisLetter} {fmt1(pos)} mm</div>}
        {slab !== 'none' && <div className="slc-slab">{SLAB_LABEL[slab]} {slabMM} mm</div>}
      </div>
      <div className="slc-c bl" title="Window width / level in Hounsfield units (HU): the density range mapped from black to white">
        <div>W {fmt0(win.w)} · L {fmt0(win.c)} <span className="k">HU</span></div>
        {!compact && <div className="k">{preset} window</div>}
      </div>
      <div className="slc-c br" title="Zoom relative to fitting the whole scan in the view">
        {sl.zoom.toFixed(sl.zoom < 10 ? 1 : 0)}×
      </div>
      <span className="slc-ori l">{L}</span>
      <span className="slc-ori r">{R}</span>
      <span className="slc-ori t">{T}</span>
      <span className="slc-ori b">{B}</span>
      {sl.ax.n > 1 && <Scrubber n={sl.n} N={sl.ax.n} label={`${sl.def.label} slice`} onSet={(n) => { set({ active: sl.i }); ctrl?.setSlice(sl.i, n) }} />}
    </div>
  )
}

function Scrubber(props: { n: number; N: number; label: string; onSet: (n: number) => void }) {
  const { n, N, onSet } = props
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [hot, setHot] = useState(false)
  const fromY = (clientY: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = clamp((clientY - r.top - 6) / Math.max(1, r.height - 12), 0, 1)
    onSet(1 + Math.round(t * (N - 1)))
  }
  const pct = N > 1 ? (n - 1) / (N - 1) : 0
  return (
    <div
      ref={ref}
      className={`slc-scrub ${hot ? 'hot' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={1}
      aria-valuemax={N}
      aria-valuenow={n}
      title={`${props.label}: drag to scroll (${n} of ${N})`}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
        dragging.current = true
        setHot(true)
        fromY(e.clientY)
      }}
      onPointerMove={(e) => { if (dragging.current) fromY(e.clientY) }}
      onPointerUp={() => { dragging.current = false; setHot(false) }}
      onPointerCancel={() => { dragging.current = false; setHot(false) }}
      onWheel={(e) => { e.stopPropagation(); onSet(n + Math.sign(e.deltaY)) }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'PageDown' ? 10 : e.key === 'PageUp' ? -10 : 0
        if (d) { e.preventDefault(); e.stopPropagation(); onSet(n + d) }
      }}
    >
      <div className="track"><div className="fill" style={{ height: `${pct * 100}%` }} /></div>
      <div className="thumb" style={{ top: `calc(6px + ${pct} * (100% - 12px))` }}>
        <span className="tip">{n}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ toolbar
export function Toolbar(props: { ctrl: SliceController | null }) {
  const layout = useSlc((s) => s.layout)
  const plane = useSlc((s) => s.plane)
  const tool = useSlc((s) => s.tool)
  const cine = useSlc((s) => s.cine)
  const set = useSlc((s) => s.set)
  const resetViews = useSlc((s) => s.resetViews)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const enterCompare = () => {
    const slc = useSlc.getState()
    const main = useApp.getState().sliceSeries
    const keys = useApp.getState().manifest?.volumes.map((v) => v.key) ?? []
    const auto = DEFAULT_PARTNER[main] ?? keys.find((k) => k !== main) ?? main
    const partner = slc.partnerChosen && slc.partner !== main ? slc.partner : auto
    set({ layout: 'compare', layoutChosen: true, partner })
  }

  const share = async () => {
    const app = useApp.getState()
    const slc = useSlc.getState()
    const cur = app.cursor ?? app.manifest?.worldCenterLPS ?? [0, 0, 0]
    const hash = buildDeepLink(app.sliceSeries, cur as Vec3, slc.plane, slc.win)
    history.replaceState(null, '', hash)
    const url = location.href
    try {
      await navigator.clipboard.writeText(url)
      setToast('Link to this exact view copied')
    } catch {
      setToast('Link is in the address bar')
    }
  }

  return (
    <div className="slc-toolbar" role="toolbar" aria-label="Slice viewer tools">
      <div className="seg slc-seg" role="group" aria-label="Layout">
        <button className={layout === '3up' ? 'on' : ''} title="Three planes at once: axial, coronal and sagittal" onClick={() => set({ layout: '3up', layoutChosen: true })}>
          <Icon.layout3 /><span className="lbl">3-up</span>
        </button>
        <button className={layout === 'single' ? 'on' : ''} title="One big view" onClick={() => set({ layout: 'single', layoutChosen: true })}>
          <Icon.single /><span className="lbl">Single</span>
        </button>
        <button className={layout === 'compare' ? 'on' : ''} title="Two series side by side, synced (e.g. lung vs AI vessel-suppressed)" onClick={() => enterCompare()}>
          <Icon.compare /><span className="lbl">Compare</span>
        </button>
      </div>
      <div className="seg slc-seg" role="group" aria-label={layout === '3up' ? 'Big view plane' : 'Plane'}>
        {PLANE_ORDER.map((p) => (
          <button key={p} className={plane === p ? 'on' : ''} title={layout === '3up' ? `Show the ${p} plane in the big view` : `${PLANES[p].label} plane`} onClick={() => set({ plane: p })}>
            <span className="lbl-long">{PLANES[p].label}</span><span className="lbl-short">{PLANES[p].short}</span>
          </button>
        ))}
      </div>
      <div className="seg slc-seg" role="group" aria-label="Tool">
        <button className={tool === 'cross' ? 'on' : ''} title="Crosshair: click or drag to aim all views at a point" onClick={() => set({ tool: 'cross' })}>
          <Icon.cross /><span className="lbl">Crosshair</span>
        </button>
        <button className={tool === 'ruler' ? 'on' : ''} title="Ruler: drag across the image to measure a distance in mm" onClick={() => set({ tool: 'ruler' })}>
          <Icon.ruler /><span className="lbl">Ruler</span>
        </button>
      </div>
      <button className={`btn small ${cine ? 'cyan' : ''}`} title="Cine: play through the slices of the active view" onClick={() => set({ cine: !cine })} aria-pressed={cine}>
        {cine ? <Icon.pause /> : <Icon.play />}<span className="lbl">Cine</span>
      </button>
      <div className="grow" />
      <button className="btn small ghost slc-hide-sm" title="Zoom out (−)" onClick={() => props.ctrl?.zoomActive(0.8)}><Icon.zoomOut /></button>
      <button className="btn small ghost slc-hide-sm" title="Zoom in (+)" onClick={() => props.ctrl?.zoomActive(1.25)}><Icon.zoomIn /></button>
      <button className="btn small ghost" title="Reset zoom and pan in every view (or double-click a view)" onClick={() => resetViews()}>
        <Icon.reset /><span className="lbl">Reset</span>
      </button>
      <button className="btn small ghost" title="Copy a link to exactly this view (series, point, plane, window)" onClick={share}>
        <Icon.link /><span className="lbl">Share</span>
      </button>
      {toast && <div className="slc-toast" role="status">{toast}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ status bar (hover probe / crosshair readout)
export function StatusBar(props: { manifest: Manifest; calcium: CalciumReport | null }) {
  const { manifest, calcium } = props
  const hover = useHover((s) => s.hover)
  const cursor = useApp((s) => s.cursor) ?? manifest.worldCenterLPS
  const shown = useLoad((s) => s.shown)
  const labelsReady = useLoad((s) => s.labelsReady)
  const req = useApp((s) => s.sliceSeries)
  const slab = useSlc((s) => s.slab)
  const classes = useMemo(() => new Map<number, LabelClass>(manifest.labels.classes.map((c) => [c.id, c])), [manifest])
  const cands = useMemo(() => new Map<number, CalciumCandidate>((calcium?.candidates ?? []).map((c) => [c.id, c])), [calcium])

  const info = useMemo(() => {
    if (hover) return { ...hover, mode: 'pointer' as const }
    const key = shown.main ?? req
    const meta = manifest.volumes.find((v) => v.key === key)
    const vol = cpuVolume(key)
    const lab = cpuLabelGrid()
    const les = cpuLesionGrid()
    return {
      slot: 0, p: cursor as Vec3, series: key,
      hu: meta && vol ? nearest(meta, vol, cursor as Vec3) : null,
      label: lab ? sampleNearest(manifest.labels, lab, cursor as Vec3) ?? 0 : 0,
      lesion: les && manifest.lesions ? sampleNearest(manifest.lesions, les, cursor as Vec3) ?? 0 : 0,
      mode: 'crosshair' as const,
    }
    // (labelsReady is a dependency so the readout refreshes once the label grid arrives)
  }, [hover, cursor, shown, req, manifest, labelsReady])

  const glError = useLoad((s) => s.glError)
  const cls = info.label ? classes.get(info.label) : undefined
  const cand = info.lesion ? cands.get(info.lesion) : undefined
  const lesCls = info.lesion ? manifest.lesions?.classes.find((c) => c.id === info.lesion) : undefined
  if (glError) return <div className="slc-status"><span className="muted">Slice viewer unavailable on this device.</span></div>
  return (
    <div className="slc-status" aria-live="off">
      <span className={`slc-mode ${info.mode}`} title={info.mode === 'pointer' ? 'Values under the mouse pointer' : 'Values at the crosshair (move the pointer over the image to probe)'}>
        {info.mode === 'pointer' ? 'Pointer' : 'Crosshair'}
      </span>
      <span className="slc-st-struct" title="AI anatomy label at this point (TotalSegmentator family of models)">
        <span className="sw" style={{ background: cls?.color ?? 'transparent', borderColor: cls ? 'transparent' : 'var(--line-2)' }} />
        {cls ? cls.display : <span className="faint">{labelsReady ? 'no label' : 'labels loading…'}</span>}
      </span>
      <span className="slc-st-hu" title="CT density in Hounsfield units (HU): air −1000, fat ≈ −100, water 0, blood ≈ 40, bone 400+">
        {info.hu === null ? <span className="faint">— HU</span> : <>
          <b>{fmt0(info.hu)}</b> HU{slab !== 'none' && <span className="faint"> ({SLAB_LABEL[slab]})</span>}
          <span className="muted"> · {huTissue(info.hu)}</span>
        </>}
      </span>
      {cand && (
        <span className="slc-st-cand" title="Calcium candidate from the DIY calcium pipeline (see the Calcium page)">
          <span className="sw round" style={{ background: lesCls?.color ?? 'var(--amber)' }} />
          <span className="slc-wide">Candidate </span>#{cand.id} · {candidateClassLabel(cand.finalClass ?? cand.ruleClass)}<span className="slc-wide"> · peak {fmt0(cand.peakHU)} HU</span>
        </span>
      )}
      <span className="grow" />
      <span className="slc-st-lps" title="Patient coordinates in mm (DICOM LPS: +L = patient's left, +P = toward the back, +S = toward the head)">
        L {fmt1(info.p[0])} · P {fmt1(info.p[1])} · S {fmt1(info.p[2])} mm
      </span>
    </div>
  )
}

// ------------------------------------------------------------------ onboarding hint
export function Hint(props: { rect: { x: number; y: number; w: number; h: number } }) {
  const r = props.rect
  const interacted = useLoad((s) => s.interacted)
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 14000)
    return () => clearTimeout(t)
  }, [])
  if (interacted || gone || r.w < 200) return null
  return (
    <div className="slc-hint" role="note" style={{ left: r.x + r.w / 2, top: r.y + r.h - (r.h > 420 ? 104 : 92), maxWidth: r.w - 24 }}>
      {coarse ? (
        <>Drag to aim the crosshair · pinch to zoom · slide the bar on the right through the slices · double-tap to reset</>
      ) : (
        <><b>Scroll</b> to move through slices · <b>click/drag</b> to aim the crosshair · <b>right-drag</b> for contrast · <b>Ctrl+scroll</b> to zoom</>
      )}
    </div>
  )
}
