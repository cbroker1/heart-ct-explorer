import { useMemo, useState, type KeyboardEvent } from 'react'
import { dataUrl } from '../../lib/data'
import type { CalciumCandidate } from '../../lib/reports'
import { chamberLabel, fmtNum, frac01, shortReason, sliceRange, thumbUrl, verdict, VERDICT_ORDER } from './model'
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

export function Votes({ c }: { c: CalciumCandidate }) {
  if (!c.reviewVotes?.length) return null
  return (
    <div className="cal-votes">
      {c.reviewVotes.map((v, i) => {
        const vm = verdict(v.verdict)
        const conf = frac01(v.confidence)
        return (
          <span key={i} className="cal-vote" title={v.note ?? ''}>
            <i style={{ background: vm.color }} />
            <b>{v.reviewer ?? `reviewer ${i + 1}`}</b> {vm.short.toLowerCase()}{v.artery ? ` (${v.artery})` : ''}
            {conf !== null && <span className="muted">{Math.round(conf * 100)}%</span>}
          </span>
        )
      })}
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
        {c.reviewNote && <div className="cal-cand-note">{c.reviewNote}</div>}
        <Votes c={c} />
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
        <span className="muted" style={{ fontSize: 12 }}>Sorted: {vm.pending.length ? 'borderline first' : 'most important first'}, then by peak HU</span>
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
