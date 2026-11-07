import { arteryName, fmtNum, fmtScore, frac01 } from './model'
import type { CalciumVM } from './useCalciumData'

export function Adjudication({ vm }: { vm: CalciumVM }) {
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
            what the rules confirmed, which is nothing, and it's marked <b style={{ color: 'var(--amber)' }}>provisional</b>.
          </p>
        </div>
      </div>
    )
  }
  if (!adj) {
    return (
      <div className="cal-adj">
        <div><h3>Reviewed</h3><p className="muted">Borderline candidates were reviewed; the verdicts are shown on each candidate above.</p></div>
      </div>
    )
  }
  return (
    <div className="cal-adj-wrap">
      {adj.consensus && (
        <div className="cal-adj-consensus">
          <div className="eyebrow">Consensus</div>
          <p>{adj.consensus}</p>
        </div>
      )}
      <div className="cal-adj-grid">
        {(adj.reviewers ?? []).map((r, i) => (
          <div key={r.key ?? i} className="cal-adj-card">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="chip info mono">{r.key}</span>
              <span className="muted" style={{ fontSize: 12 }} title="This reviewer's own Agatston estimate">estimate <b className="mono" style={{ color: 'var(--text)' }}>{fmtScore(r.agatstonEstimate)}</b></span>
            </div>
            <h4>{r.lens}</h4>
            <p>{r.summary}</p>
            {frac01(r.confidenceZero) !== null && (
              <div className="cal-conf" title="How confident this reviewer is that the true score is zero">
                <span>confidence the score is 0</span>
                <div className="cal-conf-bar"><div style={{ width: `${Math.round(frac01(r.confidenceZero)! * 100)}%` }} /></div>
                <b className="mono">{Math.round(frac01(r.confidenceZero)! * 100)}%</b>
              </div>
            )}
          </div>
        ))}
      </div>
      {adj.openItems && adj.openItems.length > 0 && (
        <div className="cal-adj-open">
          <div className="eyebrow">Open items</div>
          <ul>{adj.openItems.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

export default function Method({ vm }: { vm: CalciumVM }) {
  const { report, method: m } = vm
  const t = report.totals
  const arteries = Object.entries(report.perArtery ?? {})
  const hr = vm.exam?.ecg?.hrAvg
  const params: [string, string, string][] = [
    ['Series', m.series || '–', 'The ECG-gated calcium-score reconstruction, exactly as the scanner made it'],
    ['Threshold', `${m.threshold} HU`, 'Agatston 1990; unchanged so scores are comparable everywhere'],
    ['Minimum area', `${m.minArea} mm²`, 'Smaller specks are ignored on each slice'],
    ['Slices', `${m.thickness} mm every ${m.increment} mm`, `Overlapping, so the sum is multiplied by ${m.overlap}`],
    ['Density weights', m.bands.map((b) => `${b.min}${Number.isFinite(b.max) ? `–${b.max}` : '+'}: ×${b.weight}`).join(' · '), 'From each spot’s brightest pixel on that slice'],
    ['Search region', m.searchRegion || '–', 'AI segmentation masks (TotalSegmentator) decide where to look'],
    ['Mass calibration', m.massCal ? `${m.massCal} mg per HU·cm³` : '–', 'A typical 120 kV value; no calibration phantom was scanned'],
  ]
  return (
    <div className="cal-method">
      <div className="cal-method-grid">
        <div>
          <h3>What I did</h3>
          <dl className="cal-params">
            {params.map(([k, v, h]) => (
              <div key={k}><dt>{k}</dt><dd>{v}<small>{h}</small></dd></div>
            ))}
          </dl>
          <div className="cal-evenodd" title="Each set of every-other slice is a complete, non-overlapping 3 mm scan">
            <b>Even/odd cross-check:</b> scoring only the even slices gives <span className="mono">{fmtScore(t.agatstonEven)}</span>, only the odd
            slices <span className="mono">{fmtScore(t.agatstonOdd)}</span>. Each set is a complete, non-overlapping scan on its own; the overlap-corrected total is
            their average: <span className="mono">{fmtScore(t.agatston)}</span>.
          </div>
          {arteries.length > 0 && (
            <div className="cal-table-wrap" style={{ marginTop: 14 }}>
              <table className="data">
                <thead><tr><th>Artery</th><th className="num">Agatston</th><th className="num">Volume</th><th className="num">Mass</th><th className="num">Lesions</th></tr></thead>
                <tbody>
                  {arteries.map(([a, v]) => (
                    <tr key={a}>
                      <td>{arteryName(a)}</td>
                      <td className="num">{fmtScore(v.agatston)}</td>
                      <td className="num">{fmtNum(v.volume_mm3, 1)} mm³</td>
                      <td className="num">{fmtNum(v.mass_mg, 1)} mg</td>
                      <td className="num">{v.lesions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <h3>What I can't do (limitations)</h3>
          <ul className="cal-limits">
            <li><b>No calibration phantom.</b> A mass score is best calibrated with a reference phantom scanned alongside the patient. There is none here, so I assume a typical {m.massCal ?? 0.743} mg per HU·cm³ and the mass score is only an estimate. (The Agatston score itself needs no phantom.)</li>
            <li><b>No artery tracing.</b> Without contrast dye, the coronary arteries are hard to see. A radiologist follows each artery by eye; I use AI segmentation masks (TotalSegmentator) plus explicit rules and AI reviewers, which can be off by a few millimetres.</li>
            <li><b>Low-dose noise.</b> {Number.isFinite(report.noise?.thresholdInSigmasAboveBlood)
              ? <>The {m.threshold} HU bar sits only {fmtNum(report.noise.thresholdInSigmasAboveBlood, 2)} noise-widths above blood here, so</>
              : <>On a low-dose scan</>} a speck of real calcium and a speck of noise can look alike.</li>
            <li><b>Tiny or faint plaque is invisible by definition.</b> Anything under {m.minArea} mm² or {m.threshold} HU is not counted, by me or anyone else.</li>
            {hr ? <li><b>Motion.</b> The heart rate during the scan averaged {hr} bpm; faster hearts blur more, which can smear or hide small specks.</li> : null}
            <li><b>Software differs.</b> Vendors handle connectivity, partial volume and slice overlap slightly differently, so even official tools disagree by a few points on small scores.</li>
          </ul>
        </div>
      </div>
      <p className="disclaimer" style={{ marginTop: 18 }}>
        Not a medical device. The official radiologist report is what counts. This page is a curious patient re-doing the arithmetic
        on his own pixels, for fun and for learning. Sorry, radiologists: you're still very much needed.
      </p>
    </div>
  )
}
