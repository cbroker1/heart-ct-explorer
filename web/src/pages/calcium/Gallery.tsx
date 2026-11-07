import { useMemo, useState, type KeyboardEvent } from 'react'
import { dataUrl } from '../../lib/data'
import type { CalciumCandidate } from '../../lib/reports'
import { cleanNote, conf01, isNoise, summarizeVotes, voteColor, voteLabel, voterName, type ReviewerInfo } from './adjudication'
import { chamberLabel, fmtNum, pct, shortReason, sliceRange, thumbUrl, verdict, VERDICT_ORDER } from './model'
import type { CalciumVM } from './useCalciumData'

export function VerdictChip({ cls, small }: { cls: string; small?: boolean }) {
  const v = verdict(cls)
  return (
    <span className={`chip ${v.chip} ${small ? 'cal-chip-sm' : ''}`} title={v.blurb}>
      <span className="dot" style={{ background: v.color }} />
      {v.label}
    </span>
  )
}

const confRange = (lo: number | null, hi: number | null) =>
  lo === null || hi === null ? '' : Math.round(lo * 100) === Math.round(hi * 100) ? pct(lo) : `${Math.round(lo * 100)}–${pct(hi)}`

/** One-line vote summary for a gallery card: three pips + "3/3 AI reviewers: noise / artifact" + confidence range. */
export function VoteStrip({ c, reviewers }: { c: CalciumCandidate; reviewers: ReviewerInfo[] }) {
  const s = summarizeVotes(c)
  if (!s) return null
  const vs = c.reviewVotes ?? []
  const agreedWithRules = c.ruleClass === 'noise' && s.unanimous && isNoise(s.top) && s.topN === s.n
  const title = vs.map((v, i) => {
    const cf = conf01(v.confidence)
    return `${voterName(v, i, reviewers)}: ${voteLabel(v.verdict)}${cf !== null ? ` (${pct(cf)} sure)` : ''}`
  }).join('\n')
  const range = confRange(s.confMin, s.confMax)
  return (
    <div className="cal-vstrip" title={title}>
      <span className="cal-vpips" aria-hidden>{vs.map((v, i) => <i key={i} style={{ background: voteColor(v.verdict) }} />)}</span>
      <b>{s.topN}/{s.n}</b> AI reviewers{agreedWithRules ? ' agreed' : `: ${voteLabel(s.top)}`}
      {range && <span className="muted mono cal-vstrip-c"> · {range} sure</span>}
    </div>
  )
}

/** Every reviewer's vote with its note (candidate sheet). */
export function VoteList({ c, reviewers }: { c: CalciumCandidate; reviewers: ReviewerInfo[] }) {
  const vs = c.reviewVotes ?? []
  if (!vs.length) return null
  return (
    <ul className="cal-vlist">
      {vs.map((v, i) => {
        const cf = conf01(v.confidence)
        const note = cleanNote(v.note)
        return (
          <li key={i}>
            <div className="cal-vlist-head">
              <i style={{ background: voteColor(v.verdict) }} aria-hidden />
              <b>{voterName(v, i, reviewers)}</b>
              <span className="cal-vlist-v">{voteLabel(v.verdict)}{v.artery ? ` · ${v.artery}` : ''}</span>
              {cf !== null && <span className="cal-vlist-conf mono" title="How sure this reviewer was about this verdict">{pct(cf)} sure</span>}
            </div>
            {note && <ClampText text={note} />}
          </li>
        )
      })}
    </ul>
  )
}

/** Long text clamped to a few lines with a "more" toggle. */
export function ClampText({ text, limit = 260 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > limit
  return (
    <div className="cal-clamp-wrap">
      <p className={`cal-clamp ${long && !open ? 'on' : ''}`}>{text}</p>
      {long && <button className="cal-linkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Show less' : 'Read more'}</button>}
    </div>
  )
}

function Card({ c, vm, hot, onOpen, onHover }: {
  c: CalciumCandidate; vm: CalciumVM; hot: boolean; onOpen: (id: number) => void; onHover: (id: number | null) => void
}) {
  const v = verdict(c.finalClass)
  const ruleDiffers = c.ruleClass !== c.finalClass
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id) }
  }
  return (
    <article
      className={`cal-cand ${hot ? 'hot' : ''} v-${v.key}`}
      role="button"
      tabIndex={0}
      aria-label={`Candidate ${c.id}: ${v.label}, peak ${c.peakHU} HU, ${c.areaSum_mm2} square millimetres. Open details.`}
      onClick={() => onOpen(c.id)}
      onKeyDown={onKey}
      onPointerEnter={() => onHover(c.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(c.id)}
      onBlur={() => onHover(null)}
      style={{ ['--v' as string]: v.color }}
    >
      <div className="cal-cand-thumb">
        <img src={dataUrl(thumbUrl(c.id))} alt="" loading="lazy" decoding="async" width={160} height={160}
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <span className="cal-cand-id mono">#{c.id}</span>
      </div>
      <div className="cal-cand-body">
        <VerdictChip cls={c.finalClass} small />
        <div className="cal-cand-stats">
          <span title="Brightest pixel in the candidate"><b>{fmtNum(c.peakHU, 0)}</b> HU</span>
          <span title="Area summed over all slices it appears on"><b>{fmtNum(c.areaSum_mm2, 1)}</b> mm²</span>
          <span title="Number of 3 mm slices it appears on"><b>{c.nSlices}</b> slice{c.nSlices === 1 ? '' : 's'}</span>
        </div>
        <div className="cal-cand-where" title="Which part of the heart the AI segmentation puts it in">
          {chamberLabel(c.chamber, vm.manifest)} · {sliceRange(c.slices)}
        </div>
        {c.ruleReasons.length > 0 ? (
          <div className="cal-cand-tags">
            {c.ruleReasons.map((r) => <span key={r} className="cal-tag" title={`Rule: ${r}`}>{shortReason(r)}</span>)}
          </div>
        ) : (
          <div className={`cal-cand-reasons ${c.finalClass === 'review' ? 'none' : 'muted'}`}>
            {c.finalClass === 'review' ? 'No rule could dismiss it' : 'Rules flagged it for review'}
            {c.depthInHeart_mm.min <= 1 ? ': it touches the heart surface, where coronaries run' : ''}.
          </div>
        )}
        {ruleDiffers && c.ruleReasons.length > 0 && <div className="cal-cand-rule muted">rules said: {verdict(c.ruleClass).short.toLowerCase()}</div>}
        {c.reviewVotes?.length ? <VoteStrip c={c} reviewers={vm.reviewers} /> : c.reviewNote ? <div className="cal-cand-note">{cleanNote(c.reviewNote)}</div> : null}
      </div>
    </article>
  )
}

export default function Gallery({ vm, hoverId, onHover, onOpen }: {
  vm: CalciumVM; hoverId: number | null; onHover: (id: number | null) => void; onOpen: (id: number) => void
}) {
  const [filter, setFilter] = useState<string>('all')
  const classes = useMemo(() => {
    const keys = [...vm.finalCounts.keys()]
    return VERDICT_ORDER.filter((k) => keys.includes(k)).concat(keys.filter((k) => !VERDICT_ORDER.includes(k)))
  }, [vm.finalCounts])
  // On wide screens the sticky 3D map sits next to the list, so show everything; on narrow screens the list
  // sits below the map, so start with the important ones plus a handful of ruled-out examples.
  const [expanded, setExpanded] = useState(() => typeof window === 'undefined' || !!window.matchMedia?.('(min-width: 1101px)').matches)
  const all = filter === 'all' ? vm.candidates : vm.candidates.filter((c) => c.finalClass === filter)
  const important = all.filter((c) => !verdict(c.finalClass).key.startsWith('noise'))
  const limit = Math.max(important.length + 5, 8)
  const shown = expanded || filter !== 'all' ? all : all.slice(0, limit)
  return (
    <div className="cal-gallery">
      <div className="cal-gallery-bar">
        <div className="seg" role="group" aria-label="Filter candidates">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All {vm.candidates.length}</button>
          {classes.map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              <span className="cal-seg-dot" style={{ background: verdict(k).color }} />
              {verdict(k).short} {vm.finalCounts.get(k)}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Sorted: {vm.pending.length || vm.borderline.length ? 'borderline first' : 'most important first'}, then by peak HU</span>
      </div>
      <div className="cal-cands">
        {shown.map((c) => (
          <Card key={c.id} c={c} vm={vm} hot={hoverId === c.id} onOpen={onOpen} onHover={onHover} />
        ))}
      </div>
      {shown.length < all.length && (
        <button className="btn cal-more" onClick={() => setExpanded(true)}>
          Show all {all.length} candidates <span className="muted">(+{all.length - shown.length} more ruled out as noise)</span>
        </button>
      )}
    </div>
  )
}
