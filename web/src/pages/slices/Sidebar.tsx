/** Sidebar: series picker, window, overlays, slab & cine, compare partner, structure finder, measurements. */
import { useMemo, useState } from 'react'
import type { LabelClass, Manifest, Vec3, VolumeMeta } from '../../lib/data'
import { formatBytes } from '../../lib/data'
import type { CalciumReport } from '../../lib/reports'
import { useApp } from '../../lib/store'
import { Segmented, Slider, Toggle } from '../../components/ui'
import { cpuLabelGrid, type ExamCaliperJSON } from './controller'
import { structureIndex } from './finder'
import { dist, dot, nearest, PLANES, sliceAxis, sliceAt, snapToGrid, volumeByKey } from './geom'
import { Icon } from './icons'
import { candidateClassLabel, fmt1, isLungSeries, PRESET_BY_KEY, PRESETS, presetFor } from './presets'
import { useLoad, useSlc, type LabelMode, type SlabMode } from './state'

const GROUP_TITLES: Record<VolumeMeta['group'], string> = {
  heart: 'Heart · ECG-gated',
  chest: 'Chest · soft tissue',
  lung: 'Lung kernels',
  ai: 'AI-processed',
}
const GROUP_ORDER: VolumeMeta['group'][] = ['heart', 'chest', 'lung', 'ai']

const LABEL_GROUPS = ['heart', 'vessels', 'lungs', 'airways', 'bones', 'abdomen', 'muscle', 'body']
const LABEL_GROUP_TITLE: Record<string, string> = {
  heart: 'Heart', vessels: 'Vessels', lungs: 'Lungs', airways: 'Airways', bones: 'Bones',
  abdomen: 'Abdomen', muscle: 'Muscle', body: 'Body wall',
}

const SLAB_HELP: Record<SlabMode, string> = {
  none: 'One thin plane, exactly as reconstructed.',
  mip: 'Maximum intensity: the brightest voxel through the slab wins, so vessels become branching tubes and calcium pops out.',
  minip: 'Minimum intensity: the darkest voxel wins, which traces the air in the airways.',
  avg: 'Average through the slab: smoother and less noisy, like a thicker slice.',
}

/** Pick a series; switch window only when hopping between lung-kernel and soft-tissue series. */
export function pickSeries(m: Manifest, key: string) {
  const app = useApp.getState()
  const prev = volumeByKey(m, app.sliceSeries)
  const next = volumeByKey(m, key)
  if (!next || key === app.sliceSeries) return
  app.setSliceSeries(key)
  if (prev && isLungSeries(prev) !== isLungSeries(next)) {
    const [c, w] = next.defaultWindow
    useSlc.getState().setWindow(c, w, presetFor(c, w))
  }
}

function Section(props: { title: string; children: React.ReactNode; right?: React.ReactNode; id?: string }) {
  return (
    <section className="slc-sec" id={props.id}>
      <div className="slc-sec-h">
        <h4>{props.title}</h4>
        {props.right}
      </div>
      {props.children}
    </section>
  )
}

// ------------------------------------------------------------------ series
function SeriesPicker(props: { manifest: Manifest }) {
  const { manifest } = props
  const current = useApp((s) => s.sliceSeries)
  const entries = useLoad((s) => s.entries)
  return (
    <Section title="Series" right={<span className="slc-sec-note">{manifest.volumes.length} reconstructions</span>}>
      {GROUP_ORDER.map((g) => {
        const vols = manifest.volumes.filter((v) => v.group === g)
        if (!vols.length) return null
        return (
          <div key={g} className="slc-sgroup">
            <div className="slc-sgroup-t">{GROUP_TITLES[g]}</div>
            {vols.map((v) => {
              const e = entries[v.key]
              const busy = e && (e.phase === 'download' || e.phase === 'upload')
              const pct = busy && e.total ? (100 * e.loaded) / e.total : 0
              return (
                <button key={v.key} className={`slc-series ${v.key === current ? 'on' : ''}`} onClick={() => pickSeries(manifest, v.key)} aria-pressed={v.key === current}>
                  <div className="row1">
                    <span className="name">{v.label}</span>
                    <span className="size" title={e?.phase === 'ready' ? 'Loaded and on the GPU' : e?.phase === 'cpu' ? 'Downloaded: switching back is instant' : 'Download size (compressed)'}>
                      {e?.phase === 'ready' ? <span className="slc-ok"><Icon.check /> loaded</span> : e?.phase === 'cpu' ? <span className="slc-cached">cached</span> : formatBytes(v.bytes)}
                    </span>
                  </div>
                  <div className="meta" title="Reconstruction kernel · slice thickness · voxel grid">
                    {v.kernel || 'AI'} · {v.sliceThickness} mm · {v.dims.join('×')}
                  </div>
                  <div className="blurb">{v.blurb}</div>
                  {busy && <div className="slc-pbar"><div style={{ width: `${pct}%` }} /></div>}
                  {e?.phase === 'error' && <div className="slc-err">{e.error}</div>}
                </button>
              )
            })}
          </div>
        )
      })}
    </Section>
  )
}

// ------------------------------------------------------------------ window
function WindowSection() {
  const win = useSlc((s) => s.win)
  const setWindow = useSlc((s) => s.setWindow)
  const hint = win.preset ? PRESET_BY_KEY[win.preset].hint : 'Custom window. Pick a preset to snap back.'
  return (
    <Section title="Window" right={<span className="slc-sec-note mono">W {Math.round(win.w)} · L {Math.round(win.c)}</span>}>
      <div className="slc-presets">
        {PRESETS.map((p) => (
          <button key={p.key} className={`slc-chip ${win.preset === p.key ? 'on' : ''}`} title={`${p.label}: centre ${p.c} HU, width ${p.w} HU. ${p.hint}`} onClick={() => setWindow(p.c, p.w, p.key)}>
            {p.label}
          </button>
        ))}
        <span className={`slc-chip ghost ${win.preset ? '' : 'on'}`} title="Drag with the right mouse button (or Shift+drag) on the image">Custom</span>
      </div>
      <Slider label="Level (centre)" value={Math.round(win.c)} min={-1000} max={1500} step={5} format={(v) => `${v} HU`} onChange={(v) => setWindow(v, win.w, presetFor(v, win.w))} />
      <Slider label="Width" value={Math.round(win.w)} min={10} max={4000} step={10} format={(v) => `${v} HU`} onChange={(v) => setWindow(win.c, v, presetFor(win.c, v))} />
      <p className="slc-cap">{hint} <span className="faint">Right-drag or Shift+drag on the image to fine-tune.</span></p>
    </Section>
  )
}

// ------------------------------------------------------------------ overlays
function OverlaySection(props: { manifest: Manifest }) {
  const s = {
    labels: useSlc((x) => x.labels),
    labelMode: useSlc((x) => x.labelMode),
    labelOpacity: useSlc((x) => x.labelOpacity),
    hiddenGroups: useSlc((x) => x.hiddenGroups),
    hoverIdentify: useSlc((x) => x.hoverIdentify),
    calcHi: useSlc((x) => x.calcHi),
    lesions: useSlc((x) => x.lesions),
    set: useSlc((x) => x.set),
  }
  const labelsReady = useLoad((x) => x.labelsReady)
  const lesionsReady = useLoad((x) => x.lesionsReady)
  const lesionLegend = useMemo(() => {
    const m = new Map<string, { color: string; n: number }>()
    for (const c of props.manifest.lesions?.classes ?? []) {
      const e = m.get(c.group) ?? { color: c.color, n: 0 }
      e.n++
      m.set(c.group, e)
    }
    return [...m.entries()]
  }, [props.manifest])
  const toggleGroup = (g: string) =>
    s.set({ hiddenGroups: s.hiddenGroups.includes(g) ? s.hiddenGroups.filter((x) => x !== g) : [...s.hiddenGroups, g] })
  return (
    <Section title="Overlays">
      <Toggle label={<>Anatomy labels <span className="faint">(AI){labelsReady ? '' : ' · loading…'}</span></>} checked={s.labels} onChange={(v) => s.set({ labels: v })} />
      {s.labels && (
        <div className="slc-sub">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Segmented<LabelMode> value={s.labelMode} options={[{ value: 'outline', label: 'Outline' }, { value: 'fill', label: 'Fill' }]} onChange={(v) => s.set({ labelMode: v })} />
          </div>
          <Slider label="Opacity" value={s.labelOpacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => s.set({ labelOpacity: v })} />
          <div className="slc-groups" role="group" aria-label="Label groups">
            {LABEL_GROUPS.map((g) => (
              <button key={g} className={`slc-chip small ${s.hiddenGroups.includes(g) ? '' : 'on'}`} onClick={() => toggleGroup(g)} aria-pressed={!s.hiddenGroups.includes(g)}>
                {LABEL_GROUP_TITLE[g]}
              </button>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Name the structure under the pointer" checked={s.hoverIdentify} onChange={(v) => s.set({ hoverIdentify: v })} />
      <Toggle label="≥130 HU calcium threshold" swatch="#ff2b3d" checked={s.calcHi} onChange={(v) => s.set({ calcHi: v })} />
      <p className="slc-cap">Tints every pixel at or above 130 HU, the density the Agatston calcium score counts. Bone lights up too; only spots on the coronary arteries count toward the score.</p>
      <Toggle label={<>Calcium candidates{lesionsReady ? '' : <span className="faint"> · loading…</span>}</>} checked={s.lesions} onChange={(v) => s.set({ lesions: v })} />
      {s.lesions && (
        <div className="slc-legend">
          {lesionLegend.map(([g, e]) => (
            <span key={g} className="slc-leg"><span className="dot" style={{ background: e.color }} />{candidateClassLabel(g)} <span className="faint">×{e.n}</span></span>
          ))}
        </div>
      )}
      <p className="slc-cap">Bright spots the DIY calcium pipeline flagged on the calcium-score series (rings mark their centres). Details and verdicts are on the Calcium page.</p>
    </Section>
  )
}

// ------------------------------------------------------------------ slab + cine
function SlabSection() {
  const slab = useSlc((s) => s.slab)
  const slabMM = useSlc((s) => s.slabMM)
  const cineFps = useSlc((s) => s.cineFps)
  const cine = useSlc((s) => s.cine)
  const set = useSlc((s) => s.set)
  return (
    <Section title="Slab & cine">
      <Segmented<SlabMode>
        value={slab}
        options={[
          { value: 'none', label: 'Off' },
          { value: 'mip', label: 'MIP', title: 'Maximum intensity projection' },
          { value: 'minip', label: 'MinIP', title: 'Minimum intensity projection' },
          { value: 'avg', label: 'Average', title: 'Average intensity' },
        ]}
        onChange={(v) => set({ slab: v })}
      />
      {slab !== 'none' && (
        <Slider label="Slab thickness" value={slabMM} min={2} max={40} step={1} format={(v) => `${v} mm`} onChange={(v) => set({ slabMM: v })} />
      )}
      <p className="slc-cap">{SLAB_HELP[slab]}</p>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <button className={`btn small ${cine ? 'cyan' : ''}`} onClick={() => set({ cine: !cine })} aria-pressed={cine} title="Play through the slices of the active view">
          {cine ? <Icon.pause /> : <Icon.play />} {cine ? 'Pause' : 'Play'}
        </button>
        <div className="grow">
          <Slider label="Cine speed" value={cineFps} min={2} max={30} step={1} format={(v) => `${v} slices/s`} onChange={(v) => set({ cineFps: v })} />
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ compare
function CompareSection(props: { manifest: Manifest }) {
  const { manifest } = props
  const partner = useSlc((s) => s.partner)
  const set = useSlc((s) => s.set)
  const main = useApp((s) => s.sliceSeries)
  const mv = volumeByKey(manifest, main)
  const pv = volumeByKey(manifest, partner)
  const story =
    (main === 'thin_lung' && partner === 'cr_vessel_suppress') || (main === 'cr_vessel_suppress' && partner === 'thin_lung')
      ? 'Same slices: on the AI side the lung vessels are digitally erased, so a nodule hiding next to a vessel would stand out. ClearRead found none.'
      : mv && pv && mv.kernel !== pv.kernel && mv.sliceThickness === pv.sliceThickness
        ? 'Same slices, different reconstruction kernel: the sharp kernel shows crisper edges and more noise.'
        : 'Both views share the crosshair, zoom and pan.'
  return (
    <Section title="Compare with">
      <div className="slc-cmp">
        <span className="slc-cmp-a" title={mv?.blurb}>{mv?.label}</span>
        <span className="faint">vs</span>
        <select className="slc-select" value={partner} onChange={(e) => set({ partner: e.target.value, partnerChosen: true })} aria-label="Compare partner series">
          {manifest.volumes.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn small" onClick={() => { pickSeries(manifest, 'thin_lung'); set({ partner: 'cr_vessel_suppress', partnerChosen: true }) }}>Lung vs AI-suppressed</button>
        <button className="btn small" onClick={() => { pickSeries(manifest, 'axial_st'); set({ partner: 'axial_lung', partnerChosen: true }) }}>Soft vs lung kernel</button>
      </div>
      <p className="slc-cap">{story} <span className="faint">Anatomy labels are drawn on the left view only.</span></p>
    </Section>
  )
}

// ------------------------------------------------------------------ structure finder
/**
 * The views show the nearest native slices of the displayed series, so snap the anchor to that grid and,
 * if the snapped point fell outside the structure, nudge it to the nearest grid point that is inside.
 */
function insideOnGrid(m: Manifest, lab: Uint8Array, id: number, anchor: Vec3): Vec3 {
  const v = volumeByKey(m, useLoad.getState().shown.main ?? useApp.getState().sliceSeries)
  if (!v) return anchor
  const p0 = snapToGrid(v, anchor)
  if (nearest(m.labels, lab, p0) === id) return p0
  let best: Vec3 = anchor
  let bestD = Infinity
  const [sx, sy, sz] = v.spacing
  for (let dz = -4; dz <= 4; dz++)
    for (let dy = -24; dy <= 24; dy++)
      for (let dx = -24; dx <= 24; dx++) {
        const q = snapToGrid(v, [p0[0] + dx * sx, p0[1] + dy * sy, p0[2] + dz * sz])
        if (nearest(m.labels, lab, q) !== id) continue
        const d = dist(q, anchor)
        if (d < bestD) { bestD = d; best = q }
      }
  return best
}

function FinderSection(props: { manifest: Manifest }) {
  const { manifest } = props
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const labelsReady = useLoad((s) => s.labelsReady)
  const finderReady = useLoad((s) => s.finderReady)
  const selected = useApp((s) => s.selectedStructure)
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const out = new Map<string, LabelClass[]>()
    for (const c of manifest.labels.classes) {
      if (ql && !c.display.toLowerCase().includes(ql) && !c.name.toLowerCase().includes(ql) && !c.group.includes(ql)) continue
      const arr = out.get(c.group) ?? []
      arr.push(c)
      out.set(c.group, arr)
    }
    return LABEL_GROUPS.filter((g) => out.has(g)).map((g) => [g, out.get(g)!] as const)
  }, [manifest, q])

  const jump = async (c: LabelClass) => {
    const lab = cpuLabelGrid()
    if (!lab) return
    setBusy(c.id)
    try {
      const idx = await structureIndex(manifest.labels, lab)
      const info = idx.get(c.id)
      if (!info) return
      const target = insideOnGrid(manifest, lab, c.id, info.anchor)
      useApp.getState().setSelectedStructure(c.name)
      useApp.getState().setCursor(target)
      useSlc.getState().set({ pendingFocus: { p: target, zoom: null, onlyIfHidden: true } })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Find a structure" id="slc-finder" right={selected ? (
      <button className="btn small ghost" onClick={() => useApp.getState().setSelectedStructure(null)} title="Clear the highlight"><Icon.x /> Clear</button>
    ) : undefined}>
      <label className="slc-search">
        <Icon.search />
        <input type="search" placeholder="Search 60 structures, e.g. aorta" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search anatomy structures" />
      </label>
      {!labelsReady && <p className="slc-cap">Loading the anatomy map…</p>}
      <div className={`slc-finder ${labelsReady ? '' : 'dim'}`}>
        {groups.map(([g, list]) => (
          <div key={g} className="slc-fgroup">
            <div className="slc-sgroup-t">{LABEL_GROUP_TITLE[g] ?? g}</div>
            {list.map((c) => (
              <button key={c.id} className={`slc-fitem ${selected === c.name ? 'on' : ''}`} disabled={!labelsReady} onClick={() => jump(c)} title={`Jump the crosshair into the ${c.display.toLowerCase()} and highlight it`}>
                <span className="sw" style={{ background: c.color }} />
                <span className="nm">{c.display}</span>
                {busy === c.id ? <span className="faint">…</span> : c.volumeML !== undefined && (
                  <span className="vol" title="AI estimate of this structure's volume inside the scanned range (non-contrast, low-dose scan)">{c.volumeML < 10 ? c.volumeML.toFixed(1) : Math.round(c.volumeML)} mL</span>
                )}
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <p className="slc-cap">No structure matches “{q}”.</p>}
      </div>
      {labelsReady && !finderReady && <p className="slc-cap faint">Indexing structures…</p>}
      <p className="slc-cap faint">Volumes are AI estimates from a non-contrast, low-dose scan, and only cover what is inside the scanned range.</p>
    </Section>
  )
}

// ------------------------------------------------------------------ measurements
function MeasureSection(props: { manifest: Manifest; caliper: ExamCaliperJSON | null }) {
  const { manifest, caliper } = props
  const rulers = useSlc((s) => s.rulers)
  const tool = useSlc((s) => s.tool)
  const set = useSlc((s) => s.set)
  const showCaliper = () => {
    if (!caliper) return
    const [a, b] = caliper.pointsLPS
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    const slc = useSlc.getState()
    useApp.getState().setCursor(mid)
    slc.set({ plane: 'axial', pendingFocus: { p: mid, zoom: null, fov: 110, onlyIfHidden: false } })
  }
  const caliperSlice = useMemo(() => {
    if (!caliper) return null
    const v = volumeByKey(manifest, caliper.series)
    if (!v) return null
    return sliceAt(sliceAxis(v, PLANES.axial.scroll), dot(caliper.pointsLPS[0], PLANES.axial.scroll))
  }, [manifest, caliper])
  return (
    <Section title="Measurements">
      {caliper && (
        <div className="slc-caliper">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="slc-cal-v">{caliper.lengthMM.toFixed(1)} <small>mm</small></div>
              <div className="slc-cal-k">Ascending aorta · radiologist's caliper</div>
            </div>
            <button className="btn small" onClick={showCaliper} title="Jump to the slice the radiologist measured"><Icon.target /> Show</button>
          </div>
          <p className="slc-cap">
            The diameter of the main artery leaving the heart, measured by the radiologist on {volumeByKey(manifest, caliper.series)?.label ?? caliper.series}
            {caliperSlice ? <> slice {caliperSlice}</> : null}. It is drawn in amber on any axial view within 2 mm of that slice.
          </p>
        </div>
      )}
      <div className="slc-rulers">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="slc-sgroup-t" style={{ margin: 0 }}>Your rulers</span>
          <div className="row" style={{ gap: 4 }}>
            <button className={`btn small ${tool === 'ruler' ? 'cyan' : ''}`} onClick={() => set({ tool: tool === 'ruler' ? 'cross' : 'ruler' })}><Icon.ruler /> {tool === 'ruler' ? 'Ruler on' : 'Ruler'}</button>
            {rulers.length > 0 && <button className="btn small ghost" onClick={() => set({ rulers: [] })}><Icon.x /> Clear</button>}
          </div>
        </div>
        {rulers.length === 0 ? (
          <p className="slc-cap">Pick the ruler, then drag across the image. Lengths are true millimetres in the patient.</p>
        ) : (
          <ul className="slc-rlist">
            {rulers.map((r, i) => (
              <li key={r.id}>
                <span className="slc-rdot" />
                <span className="mono">{dist(r.a, r.b).toFixed(1)} mm</span>
                <span className="faint">{PLANES[r.plane].label.toLowerCase()} · {PLANES[r.plane].axisLetter} {fmt1(Math.abs(r.u))}</span>
                <span className="grow" />
                <button className="slc-mini2" title="Go to this ruler" onClick={() => {
                  const mid: Vec3 = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2]
                  useApp.getState().setCursor(mid)
                  const slc = useSlc.getState()
                  slc.set({ pendingFocus: { p: mid, zoom: null, onlyIfHidden: true }, ...(slc.layout !== '3up' ? { plane: r.plane } : {}) })
                }}><Icon.target /></button>
                <button className="slc-mini2" title={`Delete ruler ${i + 1}`} onClick={() => set({ rulers: rulers.filter((x) => x.id !== r.id) })}><Icon.x /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ help
function HelpSection() {
  return (
    <Section title="Controls">
      <dl className="slc-keys">
        <dt>Scroll</dt><dd>next / previous slice <span className="faint">(Shift ×5)</span></dd>
        <dt>Click, drag</dt><dd>aim the crosshair; other views follow</dd>
        <dt>Right-drag</dt><dd>contrast (window/level) <span className="faint">or Shift+drag</span></dd>
        <dt>Middle-drag</dt><dd>pan <span className="faint">or Space+drag</span></dd>
        <dt>Ctrl+scroll</dt><dd>zoom <span className="faint">(pinch on touch)</span></dd>
        <dt>Double-click</dt><dd>reset that view</dd>
        <dt>↑ ↓ PgUp PgDn</dt><dd>step slices in the active view <span className="faint">(Home / End: first / last)</span></dd>
        <dt>+ − 0</dt><dd>zoom in / out / reset all views</dd>
        <dt>Esc</dt><dd>leave the ruler tool</dd>
        <dt>Touch</dt><dd>1 finger aims · 2 fingers pan/zoom · double-tap resets</dd>
      </dl>
    </Section>
  )
}

export function Sidebar(props: { manifest: Manifest; calcium: CalciumReport | null; caliper: ExamCaliperJSON | null }) {
  const layout = useSlc((s) => s.layout)
  return (
    <aside className="side slc-side" aria-label="Slice viewer controls">
      <SeriesPicker manifest={props.manifest} />
      {layout === 'compare' && <CompareSection manifest={props.manifest} />}
      <WindowSection />
      <OverlaySection manifest={props.manifest} />
      <SlabSection />
      <FinderSection manifest={props.manifest} />
      <MeasureSection manifest={props.manifest} caliper={props.caliper} />
      <HelpSection />
      <div className="slc-sec">
        <p className="disclaimer" style={{ margin: 0 }}>For curiosity and education. Not a medical device: the official radiologist report is what counts.</p>
      </div>
    </aside>
  )
}
