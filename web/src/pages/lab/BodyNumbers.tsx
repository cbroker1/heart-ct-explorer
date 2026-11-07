// Lab · "My body, by the numbers": opportunistic measurements from biomarkers.json, grouped, each with
// its value, a reference gauge, a plain-English caption, how it was measured, and where on the scan.
import { useMemo, type ReactNode } from 'react'
import { navigate } from '../../components/ui'
import { useApp } from '../../lib/store'
import './core/lab-core.css'
import { useBiomarkers, usePrefersReducedMotion } from './core/hooks'
import { IconAlert, IconShield } from './core/icons'
import { Chambers, Gauge, Levels, Lobes, RadiationViz, Specs } from './core/viz'
import type { BiomarkerReport, ChamberDetail, Confidence, Equivalent, LevelDetail, LobeDetail, Metric, ReportImage, SpecItem } from './core/types'

/** Card footprint in the 3-column grid (collapses to one column on phones). */
const LAYOUT: Record<string, string> = {
  heart_chambers: 'w2 h2',
  liver_hu: 'w2',
  spine_density: 'full',
  lung_volume: 'w2',
  main_pa: 'w2',
  effective_dose: 'w2',
}
/** Metrics drawn inside another card (the liver card shows the spleen and the difference too). */
const MERGED_INTO: Record<string, string> = { spleen_hu: 'liver_hu', liver_minus_spleen: 'liver_hu', pa_ao_ratio: 'main_pa' }
/** Wide cards that put their picture beside the numbers rather than under them. */
const SIDE_IMAGE = new Set(['heart_chambers', 'spine_density', 'lung_volume', 'liver_hu'])

const CONF_CLASS: Record<Confidence, string> = { measured: 'measured', 'AI estimate': 'ai', rough: 'rough' }
const STATUS_COLOR: Record<string, string> = {
  typical: 'var(--green)', borderline: 'var(--amber)', high: 'var(--amber)', low: 'var(--amber)',
}

function ConfChip(props: { c: Confidence; legend?: Record<string, string> }) {
  return <span className={`chip lc-conf ${CONF_CLASS[props.c]}`} title={props.legend?.[props.c]}>{props.c}</span>
}

function StatusTag(props: { m: Metric }) {
  const { m } = props
  if (!m.status || m.status === 'info' || !m.statusLabel) return null
  const col = STATUS_COLOR[m.status] ?? 'var(--muted)'
  return (
    <span className="st" style={{ color: col }}>
      <i style={{ background: col }} />{m.statusLabel}
    </span>
  )
}

const shown = (m: Metric) => m.display ?? (Number.isInteger(m.value) ? m.value.toLocaleString('en-US') : `${m.value}`)

function ValueRow(props: { m: Metric; small?: boolean }) {
  const { m } = props
  return (
    <div className="lc-value">
      <span className="n" style={props.small ? { fontSize: 26 } : undefined}>{shown(m)}</span>
      {m.unit && <span className="u">{m.unit}</span>}
      <StatusTag m={m} />
    </div>
  )
}

function Figure(props: { img?: ReportImage }) {
  if (!props.img) return null
  return (
    <figure className="lc-fig">
      <img src={props.img.src} width={props.img.w} height={props.img.h} alt={props.img.caption} loading="lazy" decoding="async" />
      <figcaption>{props.img.caption}</figcaption>
    </figure>
  )
}

function Method(props: { m: Metric }) {
  return (
    <details>
      <summary>How this was measured</summary>
      <p>{props.m.method}</p>
    </details>
  )
}

function ScanLink(props: { m: Metric }) {
  const l = props.m.link
  if (!l) return null
  const go = () => {
    // same shape as the spec's deep link: #/slices?series=<key>&lps=<x>,<y>,<z>&plane=<p>&window=<preset>
    const parts = [`series=${encodeURIComponent(l.series)}`, `lps=${l.lps.map((v) => v.toFixed(1)).join(',')}`, `plane=${l.plane}`]
    if (l.window) parts.push(`window=${encodeURIComponent(l.window)}`)
    navigate(`/slices?${parts.join('&')}`)
  }
  return <button className="lc-link" onClick={go} title="Open this spot in the slice explorer">See it on the scan →</button>
}

/** Which scan series the number was measured on, by its friendly name (the raw key is jargon). */
function SeriesNote(props: { m: Metric }) {
  const volumes = useApp((s) => s.manifest?.volumes)
  const key = props.m.series
  if (!key) return null
  const label = volumes?.find((v) => v.key === key)?.label
  return (
    <span className="faint" style={{ fontSize: 11 }} title={label ? `Scan series used for this number (${key})` : undefined}>
      {label ? `Measured on: ${label}` : `Source: ${key}`}
    </span>
  )
}

function Viz(props: { m: Metric; report: BiomarkerReport }) {
  const { m } = props
  const d = (m.detail ?? {}) as Record<string, unknown>
  switch (m.viz) {
    case 'chambers':
      return <Chambers chambers={(d.chambers as ChamberDetail[]) ?? []} />
    case 'levels':
      return (
        <>
          {m.gauge && <Gauge gauge={m.gauge} value={m.value} display={shown(m)} unit={m.unit} label={m.label} />}
          <Levels levels={(d.levels as LevelDetail[]) ?? []} thresholds={d.thresholds as { hu: number; label: string }[]} />
        </>
      )
    case 'lobes':
      return <Lobes lobes={(d.lobes as LobeDetail[]) ?? []} clearRead={d.clearRead as { rightL?: number; leftL?: number }} />
    case 'specs':
      return <Specs items={(d.items as SpecItem[]) ?? []} />
    case 'radiation':
      return <RadiationViz mSv={m.value} equivalents={(d.equivalents as Equivalent[]) ?? props.report.radiation?.equivalents ?? []} />
    default:
      return m.gauge ? <Gauge gauge={m.gauge} value={m.value} display={shown(m)} unit={m.unit} label={m.label} /> : null
  }
}

function MetricCard(props: { m: Metric; report: BiomarkerReport; img?: ReportImage }) {
  const { m, report, img } = props
  const layout = LAYOUT[m.key] ?? ''
  const split = SIDE_IMAGE.has(m.key) && img
  const body = (
    <>
      {m.viz !== 'radiation' && <ValueRow m={m} />}
      <Viz m={m} report={report} />
      <p className="lc-caption">{m.caption}</p>
      <p className="lc-context">{m.context}</p>
    </>
  )
  return (
    <article className={`lc-glass lc-card ${layout}`} id={`lc-m-${m.key}`}>
      <header className="lc-card-h">
        <span className="lc-label">{m.label}</span>
        <ConfChip c={m.confidence} legend={report.confidenceLegend} />
      </header>
      {split ? (
        <div className="lc-split">
          <div className="lc-split-main">{body}</div>
          <Figure img={img} />
        </div>
      ) : (
        <>
          {body}
          <Figure img={img} />
        </>
      )}
      <Method m={m} />
      <footer className="lc-card-f">
        <ScanLink m={m} />
        <SeriesNote m={m} />
      </footer>
    </article>
  )
}

/** One question answered by several related numbers (liver vs spleen; pulmonary artery vs aorta). */
function CompoundCard(props: {
  title: string
  main: Metric
  extra: { m: Metric; note?: string }[]
  report: BiomarkerReport
  img?: ReportImage
}) {
  const { title, main, extra, report, img } = props
  const side = SIDE_IMAGE.has(main.key)
  const blocks = (
    <div className="lc-split-main" style={{ display: 'grid', gap: 14 }}>
      {[{ m: main, note: undefined as string | undefined }, ...extra].map(({ m, note }, i) => (
        <div key={m.key}>
          {(i > 0 || title !== m.label) && <div className="lc-k">{m.label}{note && <span className="lc-note"> · {note}</span>}</div>}
          <ValueRow m={m} small={i > 0} />
          {m.gauge && <Gauge gauge={m.gauge} value={m.value} display={shown(m)} unit={m.unit} label={m.label} />}
          <p className="lc-caption">{m.caption}</p>
        </div>
      ))}
      <p className="lc-context">{[main, ...extra.map((e) => e.m)].map((m) => m.context).filter((c, i, a) => a.indexOf(c) === i).join(' ')}</p>
    </div>
  )
  return (
    <article className={`lc-glass lc-card ${LAYOUT[main.key] ?? ''}`} id={`lc-m-${main.key}`}>
      <header className="lc-card-h">
        <span className="lc-label">{title}</span>
        <ConfChip c={main.confidence} legend={report.confidenceLegend} />
      </header>
      {side ? <div className="lc-split">{blocks}<Figure img={img} /></div> : <>{blocks}<Figure img={img} /></>}
      <Method m={main} />
      <footer className="lc-card-f">
        <ScanLink m={main} />
        <SeriesNote m={main} />
      </footer>
    </article>
  )
}

export default function BodyNumbers() {
  const { data, error } = useBiomarkers()
  const reduced = usePrefersReducedMotion()

  const model = useMemo(() => {
    if (!data) return null
    // each thumbnail is drawn once, on its "home" card (the wide one if there is one)
    const home = new Map<string, string>()
    for (const m of data.metrics) {
      if (!m.image || MERGED_INTO[m.key]) continue
      const cur = home.get(m.image)
      if (!cur || (!LAYOUT[cur] && LAYOUT[m.key])) home.set(m.image, m.key)
    }
    const counts = { measured: 0, 'AI estimate': 0, rough: 0 } as Record<Confidence, number>
    for (const m of data.metrics) counts[m.confidence] = (counts[m.confidence] ?? 0) + 1
    const ranged = data.metrics.filter((m) => m.status && m.status !== 'info')
    const flagged = ranged.filter((m) => m.status !== 'typical')
    return { home, counts, ranged, flagged }
  }, [data])

  if (error) return <div className="card"><span className="lc-err">Couldn't load the numbers ({error}). Reloading the page may help.</span></div>
  if (!data || !model) return <div className="card muted">Loading the numbers…</div>

  const imgFor = (m: Metric) => (m.image && model.home.get(m.image) === m.key ? data.images?.[m.image] : undefined)
  const byKey = new Map(data.metrics.map((m) => [m.key, m]))
  const jump = (key: string) => document.getElementById(`lc-g-${key}`)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  const allGood = model.flagged.length === 0

  return (
    <div>
      <p className="lc-lede">
        A heart scan quietly captures much more than the heart: fat, liver, spine, lungs and the great vessels. Here are
        <b> {data.metrics.length} numbers</b> pulled from it, each with how it was measured and a picture of exactly where.
      </p>

      <div className="lc-num-hero">
        <div className="lc-glass">
          <div className="lc-verdict">
            <div className={`lc-badge${allGood ? '' : ' attn'}`}>{allGood ? <IconShield /> : <IconAlert />}</div>
            <div>
              <h3>{allGood ? 'Nothing here stands out' : `${model.flagged.length} number${model.flagged.length > 1 ? 's' : ''} worth a look`}</h3>
              <p>
                {allGood
                  ? `All ${model.ranged.length} numbers that have a reference range sit inside it. The other ${data.metrics.length - model.ranged.length} have no range to judge: they describe sizes, a reference value or this scan's radiation dose.`
                  : `${model.flagged.map((m) => m.label).join(', ')}: outside the usual range. Worth mentioning to a doctor, who can judge it with the full picture.`}
              </p>
            </div>
          </div>
          <div className="lc-tally">
            <div><b style={{ color: 'var(--green)' }}>{model.counts.measured}</b><span>measured</span></div>
            <div><b style={{ color: 'var(--cyan-2)' }}>{model.counts['AI estimate']}</b><span>AI estimates</span></div>
            <div><b style={{ color: 'var(--amber)' }}>{model.counts.rough}</b><span>rough</span></div>
            {data.exam?.phase && <div><b>{data.exam.phase.replace(/[^0-9%]/g, '')}</b><span>of the heartbeat</span></div>}
            {data.exam?.kvp && <div><b>{data.exam.kvp}</b><span>kV, no contrast dye</span></div>}
          </div>
        </div>
        <div className="lc-glass">
          <div className="lc-k" style={{ marginBottom: 10 }}>How sure is each number?</div>
          <div className="lc-legend-c">
            {(['measured', 'AI estimate', 'rough'] as Confidence[]).map((c) => (
              <div key={c}><span><ConfChip c={c} /></span><span>{data.confidenceLegend?.[c]}</span></div>
            ))}
          </div>
        </div>
      </div>

      <nav className="lc-jump" aria-label="Jump to a group">
        {data.groups.map((g) => <button key={g.key} onClick={() => jump(g.key)}>{g.label}</button>)}
      </nav>

      {data.groups.map((g) => {
        const ms = data.metrics.filter((m) => m.group === g.key && !MERGED_INTO[m.key])
        if (!ms.length) return null
        return (
          <section key={g.key} className="lc-group" id={`lc-g-${g.key}`}>
            <div className="lc-group-h"><h3>{g.label}</h3><p>{g.blurb}</p></div>
            <div className="lc-grid">
              {ms.map((m): ReactNode => {
                if (m.key === 'liver_hu') {
                  const sp = byKey.get('spleen_hu')
                  const diff = byKey.get('liver_minus_spleen')
                  // the difference is taken before rounding, so it can be 1 HU off the two rounded numbers above it
                  const offByRounding = !!(sp && diff && Math.round(m.value - sp.value) !== Math.round(diff.value))
                  const extra = [
                    ...(sp ? [{ m: sp }] : []),
                    ...(diff ? [{ m: diff, note: offByRounding ? 'from the unrounded averages' : undefined }] : []),
                  ]
                  return <CompoundCard key={m.key} title="Is my liver storing fat?" main={m} report={data} img={imgFor(m)} extra={extra} />
                }
                if (m.key === 'main_pa') {
                  const ratio = byKey.get('pa_ao_ratio')
                  return <CompoundCard key={m.key} title={m.label} main={m} report={data} img={imgFor(m)} extra={ratio ? [{ m: ratio }] : []} />
                }
                return <MetricCard key={m.key} m={m} report={data} img={imgFor(m)} />
              })}
            </div>
          </section>
        )
      })}

      <p className="disclaimer">{data.disclaimer}</p>
    </div>
  )
}
