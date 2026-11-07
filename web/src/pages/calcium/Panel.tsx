/**
 * The AI review panel: who the independent reviewers were and what each concluded, how unanimous
 * the vote was, the soft-tissue "203 HU" cross-check, and the calcifications the reviewers found
 * outside the candidate list. Every number comes from calcium.json (adjudication + reviewVotes).
 */
import type { ReactNode } from 'react'
import { navigate } from '../../components/ui'
import { SEVERITY_LABEL, type Severity } from '../../lib/reports'
import {
  conf01, matchReviewer, voteColor, voteLabel, type CrossCheck, type OutsideFinding, type ReviewerInfo,
} from './adjudication'
import { cacCategory, fmtNum, fmtScore, pct, sliceViewerLink } from './model'
import type { CalciumVM } from './useCalciumData'

/** Reviewer prose -> paragraphs and bullet lists ("- " lines), in reading order. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = []
  let para: string[] = []
  let items: string[] = []
  const flushPara = () => { if (para.length) { out.push(<p key={out.length}>{para.join(' ')}</p>); para = [] } }
  const flushList = () => { if (items.length) { out.push(<ul key={out.length}>{items.map((b, i) => <li key={i}>{b}</li>)}</ul>); items = [] } }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    const m = line.match(/^[-•*]\s+(.*)$/)
    if (m) { flushPara(); items.push(m[1]) } else { flushList(); para.push(line) }
  }
  flushPara()
  flushList()
  return <div className={`cal-rich ${className ?? ''}`}>{out}</div>
}

const prettyVerdict = (s: string) => {
  const t = s.replace(/^noise-artifact\b/i, 'noise / artifact').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ---------------------------------------------------------------------------------- tally
function Tally({ vm }: { vm: CalciumVM }) {
  const s = vm.votes
  const nRev = vm.reviewers.length || s?.reviewers || 0
  const counted = vm.counted.length
  return (
    <div className="cal-pn-tally">
      <div>
        <b>{nRev}</b>
        <span>independent AI reviewers</span>
        <small>each worked alone, with a different method</small>
      </div>
      {s && (
        <div className={s.noiseVotes === s.votes ? 'ok' : ''}>
          <b>{s.noiseVotes}<i>/{s.votes}</i></b>
          <span>votes said noise or artifact</span>
          <small>{s.unanimousCandidates === s.candidatesVoted ? `all ${s.candidatesVoted} candidates: unanimous` : `${s.unanimousCandidates} of ${s.candidatesVoted} candidates unanimous`}</small>
        </div>
      )}
      <div className={counted ? 'pos' : 'ok'}>
        <b>{counted}</b>
        <span>coronary lesion{counted === 1 ? '' : 's'} after the vote</span>
        <small>so the score is {fmtScore(vm.report.totals.agatston)} Agatston</small>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------- reviewers
function ReviewerCard({ r, vm, onOpen }: { r: ReviewerInfo; vm: CalciumVM; onOpen: (id: number) => void }) {
  const conf = r.confZero
  // this reviewer's own votes on the borderline candidates (the ones no rule could dismiss)
  const bv = vm.borderline
    .map((c) => ({ c, v: (c.reviewVotes ?? []).find((x) => matchReviewer(x.reviewer, vm.reviewers)?.key === r.key) }))
    .filter((x): x is { c: typeof x.c; v: NonNullable<typeof x.v> } => !!x.v)
  return (
    <article className="cal-pn-card" aria-labelledby={`cal-pn-${r.key}`}>
      <header className="cal-pn-who">
        <span className="cal-pn-avatar" aria-hidden>{r.index + 1}</span>
        <div>
          <h4 id={`cal-pn-${r.key}`} title={r.lens ? `Lens: ${r.lens}` : undefined}>{r.name}</h4>
          <div className="cal-pn-lens">AI reviewer {r.index + 1} of {vm.reviewers.length}</div>
        </div>
      </header>
      {r.approach && <p className="cal-pn-approach">{r.approach}</p>}
      <div className="cal-pn-est">
        <div className="cal-pn-est-n" title="This reviewer's own Agatston estimate for the whole heart">
          <span>Agatston estimate</span>
          <b className="mono" style={{ color: r.estimate === null ? 'var(--muted)' : cacCategory(r.estimate).color }}>{r.estimate === null ? '–' : fmtScore(r.estimate)}</b>
        </div>
        {conf !== null && (
          <div className="cal-pn-est-c" title="How confident this reviewer is that the true score is zero">
            <span>sure the true score is 0</span>
            <div className="cal-conf-bar"><div style={{ width: `${Math.round(conf * 100)}%` }} /></div>
            <b className="mono">{pct(conf)}</b>
          </div>
        )}
      </div>
      {bv.length > 0 && (
        <div className="cal-pn-bv">
          <span className="cal-pn-bv-k">Votes on the {bv.length} borderline spot{bv.length === 1 ? '' : 's'}</span>
          <div className="cal-pn-bv-list">
            {bv.map(({ c, v }) => {
              const cf = conf01(v.confidence)
              return (
                <button key={c.id} className="cal-pn-vote" onClick={() => onOpen(c.id)}
                  title={`Open candidate #${c.id}: ${voteLabel(v.verdict)}${cf !== null ? `, ${pct(cf)} sure` : ''}`}>
                  <i style={{ background: voteColor(v.verdict) }} />
                  <span className="mono">#{c.id}</span> {voteLabel(v.verdict)}
                  {cf !== null && <span className="muted mono">{pct(cf)}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {r.summary && (
        <details className="cal-expand">
          <summary>Read this reviewer's full notes</summary>
          <RichText text={r.summary} />
        </details>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------------- 203 HU cross-check
function CrossCheckCard({ x, vm, onOpen }: { x: CrossCheck; vm: CalciumVM; onOpen: (id: number) => void }) {
  const cand = x.candId !== null ? vm.candidates.find((c) => c.id === x.candId) ?? null : null
  const st = vm.manifest.volumes.find((v) => v.key === 'axial_st') ?? null
  const cal = vm.vol
  const n = x.entries.length
  const byAll = n > 1 && n === vm.reviewers.length
  const link = x.lps && st ? sliceViewerLink(x.lps, st.key) : null
  const allNoise = x.entries.every((e) => /noise|artifact/i.test(e.verdict))
  return (
    <section className="cal-pn-x" aria-labelledby="cal-pn-x-h">
      <div className="eyebrow">Cross-check · a second reconstruction of the same scan</div>
      <h3 id="cal-pn-x-h">The mysterious {fmtNum(x.peakHU, 0)} HU speck{cand && allNoise ? <>: candidate #{cand.id} in disguise</> : null}</h3>
      <p className="cal-pn-x-lede">
        The scanner also rebuilt this scan as whole-chest <b>soft-tissue</b> slices{st ? <> (the “{st.label}” series)</> : null}. On those, one speck reached{' '}
        <b>{fmtNum(x.peakHU, 0)} HU</b>
        {x.peakHU > vm.maxPeak
          ? <>: brighter than anything on the calcium-score series, where the brightest candidate peaks at {fmtNum(vm.maxPeak, 0)} HU
              {vm.maxPeak < 200 && x.peakHU >= 200 ? ' and nothing reaches 200' : ''}. Real calcium hiding from my pipeline?</>
          : <>. Was it something my pipeline missed?</>}
      </p>
      <div className="cal-pn-eq" role="group" aria-label={`The ${x.peakHU} HU speck on the soft-tissue series is the same spot as candidate ${cand?.id ?? ''} on the calcium series`}>
        <div className="cal-pn-side">
          <span className="eyebrow">{st?.label ?? 'Soft-tissue series'}</span>
          <b className="mono">{fmtNum(x.peakHU, 0)}<small> HU</small></b>
          <span className="muted">{st?.kernel ? <>kernel <span className="mono">{st.kernel}</span>: sharper, noisier</> : 'sharper kernel'}</span>
        </div>
        <div className="cal-pn-eqsign" aria-hidden><span>=</span><small>same spot</small></div>
        <div className="cal-pn-side">
          <span className="eyebrow">{cal?.label ?? 'Calcium score'} series</span>
          <b className="mono">{cand ? <>{fmtNum(cand.peakHU, 0)}<small> HU</small></> : '–'}</b>
          <span className="muted">{cand ? <>candidate <span className="mono">#{cand.id}</span>{cal?.kernel ? <>, kernel <span className="mono">{cal.kernel}</span></> : null}</> : 'no matching candidate'}</span>
        </div>
      </div>
      <p className="cal-pn-x-say">
        {byAll ? `All ${n} reviewers` : `${n} independent check${n === 1 ? '' : 's'}`} re-ran the blob search on that series and traced the speck to the same
        spot as {cand ? <>candidate <b>#{cand.id}</b></> : 'a known candidate'}
        {allNoise
          ? <>: the same noise, seen through a sharper reconstruction kernel, which makes speckle read brighter.</>
          : <>. Their verdicts are below.</>}{' '}
        Agatston scoring is only defined on the calcium-score series{cand ? <>, where it peaks at {fmtNum(cand.peakHU, 0)} HU</> : null}.
      </p>
      <ul className="cal-pn-checks">
        {x.entries.map((e, i) => (
          <li key={i}>
            <span className={`cal-pn-tick ${/noise|artifact/i.test(e.verdict) ? '' : 'warn'}`} aria-hidden>{/noise|artifact/i.test(e.verdict) ? '✓' : '?'}</span>
            <div>
              <div className="cal-pn-check-v"><span className="muted">Re-check {i + 1}:</span> {prettyVerdict(e.verdict || 'no verdict given')}</div>
              {e.note && (
                <details className="cal-expand">
                  <summary>How it was checked</summary>
                  <RichText text={e.note} />
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="row wrap cal-pn-actions">
        {link && <button className="btn cyan small" onClick={() => navigate(link)}>See the speck on the soft-tissue series →</button>}
        {cand && <button className="btn small" onClick={() => onOpen(cand.id)}>Open candidate #{cand.id}</button>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------- outside the candidate list
function OutsideItem({ o }: { o: OutsideFinding }) {
  const longDetail = o.detail.length > 140
  const sev = o.severity !== null && o.severity in SEVERITY_LABEL ? SEVERITY_LABEL[o.severity as Severity] : null
  const link = o.lps && o.seriesKey ? sliceViewerLink(o.lps, o.seriesKey) : null
  return (
    <li className="cal-pn-out-item">
      <span className="cal-pn-out-dot" aria-hidden />
      <div className="cal-pn-out-main">
        <b className="cal-pn-out-title">{o.title}</b>
        {o.detail && !longDetail && <div className="cal-pn-out-detail">{o.detail}</div>}
        <div className="cal-pn-out-tags">
          {o.peakHU !== null && <span className="cal-tag mono" title="Brightest pixel">{fmtNum(o.peakHU, 0)} HU</span>}
          {o.areaMM2 !== null && <span className="cal-tag mono" title="Area on its biggest slice">{fmtNum(o.areaMM2, 1)} mm²</span>}
          {!o.coronary && <span className="cal-tag">not coronary</span>}
          {sev && <span className={`chip cal-chip-sm ${o.severity === 0 ? 'good' : 'warn'}`} title={`Severity ${o.severity} of 3`}>{sev}</span>}
        </div>
        {o.verdict && <div className="cal-pn-out-verdict">{o.verdict}</div>}
        {(longDetail || o.evidence.length > 0) && (
          <details className="cal-expand">
            <summary>Reviewer notes</summary>
            <RichText text={[longDetail ? o.detail : '', ...o.evidence.map((e) => `- ${e}`)].filter(Boolean).join('\n')} />
          </details>
        )}
      </div>
      {link && <button className="btn small cal-pn-out-go" onClick={() => navigate(link)} title="Open this spot in the slice viewer">View →</button>}
    </li>
  )
}

function Outside({ vm }: { vm: CalciumVM }) {
  const list = vm.outside
  const nCor = list.filter((o) => o.coronary).length
  const cartilage = list.every((o) => /cartilage/i.test(`${o.title} ${o.detail} ${o.verdict}`))
  const harmless = nCor === 0 && list.every((o) => o.severity === null || o.severity === 0)
  return (
    <section className={`cal-pn-out ${harmless ? 'ok' : ''}`} aria-labelledby="cal-pn-out-h">
      <div className="eyebrow">Found outside the candidate list</div>
      <h3 id="cal-pn-out-h">
        {list.length} extra calcification{list.length === 1 ? '' : 's'}
        {nCor === 0 ? `, none coronary${harmless ? ': all harmless' : ''}` : `, ${nCor} called coronary`}
      </h3>
      <p className="cal-pn-out-lede">
        The reviewers also hunted for bright spots my search region (heart and pericardial sac, minus bone) could have missed, and found{' '}
        {list.length}.{cartilage && (
          <> All of them sit in the <b>costal cartilage</b>, the flexible cartilage that joins the ribs to the breastbone at the front of the chest.
            It often calcifies in adults: a normal variant, outside the heart, and never part of a calcium score.</>
        )}
      </p>
      <ul className="cal-pn-outlist">
        {list.map((o, i) => <OutsideItem key={i} o={o} />)}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------------- the section body
export default function ReviewPanel({ vm, onOpen }: { vm: CalciumVM; onOpen: (id: number) => void }) {
  const { report } = vm
  const adj = report.adjudication
  if (!report.reviewed) {
    return (
      <div className="cal-adj pending">
        <div className="cal-adj-icon" aria-hidden><span className="cal-pulse" /></div>
        <div>
          <h3>AI review panel: pending</h3>
          <p className="muted">
            The automatic rules have run. Next, independent AI reviewers look at the {vm.pending.length} borderline candidate
            {vm.pending.length === 1 ? '' : 's'} (and the rest of the heart) and vote. Until then, the score at the top counts only
            what the rules confirmed{vm.counted.length ? '' : ', which is nothing'}, and it's marked <b style={{ color: 'var(--amber)' }}>provisional</b>.
          </p>
        </div>
      </div>
    )
  }
  if (!adj || !vm.reviewers.length) {
    return (
      <div className="cal-adj">
        <div>
          <h3>Reviewed</h3>
          <p className="muted">The borderline candidates were reviewed; each candidate's verdict is shown in the gallery below.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="cal-pn">
      <Tally vm={vm} />
      {adj.consensus && (
        <p className="cal-pn-consensus"><span className="eyebrow">Panel log</span> {adj.consensus}</p>
      )}
      <div className="cal-pn-grid">
        {vm.reviewers.map((r) => <ReviewerCard key={r.key} r={r} vm={vm} onOpen={onOpen} />)}
      </div>
      {vm.cross && <CrossCheckCard x={vm.cross} vm={vm} onOpen={onOpen} />}
      {vm.outside.length > 0 && <Outside vm={vm} />}
      {adj.openItems && adj.openItems.length > 0 && (
        <div className="cal-adj-open">
          <div className="eyebrow">Open items</div>
          <ul>{adj.openItems.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
