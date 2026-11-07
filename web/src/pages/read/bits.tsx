/** Small presentational pieces shared by the AI read page. */
import { Fragment, type ReactNode } from 'react'
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

/** `**bold**` and `code` spans; everything else stays plain text (never HTML). */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <code key={m.index}>{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/**
 * The small Markdown subset the AI reviewers write: paragraphs (blank lines), line breaks,
 * "- " bullet lists and **bold**. Used for the long skeptic notes.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  return (
    <>
      {blocks.map((b, bi) => {
        const out: ReactNode[] = []
        let para: string[] = []
        let list: string[] = []
        const flushPara = () => {
          if (para.length) out.push(<p key={`p${out.length}`}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>)
          para = []
        }
        const flushList = () => {
          if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
          list = []
        }
        for (const raw of b.split('\n')) {
          const l = raw.trim()
          if (!l) continue
          const m = /^[-*•]\s+(.*)$/.exec(l)
          if (m) { flushPara(); list.push(m[1]) } else { flushList(); para.push(l) }
        }
        flushPara()
        flushList()
        return <Fragment key={bi}>{out}</Fragment>
      })}
    </>
  )
}
