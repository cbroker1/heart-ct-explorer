/** Top of the report: mock banner, verdict, impression, calcium and the at-a-glance grid. */
import { useEffect, useState, type ReactNode } from 'react'
import { navigate } from '../../components/ui'
import {
  plural, SEV_SHORT, SEV_TONE, SEVERITIES, statusMeta, verdictMeta, VERDICTS,
  type NFinding, type NReport, type NSystem, type Severity,
} from './model'
import { ConfidenceBar, SevChip, StatusChip } from './bits'
import { IcAlert, IcArrowRight, IcFlag, IcGavel, IcHeart, IcInfo, IcShield, SystemIcon } from './icons'

export function MockBanner({ file }: { file: string }) {
  return (
    <div className="rd-mock" role="status">
      <span className="rd-mock-badge mono">MOCK</span>
      <div>
        <b>MOCK DATA, real report pending.</b>{' '}
        <span>The AI second read is still being produced. Everything below is placeholder text from <code>{file}</code>, shown only to preview the layout. Do not read anything into it.</span>
      </div>
    </div>
  )
}

const VERDICT_ICON = { reassuring: IcShield, 'minor-notes': IcInfo, 'follow-up-suggested': IcFlag, urgent: IcAlert }

export function VerdictBanner(props: { report: NReport; madeBy: string; stats: { v: ReactNode; k: string; cap: string }[] }) {
  const { report, madeBy, stats } = props
  const vm = report.verdict ? verdictMeta(report.verdict) : null
  const Icon = vm ? VERDICT_ICON[vm.key] : IcInfo
  const tone = vm?.tone ?? 'neutral'
  const headline = report.headline || (vm ? vm.blurb : 'This report does not state an overall verdict. See the impression and the system-by-system sections below.')
  return (
    <section id="rd-verdict" className={`rd-verdict rd-tone-${tone}`} aria-label="Verdict">
      <div className="rd-verdict-glow" aria-hidden />
      <div className="rd-verdict-scan" aria-hidden />
      <div className="rd-verdict-top">
        <div className="rd-verdict-icon"><Icon size={30} /></div>
        <div className="grow">
          <div className="rd-verdict-eyebrow">
            <span>The short answer</span>
            <span className="rd-verdict-pill">{vm ? vm.label : 'No verdict recorded'}</span>
          </div>
          <p className="rd-headline">{headline}</p>
          <p className="rd-madeby"><IcGavel size={16} />{madeBy}</p>
        </div>
      </div>

      <div className="rd-gauge" role="img" aria-label={vm ? `Verdict scale: ${vm.label}, level ${VERDICTS.indexOf(vm) + 1} of 4` : 'Verdict scale: no verdict recorded'}>
        {VERDICTS.map((v) => (
          <div key={v.key} className={`rd-gauge-seg rd-tone-${v.tone} ${v.key === vm?.key ? 'on' : ''}`}>
            <div className="rd-gauge-bar" />
            <div className="rd-gauge-label">
              <b>{v.short}</b>
              <span>{v.blurb}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rd-stats">
        {stats.map((s) => (
          <div key={s.k} className="rd-stat">
            <div className="rd-stat-v mono">{typeof s.v === 'number' ? <CountUp to={s.v} /> : s.v}</div>
            <div className="rd-stat-k">{s.k}</div>
            <div className="rd-stat-cap">{s.cap}</div>
          </div>
        ))}
      </div>

      <p className="disclaimer rd-verdict-disc">{report.disclaimer || 'Not a medical device. The official radiologist report is what counts.'}</p>
    </section>
  )
}

/** Counts up from 0 on mount (skipped when the user prefers reduced motion). */
function CountUp({ to, ms = 900 }: { to: number; ms?: number }) {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [v, setV] = useState(reduce || !Number.isInteger(to) ? to : 0)
  useEffect(() => {
    if (reduce || !Number.isInteger(to) || to === 0) { setV(to); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, ms, reduce])
  return <>{v}</>
}

export function Impression({ items }: { items: NReport['impression'] }) {
  return (
    <div className="rd-impression card">
      <div className="rd-card-head">
        <div>
          <div className="eyebrow">Impression</div>
          <h2>The bottom line, item by item</h2>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted">No impression items were recorded in this report.</p>
      ) : (
        <ol className="rd-imp-list">
          {items.map((it, i) => (
            <li key={i} className={`rd-imp rd-tone-${SEV_TONE[it.severity]}`}>
              <span className="rd-imp-n mono">{String(it.n).padStart(2, '0')}</span>
              <p className="rd-imp-text">{it.text}</p>
              <SevChip s={it.severity} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** CAC-DRS categories (SCCT 2018), for context only. */
const CAC_BANDS = [
  { label: '0', sub: 'none', max: 0 },
  { label: '1–99', sub: 'mild', max: 99 },
  { label: '100–299', sub: 'moderate', max: 299 },
  { label: '300+', sub: 'severe', max: Infinity },
]

export function CalciumCard({ calcium }: { calcium: NonNullable<NReport['calcium']> }) {
  const a = calcium.agatston
  const band = a === null ? -1 : CAC_BANDS.findIndex((b) => a <= b.max)
  const shown = a === null ? 'n/a' : a < 10 && !Number.isInteger(a) ? a.toFixed(1) : Math.round(a).toLocaleString()
  return (
    <div className="rd-calcium card">
      <div className="eyebrow">Coronary calcium</div>
      <div className="rd-cal-score">
        <span className="rd-cal-v">{shown}</span>
        <span className="rd-cal-unit">Agatston units<small>AI panel estimate</small></span>
      </div>
      <div className="rd-cac" aria-label="Calcium score categories (CAC-DRS)">
        {CAC_BANDS.map((b, i) => (
          <div key={b.label} className={`rd-cac-seg s${i} ${i === band ? 'on' : ''}`} title={`CAC-DRS ${i}: ${b.sub}`}>
            <i />
            <b className="mono">{b.label}</b>
            <span>{b.sub}</span>
          </div>
        ))}
      </div>
      {calcium.summary && <p className="rd-cal-sum">{calcium.summary}</p>}
      {calcium.confidenceZero !== null && (
        <ConfidenceBar
          value={calcium.confidenceZero}
          compact
          label="Confidence the true score is zero"
          caption="How sure the AI calcium panel is that there is no coronary calcium at all."
        />
      )}
      <button type="button" className="btn rd-cal-btn rd-noprint" onClick={() => navigate('/calcium')}>
        <IcHeart size={16} /> Open the DIY calcium score <IcArrowRight size={16} />
      </button>
    </div>
  )
}

export function GlanceGrid(props: { systems: NSystem[]; onGo: (anchor: string) => void }) {
  const { systems, onGo } = props
  if (!systems.length) return <p className="muted">This report has no per-system sections.</p>
  return (
    <div className="rd-glance">
      {systems.map((s, i) => {
        const st = statusMeta(s.status)
        const real = s.findings.filter((f) => !f.isArtifact && !f.isRefuted)
        const artifacts = s.findings.filter((f) => f.isArtifact).length
        const worst = real.reduce<Severity | null>((w, f) => (w === null || f.severity > w ? f.severity : w), null)
        return (
          <button key={s.anchor} type="button" className={`rd-glance-card rd-tone-${st.tone}`} onClick={() => onGo(s.anchor)} style={{ ['--i' as string]: i }} aria-label={`${s.title}: ${st.label}. Jump to section`}>
            <span className="rd-glance-ic"><SystemIcon k={s.key} size={20} /></span>
            <span className="rd-glance-chip"><StatusChip status={s.status} /></span>
            <span className="rd-glance-title">{s.title}</span>
            {s.summary && <span className="rd-glance-sum">{s.summary}</span>}
            <span className="rd-glance-foot">
              <span className={real.length ? `rd-tone-${SEV_TONE[worst ?? 0]} rd-tone-text` : 'muted'}>
                {real.length ? plural(real.length, 'finding') : 'No findings'}
              </span>
              {artifacts > 0 && <span className="faint">{plural(artifacts, 'artifact note')}</span>}
              {s.checked.length > 0 && <span className="faint rd-glance-checks">{plural(s.checked.length, 'check')}</span>}
              <IcArrowRight size={15} className="rd-glance-go" />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Severity histogram + verification funnel, used in "About this read". */
export function VerificationFunnel({ findings }: { findings: NFinding[] }) {
  const total = findings.length
  if (!total) return <p className="muted rd-funnel-empty">No findings needed skeptic review.</p>
  const groups = [
    { key: 'confirmed', label: 'Confirmed', tone: 'violet' },
    { key: 'downgraded', label: 'Downgraded', tone: 'cyan' },
    { key: 'refuted', label: 'Refuted', tone: 'neutral' },
  ]
  const counts = groups.map((g) => ({ ...g, n: findings.filter((f) => f.status === g.key).length }))
  const other = total - counts.reduce((a, c) => a + c.n, 0)
  if (other > 0) counts.push({ key: 'other', label: 'Not verified', tone: 'neutral', n: other })
  return (
    <div className="rd-funnel">
      <div className="rd-funnel-bar" role="img" aria-label={counts.map((c) => `${c.n} ${c.label}`).join(', ')}>
        {counts.filter((c) => c.n > 0).map((c) => (
          <div key={c.key} className={`rd-tone-${c.tone} k-${c.key}`} style={{ flex: c.n }} title={`${c.n} ${c.label.toLowerCase()}`} />
        ))}
      </div>
      <div className="rd-funnel-legend">
        <span><b className="mono">{total}</b> flagged by the specialists</span>
        {counts.map((c) => (
          <span key={c.key} className={`rd-tone-${c.tone}`}><i className="rd-legend-dot" /><b className="mono">{c.n}</b> {c.label.toLowerCase()}</span>
        ))}
      </div>
    </div>
  )
}

export function SeverityMix({ findings }: { findings: NFinding[] }) {
  return (
    <span className="rd-sevmix">
      {SEVERITIES.map((s) => {
        const n = findings.filter((f) => f.severity === s).length
        return n ? <span key={s} className={`rd-tone-${SEV_TONE[s]} rd-tone-text`}>{n} {SEV_SHORT[s].toLowerCase()}</span> : null
      })}
    </span>
  )
}
