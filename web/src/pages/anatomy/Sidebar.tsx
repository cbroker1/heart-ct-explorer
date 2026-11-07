/** Right-hand panel: structures by group, cut-away + CT, explode, layers. */
import { useMemo, useState, type ReactNode } from 'react'
import type { Manifest, MeshNode } from '../../lib/data'
import type { CalciumReport } from '../../lib/reports'
import { Segmented, Slider, Toggle } from '../../components/ui'
import { CAND_COLORS, CAND_LABEL, GROUPS, WINDOWS, type ClipAxis, type SliceMode, type WindowKey } from './meta'
import { flyToStructure, rig } from './rig'
import { effectiveOpacity, useAnat } from './state'

export const fmtVol = (v?: number) => (v === undefined ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(1))

function Section(props: { id: string; title: string; sub?: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <section className={`ana-sec${open ? ' open' : ''}`} id={`ana-sec-${props.id}`}>
      <button className="ana-sec-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ana-caret" aria-hidden>▸</span>
        <span className="ana-sec-t">{props.title}</span>
        {props.right}
      </button>
      {open && <div className="ana-sec-b">{props.sub && <div className="ana-sec-sub">{props.sub}</div>}{props.children}</div>}
    </section>
  )
}

function Check(props: { checked: boolean; partial?: boolean; onChange: (v: boolean) => void; label: string; color?: string }) {
  return (
    <button
      className={`ana-check${props.checked ? ' on' : ''}${props.partial ? ' part' : ''}`}
      role="checkbox"
      aria-checked={props.partial ? 'mixed' : props.checked}
      aria-label={props.label}
      title={props.checked ? `Hide ${props.label}` : `Show ${props.label}`}
      style={props.color ? ({ ['--c' as string]: props.color }) : undefined}
      onClick={(e) => { e.stopPropagation(); props.onChange(!props.checked) }}
    />
  )
}

function StructureRow({ n }: { n: MeshNode }) {
  const vis = useAnat((s) => !!s.visible[n.name])
  const sel = useAnat((s) => s.selection?.kind === 'structure' && s.selection.name === n.name)
  const hov = useAnat((s) => s.hover?.kind === 'structure' && s.hover.name === n.name)
  const setVisible = useAnat((s) => s.setVisible)
  const setHover = useAnat((s) => s.setHover)
  const select = useAnat((s) => s.select)
  const focus = () => {
    if (!vis) setVisible(n.name, true)
    select({ kind: 'structure', name: n.name, point: null })
    const s = rig.structures.find((x) => x.name === n.name)
    if (s) flyToStructure(s)
  }
  return (
    <li
      className={`ana-row${vis ? '' : ' off'}${sel ? ' sel' : ''}${hov ? ' hov' : ''}`}
      onMouseEnter={() => setHover({ kind: 'structure', name: n.name, src: 'list' })}
      onMouseLeave={() => setHover(null)}
    >
      <Check checked={vis} onChange={(v) => setVisible(n.name, v)} label={n.display} color={n.color} />
      <button className="ana-row-name" onClick={focus} title={`Select ${n.display} and fly to it`}>
        <span className="ana-sw" style={{ background: n.color }} />
        <span className="ana-nm">{n.display}</span>
      </button>
      <span className="ana-vol mono" title="Volume of this structure inside the scanned slab, from the AI segmentation (AI estimate)">
        {fmtVol(n.volumeML)}<small> mL</small>
      </span>
    </li>
  )
}

function GroupBlock({ g, nodes, forceOpen }: { g: (typeof GROUPS)[number]; nodes: MeshNode[]; forceOpen: boolean }) {
  const open = useAnat((s) => !!s.open[g.key]) || forceOpen
  const toggleOpen = useAnat((s) => s.toggleOpen)
  const nVis = useAnat((s) => nodes.filter((n) => s.visible[n.name]).length)
  const go = useAnat((s) => s.groupOpacity[g.key] ?? s.groupDefault[g.key] ?? 1)
  const setGroupVisible = useAnat((s) => s.setGroupVisible)
  const setGroupOpacity = useAnat((s) => s.setGroupOpacity)
  const total = nodes.length
  const groupTotal = useAnat((s) => s.nodes.filter((n) => n.group === g.key).length)
  return (
    <div className={`ana-group${open ? ' open' : ''}`}>
      <div className="ana-ghead">
        <Check checked={nVis > 0} partial={nVis > 0 && nVis < groupTotal} onChange={(v) => setGroupVisible(g.key, v)} label={g.label} color={g.color} />
        <button className="ana-gname" onClick={() => toggleOpen(g.key)} aria-expanded={open} title={g.blurb}>
          <span className="ana-caret" aria-hidden>▸</span>
          {g.label}
          <span className="ana-gcount mono">{nVis}/{total}</span>
        </button>
        <input
          className="ana-gop"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={go}
          aria-label={`${g.label} opacity`}
          title={`${g.label} opacity: ${Math.round(go * 100)}%`}
          style={{ ['--pct' as string]: `${go * 100}%` }}
          onChange={(e) => setGroupOpacity(g.key, Number(e.target.value))}
        />
        <span className="ana-gop-v mono">{Math.round(go * 100)}%</span>
      </div>
      {open && (
        <ul className="ana-list">
          {nodes.map((n) => <StructureRow key={n.name} n={n} />)}
        </ul>
      )}
    </div>
  )
}

function StructuresSection() {
  const nodes = useAnat((s) => s.nodes)
  const search = useAnat((s) => s.search)
  const set = useAnat((s) => s.set)
  const q = search.trim().toLowerCase()
  const groups = useMemo(() => GROUPS.map((g) => ({
    g,
    nodes: nodes.filter((n) => n.group === g.key && (!q || n.display.toLowerCase().includes(q) || n.name.replace(/_/g, ' ').includes(q))),
  })).filter((x) => x.nodes.length), [nodes, q])
  return (
    <Section id="structures" title="Structures" right={<span className="ana-sec-r mono">{nodes.length}</span>}
      sub={<>Toggle, fade or click any structure. Volumes are <b>AI estimates</b> of the part inside the scan.</>}>
      <div className="ana-search">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden><path fill="none" stroke="currentColor" strokeWidth="2" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.3-2.2L21 21" /></svg>
        <input value={search} onChange={(e) => set({ search: e.target.value })} placeholder="Search, e.g. aorta, rib, lobe…" aria-label="Search structures" />
        {search && <button className="ana-x" onClick={() => set({ search: '' })} aria-label="Clear search">×</button>}
      </div>
      {groups.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No structure matches “{search}”.</p>}
      {groups.map((x) => <GroupBlock key={x.g.key} g={x.g} nodes={x.nodes} forceOpen={!!q} />)}
    </Section>
  )
}

const AXES: { value: ClipAxis; label: string; title: string }[] = [
  { value: 'axial', label: 'Axial', title: 'Horizontal cut (like the slices of the scan)' },
  { value: 'coronal', label: 'Coronal', title: 'Front-to-back cut, like looking at the chest from the front' },
  { value: 'sagittal', label: 'Sagittal', title: 'Side-to-side cut, like looking from the side' },
]
const SLICE_MODES: { value: SliceMode; label: string; title: string }[] = [
  { value: 'full', label: 'Full slice', title: 'Show the whole CT slice on the cut (air is see-through)' },
  { value: 'caps', label: 'Cut faces', title: 'Show the CT only inside the cut structures' },
  { value: 'off', label: 'Model only', title: 'Solid coloured cut faces, no CT' },
]

export function posLabel(axis: ClipAxis, v: number) {
  const a = Math.abs(v).toFixed(0)
  if (Math.abs(v) < 0.5) return 'heart centre'
  if (axis === 'axial') return `${a} mm ${v > 0 ? 'above' : 'below'}`
  if (axis === 'coronal') return `${a} mm ${v > 0 ? 'anterior' : 'posterior'}`
  return `${a} mm to the ${v > 0 ? 'left' : 'right'}`
}

type CTStatus = { loading: boolean; loaded: number; total: number; error: string | null; ready: boolean; retry?: () => void }

function ClipSection({ ct }: { ct: CTStatus }) {
  const clip = useAnat((s) => s.clip)
  const setClip = useAnat((s) => s.setClip)
  const setClipPos = useAnat((s) => s.setClipPos)
  const bounds = useAnat((s) => s.bounds)
  const explode = useAnat((s) => s.explode)
  const sweep = useAnat((s) => s.sweep)
  const set = useAnat((s) => s.set)
  const ai = clip.axis === 'axial' ? 1 : clip.axis === 'coronal' ? 2 : 0
  const min = bounds ? Math.floor(bounds.min[ai]) : -150
  const max = bounds ? Math.ceil(bounds.max[ai]) : 150
  const keep = clip.axis === 'axial' ? (clip.flip ? 'upper' : 'lower') : clip.axis === 'coronal' ? (clip.flip ? 'front' : 'back') : clip.flip ? 'left' : 'right'
  const pct = ct.total ? Math.round((100 * ct.loaded) / ct.total) : 0
  return (
    <Section id="clip" title="Cut-away + real CT"
      right={<span className={`ana-pill${clip.enabled ? ' on' : ''}`}>{clip.enabled ? 'ON' : 'OFF'}</span>}
      sub={<>Slice the model open. Your <b>actual CT image</b> is painted on the cut, exactly where it was scanned.</>}>
      <Toggle label="Cut the model" checked={clip.enabled} onChange={(v) => setClip({ enabled: v })} />
      <div className={`ana-clip${clip.enabled ? '' : ' dim'}`}>
        <Segmented value={clip.axis} options={AXES} onChange={(v) => setClip({ axis: v, enabled: true })} />
        <Slider label={`Position · ${posLabel(clip.axis, clip.pos[clip.axis])}`} value={clip.pos[clip.axis]} min={min} max={max} step={0.5}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} mm`} onChange={(v) => { if (!clip.enabled) setClip({ enabled: true }); setClipPos(v) }} />
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn small" onClick={() => setClip({ flip: !clip.flip, enabled: true })} title="Keep the other half">⇅ Flip · keeping {keep} half</button>
          <button className={`btn small${sweep ? ' cyan' : ''}`} onClick={() => { set({ sweep: !sweep }); if (!clip.enabled) setClip({ enabled: true }) }} title="Sweep the cut through the body">
            {sweep ? '■ Stop' : '▶ Sweep'}
          </button>
        </div>
        <div className="ana-lbl-row">CT on the cut</div>
        <Segmented value={clip.slice} options={SLICE_MODES} onChange={(v) => setClip({ slice: v, enabled: true })} />
        {clip.slice !== 'off' && (
          <>
            <div className="ana-lbl-row">Window</div>
            <Segmented value={clip.window} options={(Object.keys(WINDOWS) as WindowKey[]).map((k) => ({ value: k, label: WINDOWS[k].label, title: WINDOWS[k].title }))}
              onChange={(v) => setClip({ window: v })} />
          </>
        )}
        <Toggle label="Tint cut structures with their colour" checked={clip.tint} onChange={(v) => setClip({ tint: v })} />
        {clip.enabled && ct.loading && (
          <div className="ana-progress" title="Downloading the CT volume used on the cut">
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <span className="mono">Loading CT · {pct}%</span>
          </div>
        )}
        {ct.error && (
          <p className="ana-err">
            Could not load the CT volume ({ct.error}). The cut still works, with plain coloured faces.{' '}
            {ct.retry && <button className="btn small" onClick={ct.retry}>Retry</button>}
          </p>
        )}
        {clip.enabled && ct.ready && clip.slice !== 'off' && (
          <p className="ana-note">Hover the cut to read the CT density (Hounsfield units, HU). The image is the 1.5 mm “render” volume, with the sharper 0.6 mm heart series blended in around the heart.</p>
        )}
        {clip.enabled && explode > 0.01 && clip.slice === 'full' && (
          <p className="ana-note warn">The full CT slice lines up with the model only at Explode 0%. Cut faces follow each exploded structure.</p>
        )}
      </div>
    </Section>
  )
}

function ExplodeSection() {
  const explode = useAnat((s) => s.explode)
  const setExplode = useAnat((s) => s.setExplode)
  return (
    <Section id="explode" title="Explode" sub="Pull the structures apart from the heart centre to see how they fit together.">
      <Slider label="Spread" value={explode} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setExplode} />
    </Section>
  )
}

function LayersSection({ calcium }: { calcium: CalciumReport | null }) {
  const st = {
    calcium: useAnat((s) => s.calcium),
    labels: useAnat((s) => s.labels),
    autoRotate: useAnat((s) => s.autoRotate),
    mode: useAnat((s) => s.mode),
  }
  const set = useAnat((s) => s.set)
  const setMode = useAnat((s) => s.setMode)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const k of calcium?.candidates ?? []) c[k.finalClass] = (c[k.finalClass] ?? 0) + 1
    return c
  }, [calcium])
  const n = calcium?.candidates.length ?? 0
  const coronary = counts.coronary ?? 0
  return (
    <Section id="layers" title="Layers & view">
      <Toggle label="Calcium candidates" checked={st.calcium} onChange={(v) => set({ calcium: v })} />
      {calcium && (
        <div className="ana-cal">
          <p>
            {n} bright spots (≥ {String(calcium.method.thresholdHU ?? 130)} HU) were found around the heart by the DIY calcium scorer.{' '}
            {coronary === 0
              ? <b className="ana-good">None of them were classified as coronary calcium.</b>
              : <b className="ana-warn">{coronary} classified as coronary.</b>}
          </p>
          <div className="ana-chips">
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} className="chip"><span className="dot" style={{ background: CAND_COLORS[k] ?? CAND_COLORS.other }} />{CAND_LABEL[k] ?? k} · {v}</span>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Floating labels" checked={st.labels} onChange={(v) => set({ labels: v })} />
      <Toggle label="Auto-rotate" checked={st.autoRotate} onChange={(v) => set({ autoRotate: v })} />
      <Toggle label="X-ray look (Fresnel glow)" checked={st.mode === 'xray'} onChange={(v) => setMode(v ? 'xray' : 'solid')} />
    </Section>
  )
}

export function Sidebar({ manifest, calcium, ct }: {
  manifest: Manifest
  calcium: CalciumReport | null
  ct: CTStatus
}) {
  const nodes = useAnat((s) => s.nodes)
  const nShown = useAnat((s) => s.nodes.filter((n) => s.visible[n.name] && effectiveOpacity(n, s) > 0.01).length)
  const slabCM = useMemo(() => (((manifest.labels.dims[2] - 1) * manifest.labels.spacing[2] + 1.5) / 10).toFixed(1), [manifest])   // centre span + one 1.5 mm slice
  return (
    <aside className="side ana-side" aria-label="3D anatomy controls">
      <header className="ana-head">
        <div className="eyebrow">3D anatomy · AI segmentation</div>
        <h2>Inside my chest</h2>
        <p className="muted">
          {nodes.filter((n) => n.name !== 'heart').length} structures (plus a whole-heart shell) traced by AI on my CT and turned into 3D surfaces, in true millimetres.
          The scan covers a {slabCM} cm tall slab around the heart.
        </p>
        <div className="ana-head-stat mono" title="Structures currently drawn in the 3D view">
          {nShown} of {nodes.length} structures shown
        </div>
      </header>
      <StructuresSection />
      <ClipSection ct={ct} />
      <ExplodeSection />
      <LayersSection calcium={calcium} />
      <p className="disclaimer ana-disc">
        Shapes and volumes come from automatic AI segmentation of a low-dose, non-contrast scan: approximate, for curiosity and
        education. Not a medical device. The official radiologist report is what counts.
      </p>
    </aside>
  )
}
