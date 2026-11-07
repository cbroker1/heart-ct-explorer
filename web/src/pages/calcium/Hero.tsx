import type { ReactNode } from 'react'
import { scrollToId, useWidth } from './hooks'
import {
  CAC_CATEGORIES, cacCategory, fmtNum, fmtScore, groupName, percentileBracket, pct,
} from './model'
import type { CalciumVM } from './useCalciumData'

function CalStat(props: { k: string; v: ReactNode; unit?: string; hint: string; title?: string; color?: string }) {
  return (
    <div className="cal-stat" title={props.title ?? props.hint}>
      <div className="cal-stat-v" style={{ color: props.color }}>
        {props.v}
        {props.unit && <small>{props.unit}</small>}
      </div>
      <div className="cal-stat-k">{props.k}</div>
      <div className="cal-stat-h">{props.hint}</div>
    </div>
  )
}

export function StatusChip({ vm }: { vm: CalciumVM }) {
  const { report } = vm
  if (report.reviewed) {
    const n = vm.reviewers.length || report.adjudication?.reviewers?.length
    const unanimous = !!vm.votes?.unanimousAll && (n ?? 0) > 1
    return (
      <span className="chip good cal-status"
        title={`After the automatic rules, independent AI reviewers voted on every candidate${unanimous ? ', and every vote agreed' : ''}.`}>
        <span className="dot" style={{ background: 'var(--green)' }} />
        {n ? `${n} independent AI reviewer${n === 1 ? '' : 's'}${unanimous ? ' · unanimous' : ''}` : 'Adjudicated by AI reviewers'}
      </span>
    )
  }
  return (
    <span className="chip warn cal-status" title="The automatic rules have run; the AI review of borderline candidates has not been merged yet.">
      <span className="dot cal-pulse" style={{ background: 'var(--amber)' }} />
      Provisional · pending AI adjudication
    </span>
  )
}

/** Horizontal CAC-DRS scale with a symlog axis, so 0, 8 and 400 all get room. */
function ScoreScale({ score, official, worst }: { score: number; official: number | null; worst: number | null }) {
  const [ref, w] = useWidth<HTMLDivElement>(420)
  const W = Math.max(240, w)
  const zeroW = Math.round(W * 0.12)
  const gap = 3
  const span = W - zeroW - gap
  const pos = (s: number) => (s <= 0 ? zeroW / 2 : zeroW + gap + span * Math.min(1, Math.max(0, Math.log10(Math.max(1, s)) / 3)))
  const segs = [
    { x0: 0, x1: zeroW, c: CAC_CATEGORIES[0] },
    { x0: zeroW + gap, x1: pos(100) - gap / 2, c: CAC_CATEGORIES[1] },
    { x0: pos(100) + gap / 2, x1: pos(300) - gap / 2, c: CAC_CATEGORIES[2] },
    { x0: pos(300) + gap / 2, x1: W, c: CAC_CATEGORIES[3] },
  ]
  const cur = cacCategory(score)
  const barY = 26, barH = 12
  const H = barY + barH + 36
  const clampX = (x: number, half: number) => Math.min(W - half, Math.max(half, x))
  const showWorst = worst !== null && worst > 0
  return (
    <div ref={ref} className="cal-scale">
      <svg width={W} height={H} role="img"
        aria-label={`Score scale (CAC-DRS categories): DIY score ${fmtScore(score)}, ${cur.label.toLowerCase()}${showWorst ? `; worst case ${fmtScore(worst!)}` : ''}${official !== null ? `; official ${fmtNum(official, 1)}` : ''}`}>
        {segs.map((s) => (
          <g key={s.c.key}>
            <rect x={s.x0} y={barY} width={Math.max(2, s.x1 - s.x0)} height={barH} rx={4}
              fill={s.c.color} opacity={s.c.key === cur.key ? 0.95 : 0.26} />
            <text x={(s.x0 + s.x1) / 2} y={barY + barH + 17} textAnchor="middle" className="cal-svg-lbl">{s.c.range}</text>
            <text x={(s.x0 + s.x1) / 2} y={barY + barH + 31} textAnchor="middle" className="cal-svg-sub">{s.c.label.toLowerCase()}</text>
          </g>
        ))}
        {showWorst && <circle cx={pos(worst!)} cy={barY + barH / 2} r={5} fill="none" stroke="var(--amber)" strokeWidth={2} />}
        {official !== null && (
          <path d={`M${pos(official)} ${barY - 3} l5 -8 h-10 z`} fill="var(--cyan)" stroke="var(--panel-solid)" strokeWidth={1} />
        )}
        <circle cx={pos(score)} cy={barY + barH / 2} r={6} fill="#fff" stroke="var(--panel-solid)" strokeWidth={2.5} />
        <text x={clampX(pos(score), 26)} y={barY - 9} textAnchor="middle" className="cal-svg-lbl" style={{ fontWeight: 700 }}>
          {official !== null && Math.abs(pos(official) - pos(score)) < 40 ? '' : `DIY ${fmtScore(score)}`}
        </text>
      </svg>
      {(showWorst || official !== null) && (
        <div className="cal-scale-key">
          <span><i className="dot" />DIY {fmtScore(score)}</span>
          {showWorst && <span><i className="ring" />worst case {fmtScore(worst!)}</span>}
          {official !== null && <span><i className="tri" />official {fmtNum(official, 1)}</span>}
        </div>
      )}
    </div>
  )
}

/** "All 3 reviewers independently estimate 0, 87–94% sure it's truly zero. Meet the panel" */
function PanelLine({ vm }: { vm: CalciumVM }) {
  const rs = vm.reviewers
  if (!vm.report.reviewed || !rs.length) return null
  const ests = rs.map((r) => r.estimate).filter((e): e is number => e !== null)
  const same = ests.length === rs.length && ests.every((e) => e === ests[0])
  const confs = rs.map((r) => r.confZero).filter((c): c is number => c !== null)
  const lo = confs.length ? Math.min(...confs) : null
  const hi = confs.length ? Math.max(...confs) : null
  return (
    <p className="cal-panel-line">
      {same
        ? <>{rs.length > 1 ? `All ${rs.length} reviewers` : 'The reviewer'} independently estimate <b>{fmtScore(ests[0])}</b></>
        : <>Reviewer estimates: <b>{ests.map((e) => fmtScore(e)).join(', ')}</b></>}
      {lo !== null && hi !== null ? <>, each {Math.round(lo * 100) === Math.round(hi * 100) ? pct(lo) : `${Math.round(lo * 100)}–${pct(hi)}`} sure the true score is 0</> : null}.{' '}
      <button type="button" className="cal-linkbtn" onClick={() => scrollToId('cal-panel')}>Meet the panel ↓</button>
    </p>
  )
}

function PercentileTable({ vm }: { vm: CalciumVM }) {
  const pc = vm.report.percentileContext
  if (!pc?.rows?.length) return null
  const score = vm.report.totals.agatston
  const cols: { k: 'p75' | 'p90' | 'p95' | 'p97_5'; label: string }[] = [
    { k: 'p75', label: '75th' },
    { k: 'p90', label: '90th' },
    { k: 'p95', label: '95th' },
    { k: 'p97_5', label: '97.5th' },
  ]
  const first = pc.rows[0]
  return (
    <div className="cal-pct">
      <div className="eyebrow">Men aged {pc.age}: score at each percentile</div>
      <table className="cal-pct-table">
        <thead>
          <tr>
            <th scope="col"><span className="cal-sr-only">Group</span></th>
            {cols.map((c) => <th key={c.k} scope="col" title={`${c.label} percentile: this share of men that age have this score or lower`}>{c.label}</th>)}
            <th scope="col">You</th>
          </tr>
        </thead>
        <tbody>
          {pc.rows.map((r) => {
            const b = percentileBracket(score, r)
            return (
              <tr key={r.group}>
                <th scope="row">{groupName(r.group)}</th>
                {cols.map((c) => (
                  <td key={c.k}
                    title={`${c.label} percentile for ${groupName(r.group)} aged ${pc.age}: Agatston ${r[c.k]}`}>
                    {r[c.k]}
                  </td>
                ))}
                <td className="you" title={`A score of ${fmtScore(score)} is ${b.long} for ${groupName(r.group)} aged ${pc.age}`}>{b.short}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="cal-pct-say">
        {score === 0 ? (
          <>At {pc.age}, a score of <b>0</b> is what most men have. A score of just <b>{first.p90}</b> would already be about the{' '}
            <b>90th percentile</b> for {groupName(first.group)}{pc.rows[1] ? <> ({pc.rows[1].p90} for {groupName(pc.rows[1].group)})</> : null}.</>
        ) : (
          <>For {groupName(first.group)} aged {pc.age}, a score of <b>{fmtScore(score)}</b> is {percentileBracket(score, first).long}.</>
        )}
        {pc.prevalenceNonzero && (
          <> Any calcium at all is found in {Object.entries(pc.prevalenceNonzero).map(([g, v], i, a) => (
            <span key={g}>{pct(v)} of {g.replace(/(\d)-(\d)/g, '$1–$2')}{i < a.length - 2 ? ', ' : i === a.length - 2 ? ' and ' : ''}</span>
          ))}.</>
        )}
      </p>
      <p className="cal-src">
        Source: {pc.url ? <a href={pc.url} target="_blank" rel="noreferrer">{pc.source}</a> : pc.source}
        {pc.note ? <> {pc.note}</> : null}
      </p>
    </div>
  )
}

function PowerOfZero({ score }: { score: number }) {
  if (score > 0) {
    return (
      <div className="cal-note cal-note-amber">
        <h3>What a non-zero score means</h3>
        <ul>
          <li><b>Plaque has started.</b> Calcium is the hardened, late-stage part of plaque, so there is usually some soft plaque around it too.</li>
          <li><b>Age matters.</b> In people under 45, even small scores are uncommon, which is why the percentile table above matters as much as the number.</li>
          <li><b>It is a risk marker, not a diagnosis.</b> Blood pressure, cholesterol (LDL), smoking, diabetes and family history decide what, if anything, to do. That conversation belongs with your doctor.</li>
        </ul>
      </div>
    )
  }
  return (
    <div className="cal-note">
      <h3>The power of zero (and its limits)</h3>
      <ul>
        <li><b>Very reassuring for the next several years.</b> People with a calcium score of 0 have a very low rate of heart attacks in the near term. Cardiologists use a zero as one of the strongest "negative" risk markers there is.</li>
        <li><b>It can't see soft plaque.</b> The scan only detects <i>calcified</i> plaque. Early plaque is soft (non-calcified) and invisible here, and in younger people plaque is more often the soft kind. A contrast CT angiogram can see it; this scan can't.</li>
        <li><b>It is not a lifetime pass.</b> Calcium can appear over the years. Blood pressure, LDL cholesterol, smoking, diabetes, family history, sleep and exercise still matter as much as ever.</li>
      </ul>
    </div>
  )
}

export default function Hero({ vm, official }: { vm: CalciumVM; official: number | null }) {
  const { report, method } = vm
  const t = report.totals
  const score = t.agatston
  const cat = cacCategory(score)
  const worst = vm.pending.length ? vm.worstCase : null
  const massHint = method.massCal
    ? `Calcium mass in mg, from mean HU × volume × ${method.massCal} mg per HU·cm³ (a typical 120 kV value; no calibration phantom, so it's an estimate)`
    : 'Calcium mass in mg (estimate)'
  return (
    <>
      <section className="cal-hero panel" aria-labelledby="cal-hero-title">
        <div className="cal-hero-main">
          <div className="eyebrow" id="cal-hero-title">Coronary artery calcium · computed from my pixels</div>
          <div className="cal-big-wrap">
            <div className={`cal-big ${score === 0 ? 'zero' : ''}`} aria-label={`Agatston score ${fmtScore(score)}`}>{fmtScore(score)}</div>
            <div className="cal-big-side">
              <div className="cal-big-unit">Agatston units</div>
              <div className="cal-big-caption" style={{ color: cat.color }}>
                {cat.caption}
              </div>
            </div>
          </div>
          <StatusChip vm={vm} />
          <PanelLine vm={vm} />
          <div className="cal-hero-stats">
            <CalStat k="Volume score" v={fmtNum(t.volume_mm3, 1)} unit="mm³" hint={`calcium volume ≥${method.threshold} HU`}
              title={`Total volume of coronary calcium at or above ${method.threshold} HU, in cubic millimetres`} />
            <CalStat k="Mass score" v={fmtNum(t.mass_mg, 1)} unit="mg" hint="estimated calcium mass" title={massHint} />
            <CalStat k="Lesions counted" v={vm.counted.length} unit={`of ${report.candidates.length}`} hint="candidates judged coronary"
              title={`${vm.counted.length} of ${report.candidates.length} bright candidates were judged to be coronary calcium`} />
          </div>
          {worst !== null && (
            <div className="cal-pending" role="note">
              <b>{vm.pending.length} borderline candidate{vm.pending.length === 1 ? '' : 's'} still under review.</b>{' '}
              The score above doesn't count {vm.pending.length === 1 ? 'it' : 'them'} yet. Worst case, if {vm.pending.length === 1 ? 'it turned out to be' : `all ${vm.pending.length} turned out to be`} real coronary plaque:{' '}
              <b className="mono">{fmtScore(worst)}</b> Agatston ({cacCategory(worst).label.toLowerCase()}
              {report.percentileContext?.rows?.[0] ? <>, {percentileBracket(worst, report.percentileContext.rows[0]).short} percentile for {groupName(report.percentileContext.rows[0].group)} aged {report.percentileContext.age}</> : null}).
            </div>
          )}
        </div>
        <div className="cal-hero-side">
          <div className="eyebrow">Where this score sits</div>
          <ScoreScale score={score} official={official} worst={worst} />
          <PercentileTable vm={vm} />
        </div>
      </section>
      <PowerOfZero score={score} />
    </>
  )
}
