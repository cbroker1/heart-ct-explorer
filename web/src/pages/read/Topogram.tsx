/**
 * Findings drawn on the patient's own scout X-rays (CT topograms).
 * Geometry comes from exam.json (DICOM position/orientation/pixel spacing + crop), see lpsToTopo.
 */
import { useMemo, type CSSProperties } from 'react'
import { dataUrl, type Vec3 } from '../../lib/data'
import { lpsToTopo, SEV_SHORT, SEV_TONE, SEVERITIES, type ExamInfo, type NFinding, type Tone, type Topogram } from './model'
import { useRead } from './ctx'

/** Screen-side orientation letters from the row direction cosine (e.g. "R" on the left, "L" on the right). */
function sideLetters(t: Topogram): [string, string] {
  const r = t.orientation.slice(0, 3).map(Number)
  const a = [0, 1, 2].reduce((best, i) => (Math.abs(r[i]) > Math.abs(r[best]) ? i : best), 0)
  const pos = r[a] > 0
  if (a === 0) return pos ? ['R', 'L'] : ['L', 'R']
  if (a === 1) return pos ? ['A', 'P'] : ['P', 'A']
  return pos ? ['I', 'S'] : ['S', 'I']
}

interface Pin { key: string; x: number; y: number; tone: Tone; label: string; title: string; ids: string[] }

function TopoFrame(props: {
  topo: Topogram
  label: string
  pins: Pin[]
  crosshair?: boolean
  showRange?: boolean
  onPick?: (id: string) => void
  outside?: number
}) {
  const { topo, label, pins, crosshair, showRange, onPick, outside } = props
  const { printing } = useRead()
  const W = topo.shape[1], H = topo.shape[0]
  const [left, right] = sideLetters(topo)
  const range = showRange && topo.scanRangeRows ? topo.scanRangeRows : null
  const pctX = (x: number) => `${(100 * x) / W}%`
  const pctY = (y: number) => `${(100 * y) / H}%`
  return (
    <figure className="rd-topo">
      <div className="rd-topo-frame" style={{ aspectRatio: `${W} / ${H}` }}>
        <img src={dataUrl(topo.png)} alt={`Scout X-ray, ${label.toLowerCase()}`} loading={printing ? 'eager' : 'lazy'} decoding="async" draggable={false} />
        {range && (
          <div className="rd-topo-range" style={{ top: pctY(Math.max(0, range[0])), height: pctY(Math.min(H, range[1]) - Math.max(0, range[0])) }}>
            <span>CT range</span>
          </div>
        )}
        {crosshair && pins[0] && (
          <>
            <div className={`rd-topo-hair h rd-tone-${pins[0].tone}`} style={{ top: pctY(pins[0].y) }} />
            <div className={`rd-topo-hair v rd-tone-${pins[0].tone}`} style={{ left: pctX(pins[0].x) }} />
          </>
        )}
        {pins.map((p) => {
          const style: CSSProperties = { left: pctX(p.x), top: pctY(p.y) }
          const cls = `rd-pin rd-tone-${p.tone} ${crosshair ? 'solo' : ''}`
          return onPick ? (
            <button key={p.key} className={cls} style={style} title={p.title} onClick={() => onPick(p.ids[0])} aria-label={`Go to finding ${p.label}: ${p.title}`}>
              <span className="rd-pin-dot" /><span className="rd-pin-label mono">{p.label}</span>
            </button>
          ) : (
            <span key={p.key} className={cls} style={style} title={p.title}><span className="rd-pin-dot" /></span>
          )
        })}
        <span className="rd-topo-side l">{left}</span>
        <span className="rd-topo-side r">{right}</span>
      </div>
      <figcaption>
        {label}
        {!!outside && <span className="faint"> · {outside} outside this view</span>}
      </figcaption>
    </figure>
  )
}

/** Greedy clustering of nearby pins so overlapping findings share one marker. */
function cluster(points: { f: NFinding; x: number; y: number }[], radius: number): Pin[] {
  const groups: { xs: number[]; ys: number[]; fs: NFinding[] }[] = []
  for (const p of points) {
    const g = groups.find((g) => Math.hypot(g.xs[0] - p.x, g.ys[0] - p.y) < radius)
    if (g) { g.xs.push(p.x); g.ys.push(p.y); g.fs.push(p.f) } else groups.push({ xs: [p.x], ys: [p.y], fs: [p.f] })
  }
  return groups.map((g) => {
    const worst = g.fs.reduce((a, f) => (f.severity > a.severity ? f : a), g.fs[0])
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
    return {
      key: g.fs.map((f) => f.id).join('|'),
      x: avg(g.xs),
      y: avg(g.ys),
      tone: SEV_TONE[worst.severity],
      label: g.fs.map((f) => f.n).join(','),
      title: g.fs.map((f) => `#${f.n} ${f.title}`).join('\n'),
      ids: g.fs.map((f) => f.id),
    }
  })
}

/** Overview: every located finding on both scout views. */
export function FindingsMap(props: { exam: ExamInfo | null; findings: NFinding[]; onPick: (id: string) => void }) {
  const { exam, findings, onPick } = props
  const views = useMemo(() => {
    if (!exam) return []
    return exam.topograms.map(({ key, label, topo }) => {
      const W = topo.shape[1], H = topo.shape[0]
      const pts: { f: NFinding; x: number; y: number }[] = []
      let outside = 0
      for (const f of findings) {
        if (!f.link?.lps) continue
        const p = lpsToTopo(topo, f.link.lps)
        if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) { outside++; continue }
        pts.push({ f, ...p })
      }
      return { key, label, topo, pins: cluster(pts, 14), outside }
    })
  }, [exam, findings])

  if (!views.length) return null
  const located = findings.filter((f) => f.link?.lps).length
  return (
    <div className="rd-map card">
      <div className="eyebrow">Where things are</div>
      <h3 className="rd-map-title">Findings on your scout X-rays</h3>
      <div className="rd-map-views">
        {views.map((v) => (
          <TopoFrame key={v.key} topo={v.topo} label={v.label} pins={v.pins} showRange onPick={onPick} outside={v.outside} />
        ))}
      </div>
      <div className="rd-map-legend">
        {SEVERITIES.map((s) => (
          <span key={s} className={`rd-tone-${SEV_TONE[s]}`}><i className="rd-legend-dot" />{SEV_SHORT[s]}</span>
        ))}
        <span className="rd-legend-range"><i />CT range</span>
      </div>
      <p className="rd-map-note">
        {located
          ? <>Numbered pins match the finding numbers below. Tap one to jump to it. </>
          : <>{findings.length ? 'None of the findings shown has a location to plot. ' : 'No findings to plot. '}</>}
        Scouts are the quick, low-dose X-rays the scanner takes first to plan the scan; the shaded band is the part of your body the CT actually covered.
      </p>
    </div>
  )
}

/** Per-finding: a pulsing crosshair on the front and side scouts. */
export function Locator(props: { exam: ExamInfo | null; lps: Vec3; tone: Tone }) {
  const { exam, lps, tone } = props
  if (!exam || !exam.topograms.length) return null
  const frames = exam.topograms
    .map(({ key, label, topo }) => {
      const p = lpsToTopo(topo, lps)
      const W = topo.shape[1], H = topo.shape[0]
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return null
      return { key, label, topo, pin: { key: 'p', x: p.x, y: p.y, tone, label: '', title: label, ids: [] } as Pin }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  if (!frames.length) return null
  return (
    <div className="rd-locator">
      {frames.map((f) => <TopoFrame key={f.key} topo={f.topo} label={f.label} pins={[f.pin]} crosshair />)}
    </div>
  )
}
