import { useState } from 'react'
import { dataUrl } from '../../lib/data'
import { useWidth } from './hooks'
import { fmtNum, gaussTail, perMillionText, pct, verdict, VERDICT_ORDER, type TopogramMeta } from './model'
import type { CalciumVM } from './useCalciumData'

// ---------------------------------------------------------------------------------- funnel
interface Seg { key: string; n: number; color: string; label: string }

function SegBar({ segs, unit, total }: { segs: Seg[]; unit: number; total: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const live = segs.filter((s) => s.n > 0)
  return (
    <div className="cal-fbar-track" role="img" aria-label={live.map((s) => `${s.n} ${s.label}`).join(', ')}>
      <div className="cal-fbar-segs" style={{ width: `${Math.max(1.5, (total / unit) * 100)}%` }}>
        {live.map((s) => {
          const w = (s.n / total) * 100
          return (
            <div key={s.key} className={`cal-fseg ${hover === s.key ? 'hot' : ''}`} style={{ width: `${w}%`, background: s.color }}
              onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)} title={`${s.n} ${s.label}`}>
              {w > 22 && <span>{s.n} {s.label}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Funnel({ vm }: { vm: CalciumVM }) {
  const { report, method: m } = vm
  const nC = report.candidates.length
  const unit = Math.max(vm.nBlobs, nC, 1)
  const segsFrom = (counts: Map<string, number>) =>
    VERDICT_ORDER.concat([...counts.keys()].filter((k) => !VERDICT_ORDER.includes(k)))
      .filter((k) => counts.get(k))
      .map((k) => ({ key: k, n: counts.get(k) ?? 0, color: verdict(k).color, label: verdict(k).short.toLowerCase() }))
  const ruleSegs = segsFrom(vm.ruleCounts)
  const finalSegs = segsFrom(vm.finalCounts)
  return (
    <ol className="cal-funnel">
      <li>
        <div className="cal-fnum">{vm.nBlobs}</div>
        <div className="cal-fbody">
          <div className="cal-ftitle">bright blobs on single slices</div>
          <div className="cal-fdesc">≥{m.threshold} HU and ≥{m.minArea} mm² on one {m.thickness} mm slice, inside the search region (pericardial sac + margin, bone removed).</div>
          <div className="cal-fbar-track"><div className="cal-fbar" style={{ width: `${(vm.nBlobs / unit) * 100}%` }} /></div>
        </div>
      </li>
      <li>
        <div className="cal-fnum">{nC}</div>
        <div className="cal-fbody">
          <div className="cal-ftitle">3D candidates</div>
          <div className="cal-fdesc">Blobs that touch on neighbouring slices are merged into one object and measured: peak HU, area, depth inside the heart, distance to the aorta, which chamber it sits in.</div>
          <div className="cal-fbar-track"><div className="cal-fbar" style={{ width: `${(nC / unit) * 100}%` }} /></div>
        </div>
      </li>
      <li>
        <div className="cal-fnum cal-fnum-split">
          {ruleSegs.map((s, i) => <span key={s.key} style={{ color: s.color }}>{i > 0 && <i>/</i>}{s.n}</span>)}
        </div>
        <div className="cal-fbody">
          <div className="cal-ftitle">automatic triage rules</div>
          <div className="cal-fdesc">Each candidate is checked against simple, explicit rules. A candidate is ruled out as noise if any of these apply:</div>
          <ul className="cal-reasons">
            {vm.reasonCounts.map(([r, n]) => (
              <li key={r}><span className="mono cal-reason-n">{n}×</span> {r}</li>
            ))}
          </ul>
          <SegBar segs={ruleSegs} unit={unit} total={nC} />
          <Legend segs={ruleSegs} />
        </div>
      </li>
      <li>
        <div className="cal-fnum cal-fnum-split">
          {report.reviewed
            ? finalSegs.map((s, i) => <span key={s.key} style={{ color: s.color }}>{i > 0 && <i>/</i>}{s.n}</span>)
            : <span style={{ color: 'var(--amber)' }}>{vm.pending.length}</span>}
        </div>
        <div className="cal-fbody">
          <div className="cal-ftitle">{report.reviewed ? 'AI adjudication' : 'waiting for AI adjudication'}</div>
          <div className="cal-fdesc">
            {report.reviewed
              ? <>Independent AI reviewers looked at the borderline candidates (and the rest of the heart) and gave a verdict for each.</>
              : <>The {vm.pending.length} candidate{vm.pending.length === 1 ? '' : 's'} that survived every rule {vm.pending.length === 1 ? 'goes' : 'go'} to independent AI reviewers. Until they vote, {vm.pending.length === 1 ? 'it is' : 'they are'} <b>not</b> counted.</>}
          </div>
          {report.reviewed && <><SegBar segs={finalSegs} unit={unit} total={nC} /><Legend segs={finalSegs} /></>}
        </div>
      </li>
      <li className={`cal-funnel-end ${vm.counted.length ? 'pos' : ''}`}>
        <div className="cal-fnum" style={{ color: vm.counted.length ? 'var(--heart)' : 'var(--green)' }}>{vm.counted.length}</div>
        <div className="cal-fbody">
          <div className="cal-ftitle">coronary lesions counted → score {fmtNum(report.totals.agatston, 1)}</div>
          <div className="cal-fdesc">
            {vm.counted.length === 0
              ? <>Nothing made it to the end, so the Agatston score is <b>0</b>.</>
              : <>Only these lesions are scored: {vm.counted.map((c) => `#${c.id}${c.artery ? ` (${c.artery})` : ''}`).join(', ')}.</>}
          </div>
        </div>
      </li>
    </ol>
  )
}

function Legend({ segs }: { segs: Seg[] }) {
  return (
    <div className="cal-legend">
      {segs.map((s) => (
        <span key={s.key}><i style={{ background: s.color }} />{s.n} {s.label}</span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------- noise bell
function NoiseBell({ vm }: { vm: CalciumVM }) {
  const [ref, w] = useWidth<HTMLDivElement>(620)
  const W = Math.max(280, w)
  const n = vm.report.noise
  const mu = n.heartInteriorMeanHU, sd = n.heartInteriorSD_HU
  const thr = vm.method.threshold
  const hu0 = Math.floor((mu - 3.2 * sd) / 10) * 10
  const hu1 = Math.max(thr, vm.maxPeak) + 25
  const pad = { l: 10, r: 14, t: 30, b: 46 }
  const H = W < 480 ? 210 : 250
  const x = (hu: number) => pad.l + ((hu - hu0) / (hu1 - hu0)) * (W - pad.l - pad.r)
  const plotH = H - pad.t - pad.b
  const pdf = (v: number) => Math.exp(-0.5 * ((v - mu) / sd) ** 2)
  const y = (p: number) => pad.t + plotH - p * plotH * 0.92
  const pts: string[] = []
  for (let v = hu0; v <= hu1; v += (hu1 - hu0) / 160) pts.push(`${x(v).toFixed(1)},${y(pdf(v)).toFixed(1)}`)
  const area = `M${x(hu0)},${y(0)} L${pts.join(' L')} L${x(hu1)},${y(0)} Z`
  const sig = n.thresholdInSigmasAboveBlood
  const sigmas = [1, 2, 3, 4].filter((k) => mu + k * sd < thr - 4)
  const peaks = vm.report.candidates.map((c) => ({ id: c.id, hu: c.peakHU, color: verdict(c.finalClass).color }))
  const minPk = peaks.length ? Math.min(...peaks.map((p) => p.hu)) : thr
  const maxPk = peaks.length ? Math.max(...peaks.map((p) => p.hu)) : thr
  return (
    <div className="cal-card cal-fig">
      <div className="cal-fig-head">
        <div className="eyebrow">Noise, in numbers</div>
        <h3>Inside the heart: {fmtNum(mu, 1)} ± {fmtNum(sd, 1)} HU</h3>
      </div>
      <div ref={ref} className="cal-chart cal-fig-chart">
        <svg width={W} height={H} role="img"
          aria-label={`Bell curve of pixel values inside the heart, mean ${mu} HU, standard deviation ${sd} HU. The ${thr} HU threshold sits ${sig} standard deviations above the mean. Candidate peaks range from ${minPk} to ${maxPk} HU.`}>
          <path d={area} fill="rgba(56,214,255,0.10)" />
          {sigmas.map((k) => (
            <g key={k}>
              <line x1={x(mu + k * sd)} x2={x(mu + k * sd)} y1={pad.t - 6} y2={y(0)} stroke="rgba(255,255,255,0.07)" />
              <text x={x(mu + k * sd)} y={pad.t - 12} textAnchor="middle" className="cal-svg-tick">+{k}σ</text>
            </g>
          ))}
          <polyline points={pts.join(' ')} fill="none" stroke="var(--cyan)" strokeWidth={2} strokeLinejoin="round" />
          <line x1={x(mu)} x2={x(mu)} y1={y(1)} y2={y(0)} stroke="rgba(56,214,255,0.45)" />
          <text x={x(mu) - 8} y={y(1) + 4} textAnchor="end" className="cal-svg-lbl">mean {fmtNum(mu, 1)}</text>
          {/* threshold */}
          <rect x={x(thr)} y={pad.t - 20} width={x(hu1) - x(thr)} height={plotH + 20} fill="rgba(255,77,94,0.07)" />
          <line x1={x(thr)} x2={x(thr)} y1={pad.t - 20} y2={y(0)} stroke="var(--heart)" strokeWidth={2} />
          <text x={x(thr) + 7} y={pad.t - 4} className="cal-svg-lbl" style={{ fill: 'var(--heart-2)', fontWeight: 700 }}>{thr} HU</text>
          <text x={x(thr) + 7} y={pad.t + 11} className="cal-svg-sub">+{fmtNum(sig, 2)}σ above the mean</text>
          {/* candidate peak rug */}
          {peaks.map((p) => (
            <line key={p.id} x1={x(p.hu)} x2={x(p.hu)} y1={y(0) - 26} y2={y(0) - 4} stroke={p.color} strokeWidth={1.6} opacity={0.9} />
          ))}
          {peaks.length > 0 && <text x={(x(minPk) + x(maxPk)) / 2} y={y(0) - 32} textAnchor="middle" className="cal-svg-sub">{peaks.length} candidate peaks</text>}
          <line x1={x(hu0)} x2={x(hu1)} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
          {[0, 50, 100, 150, 200].filter((t) => t >= hu0 && t <= hu1).map((t) => (
            <text key={t} x={x(t)} y={y(0) + 15} textAnchor="middle" className="cal-svg-tick">{t}</text>
          ))}
          <text x={W - pad.r} y={y(0) + 33} textAnchor="end" className="cal-svg-sub">pixel value (HU)</text>
        </svg>
      </div>
      <p className="cal-cap cal-fig-text">
        Without contrast dye, blood and heart muscle look the same: <b>{fmtNum(mu, 1)} HU</b> on average, but every pixel jitters by about
        ±<b>{fmtNum(sd, 1)} HU</b> (one standard deviation, σ). The {thr} HU bar sits <b>{fmtNum(sig, 2)}σ</b> above that average.
        <br /><br />
        For one independent pixel that's {perMillionText(gaussTail(sig))}. But the search region holds millions of pixels, and CT noise
        comes in small grains rather than single pixels, so now and then a whole speck crosses the line together.
        <br /><br />
        {peaks.length > 0 && <>All {peaks.length} candidates peaked between <b>{fmtNum(minPk, 0)}</b> and <b>{fmtNum(maxPk, 0)} HU</b>{maxPk < 200 ? <>: just over the line, and none reached 200 HU</> : null}.</>}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------------- band figure
function BandFigure({ vm }: { vm: CalciumVM }) {
  const [ref, w] = useWidth<HTMLDivElement>(620)
  const W = Math.max(280, w)
  const topo: TopogramMeta | undefined = vm.exam?.topograms?.ap
  const vol = vm.vol
  const counts = vm.perSlice
  const nS = counts.length
  const band = vm.band
  const maxC = Math.max(1, ...counts)
  const dz = vol ? Math.abs(vol.spacing[2]) : vm.method.increment

  // vertical mapping: slice -> topogram row (or a plain slice axis when there is no topogram)
  const hasTopo = !!(topo && vol && topo.position?.length === 3 && topo.pixelSpacing?.length === 2)
  const rowOf = (z: number) => (hasTopo ? (topo!.position[2] - z) / topo!.pixelSpacing[0] - (topo!.crop?.[0] ?? 0) : 0)
  const z0 = vm.sliceZ(0) ?? 0, zN = vm.sliceZ(nS - 1) ?? nS * dz
  const rowTop = hasTopo ? rowOf(Math.max(z0, zN) + dz) - 10 : 0
  const rowBot = hasTopo ? rowOf(Math.min(z0, zN) - dz) + 10 : 0
  const narrow = W < 480
  const colSpan = narrow ? 112 : 170
  const imgW = Math.round(W * (narrow ? 0.5 : 0.5))
  const s = hasTopo ? imgW / colSpan : 1
  const H = hasTopo ? Math.round((rowBot - rowTop) * s) : Math.max(240, nS * 3)
  // horizontal centre of the topogram crop = centre of the calcium field of view
  const cx = vol ? vol.origin[0] + (vol.dims[0] * vol.spacing[0]) / 2 : 0
  const colC = hasTopo ? (cx - topo!.position[0]) / topo!.pixelSpacing[1] - (topo!.crop?.[2] ?? 0) : 0
  const col0 = colC - colSpan / 2
  const yOfSlice = (k: number) => {
    if (!hasTopo) return 10 + ((nS - 1 - k) / Math.max(1, nS - 1)) * (H - 30)
    return (rowOf(vm.sliceZ(k) ?? 0) - rowTop) * s
  }
  const sliceH = Math.max(1.2, Math.abs(yOfSlice(1) - yOfSlice(0)))
  const histX = hasTopo ? imgW + 12 : 40
  const histW = W - histX - 4
  const labelRoom = narrow ? 56 : 74
  const bx = (c: number) => histX + (c / maxC) * (histW - labelRoom)
  const bandTop = band ? yOfSlice(band.to) - sliceH / 2 : 0
  const bandBot = band ? yOfSlice(band.from) + sliceH / 2 : 0
  const bandMM = band ? (band.to - band.from + 1) * dz : 0
  const rest = vm.nBlobs - (band?.blobs ?? 0)
  const restSlices = counts.map((c, i) => (c > 0 && band && (i < band.from || i > band.to) ? i : -1)).filter((i) => i >= 0)
  const nearSeam = band && vm.seams.length ? vm.seams.reduce((best, sm) => {
    const d = sm < band.from ? band.from - sm : sm > band.to ? sm - band.to : 0
    return d < best.d ? { d, sm } : best
  }, { d: Infinity, sm: -1 }) : null
  const seamClose = !!nearSeam && nearSeam.d <= 4
  const ticksC = [0, Math.round(maxC / 2), maxC].filter((v, i, a) => a.indexOf(v) === i)
  // table-step slabs (alternating shading), from the seams
  const edges = [nS - 1 + 0.5, ...vm.seams.slice().sort((a, b) => b - a), -0.5]
  return (
    <div className="cal-card cal-fig">
      <div className="cal-fig-head">
        <div className="eyebrow">Noise, in space</div>
        <h3>Where along the body the {vm.nBlobs} blobs sit</h3>
      </div>
      <div ref={ref} className="cal-chart cal-fig-chart">
        <svg width={W} height={H + 36} role="img"
          aria-label={`Blob count per slice along the scan. ${band ? `${band.blobs} of ${vm.nBlobs} blobs sit in slices ${band.from} to ${band.to}.` : ''}`}>
          <defs>
            <clipPath id="calTopoClip"><rect x={0} y={0} width={imgW} height={H} rx={8} /></clipPath>
            <linearGradient id="calBandGrad" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(255,77,94,0.5)" />
              <stop offset="1" stopColor="rgba(255,77,94,0.15)" />
            </linearGradient>
          </defs>
          {hasTopo && (
            <g clipPath="url(#calTopoClip)">
              <rect x={0} y={0} width={imgW} height={H} fill="#000" />
              <image href={dataUrl(topo!.png)} x={-col0 * s} y={-rowTop * s} width={(topo!.shape?.[1] ?? 512) * s} height={(topo!.shape?.[0] ?? 228) * s}
                preserveAspectRatio="none" style={{ filter: 'contrast(1.25) brightness(0.78)' }} />
              {edges.slice(0, -1).map((e, i) => (
                <rect key={i} x={0} y={yOfSlice(e)} width={imgW} height={Math.max(0, yOfSlice(edges[i + 1]) - yOfSlice(e))}
                  fill={i % 2 ? 'rgba(56,214,255,0.07)' : 'rgba(7,9,13,0.12)'} />
              ))}
              {vm.seams.map((sm) => (
                <line key={sm} x1={0} x2={imgW} y1={yOfSlice(sm)} y2={yOfSlice(sm)} stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
              ))}
              <rect x={0.5} y={yOfSlice(nS - 1) - sliceH / 2} width={imgW - 1} height={yOfSlice(0) - yOfSlice(nS - 1) + sliceH} fill="none" stroke="rgba(56,214,255,0.6)" />
              {band && <rect x={0} y={bandTop} width={imgW} height={bandBot - bandTop} fill="url(#calBandGrad)" stroke="rgba(255,120,130,0.95)" strokeWidth={1.2} />}
            </g>
          )}
          {hasTopo && (
            <>
              <text x={8} y={yOfSlice(nS - 1) - sliceH / 2 + 15} className="cal-svg-sub" style={{ fill: 'var(--cyan-2)' }}>calcium scan</text>

            </>
          )}
          {/* histogram */}
          <line x1={histX} x2={histX} y1={yOfSlice(nS - 1) - sliceH} y2={yOfSlice(0) + sliceH} stroke="var(--line-2)" />
          {counts.map((c, k) => c > 0 && (
            <rect key={k} x={histX + 1} y={yOfSlice(k) - sliceH / 2 + 0.35} width={Math.max(2, bx(c) - histX)} height={Math.max(1, sliceH - 0.7)} rx={Math.min(2, sliceH / 3)}
              fill={band && k >= band.from && k <= band.to ? 'var(--heart)' : '#8a97a8'}>
              <title>{`slice ${k}: ${c} blob${c === 1 ? '' : 's'}`}</title>
            </rect>
          ))}
          {band && (
            <g>
              <text x={bx(maxC) + 8} y={(bandTop + bandBot) / 2 - 2} className="cal-svg-lbl" style={{ fontWeight: 700 }}>{band.blobs} blobs</text>
              <text x={bx(maxC) + 8} y={(bandTop + bandBot) / 2 + 12} className="cal-svg-sub">in {fmtNum(bandMM, 1)} mm</text>
            </g>
          )}
          {restSlices.length > 0 && (
            <text x={bx(Math.max(...restSlices.map((k) => counts[k]))) + 8} y={(yOfSlice(Math.min(...restSlices)) + yOfSlice(Math.max(...restSlices))) / 2 + 4} className="cal-svg-sub">{rest} more</text>
          )}
          <line x1={histX} x2={bx(maxC)} y1={H + 2} y2={H + 2} stroke="var(--line-2)" />
          {ticksC.map((t) => (
            <text key={t} x={bx(t)} y={H + 16} textAnchor="middle" className="cal-svg-tick">{t}</text>
          ))}
          <text x={histX} y={H + 31} className="cal-svg-sub">blobs per slice</text>
        </svg>
        {hasTopo && (
          <div className="cal-fig-legend">
            <span><i className="ln" />seam between table steps (≈)</span>
            <span><i style={{ background: 'rgba(255,77,94,0.7)' }} />busiest band</span>
            <span><i className="box" />calcium scan range</span>
          </div>
        )}
      </div>
      <p className="cal-cap cal-fig-text">
        {band ? (
          <>
            <b>{band.blobs} of the {vm.nBlobs}</b> blobs ({pct(band.blobs / Math.max(1, vm.nBlobs))}) sit in one <b>{fmtNum(bandMM, 1)} mm band</b> (slices {band.from}–{band.to}).
            {seamClose && vm.nSteps ? (
              <> That band sits right next to a seam between two of the scanner's <b>{vm.nSteps} table steps</b>.
                <br /><br />
                In this step-and-shoot mode the table moves between heartbeats and each step images a slab of the heart in a different beat.
                The slab edges don't match perfectly, and here the heart comes out a little brighter, so ordinary noise crosses {vm.method.threshold} HU far more often.</>
            ) : (
              <> Noise isn't spread evenly: some parts of the image come out a little brighter or grainier than others.</>
            )}
            {rest > 0 && restSlices.length > 0 && (
              <><br /><br />The other {rest} sit {Math.max(...restSlices) < band.from ? 'lower down' : 'elsewhere'} (slices {Math.min(...restSlices)}–{Math.max(...restSlices)}){Math.max(...restSlices) < band.from ? ', near the bottom of the heart, where the X-rays also pass through the liver and diaphragm and the image is grainier' : ''}.</>
            )}
          </>
        ) : 'No blobs crossed the threshold.'}
        {hasTopo && <><br /><br /><span className="muted">Background: the scout X-ray taken just before the scan. Seam positions assume {vm.nSteps ?? 'equal'} equal steps.</span></>}
      </p>
    </div>
  )
}

export default function Pipeline({ vm }: { vm: CalciumVM }) {
  const dose = vm.exam?.dose
  return (
    <>
      <Funnel vm={vm} />
      <div className="cal-subhead">
        <h3>Why so many false alarms?</h3>
        <p className="muted">
          A calcium-score scan is deliberately low-dose
          {dose?.ctdivol_mGy ? <> (CTDIvol <b>{fmtNum(dose.ctdivol_mGy, 1)} mGy</b>{dose.dlpTotal_mGycm ? <>, DLP {fmtNum(dose.dlpTotal_mGycm, 0)} mGy·cm</> : null})</> : null}.
          Fewer X-ray photons means a grainier image: great for the patient, but it means some noise pokes above {vm.method.threshold} HU by pure chance.
        </p>
      </div>
      <div className="cal-figs">
        {Number.isFinite(vm.report.noise?.heartInteriorMeanHU) && Number.isFinite(vm.report.noise?.heartInteriorSD_HU) && <NoiseBell vm={vm} />}
        {vm.nBlobs > 0 && <BandFigure vm={vm} />}
      </div>
    </>
  )
}
