/** Small presentational pieces shared by the AI read page. */
import type { ReactNode } from 'react'
import { pct, SEV_TONE, SEVERITY_LABEL, statusMeta, verifMeta, type Severity, type Tone } from './model'
import { IcCheck, IcInfo, IcMinus, IcX } from './icons'

export function ToneChip(props: { tone: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  return (
    <span className={`rd-chip rd-tone-${props.tone} ${props.className ?? ''}`} title={props.title}>
      {props.dot !== false && <i className="rd-chip-dot" />}
      {props.children}
    </span>
  )
}

export function SevChip({ s, short }: { s: Severity; short?: string }) {
  return (
    <ToneChip tone={SEV_TONE[s]} title={`Severity ${s} of 3: ${SEVERITY_LABEL[s]}`} className="rd-sev">
      {short ?? SEVERITY_LABEL[s]}
    </ToneChip>
  )
}

export function StatusChip({ status }: { status: string }) {
  const m = statusMeta(status)
  return <ToneChip tone={m.tone} title={m.blurb}>{m.label}</ToneChip>
}

export function VerifChip({ status, upheld, total }: { status: string; upheld: number; total: number }) {
  const m = verifMeta(status)
  const icon = status === 'confirmed' ? <IcCheck size={13} /> : status === 'refuted' ? <IcX size={13} /> : status === 'downgraded' ? <IcMinus size={13} /> : <IcInfo size={13} />
  return (
    <span className={`rd-verif rd-tone-${m.tone}`} title={`${m.blurb}${total ? ` (${upheld} of ${total} skeptics could not refute it)` : ''}`}>
      {icon}
      {m.label}
      {total > 0 && <span className="rd-verif-tally mono">{upheld}/{total}</span>}
    </span>
  )
}

/** Horizontal confidence meter: 0..1. */
export function ConfidenceBar(props: { value: number; label?: ReactNode; caption?: ReactNode; compact?: boolean }) {
  const { value, label, caption, compact } = props
  const tone = value >= 0.75 ? 'violet' : value >= 0.5 ? 'cyan' : 'amber'
  return (
    <div className={`rd-conf rd-tone-${tone} ${compact ? 'compact' : ''}`} title={`AI confidence: ${pct(value)}`}>
      {label && <div className="rd-conf-label"><span>{label}</span><b className="mono">{pct(value)}</b></div>}
      <div className="rd-conf-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Confidence">
        <div className="rd-conf-fill" style={{ width: pct(value) }} />
        {[0.25, 0.5, 0.75].map((t) => <i key={t} style={{ left: pct(t) }} />)}
      </div>
      {caption && <div className="rd-conf-caption">{caption}</div>}
    </div>
  )
}

/** Paragraphs that respect the newlines the pipeline put in. */
export function Prose({ text, className }: { text: string; className?: string }) {
  if (!text) return null
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return <>{paras.map((p, i) => <p key={i} className={`rd-prose ${className ?? ''}`}>{p}</p>)}</>
}
