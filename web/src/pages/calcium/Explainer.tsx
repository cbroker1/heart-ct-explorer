import { useWidth } from './hooks'
import { candidateBreakdown, fmtNum, fmtScore, verdict } from './model'
import type { CalciumVM } from './useCalciumData'

/** Three cross-sections of a coronary artery: healthy, soft plaque, calcified plaque. */
function ArteryStages() {
  const stage = (x: number, kind: 0 | 1 | 2) => (
    <g transform={`translate(${x},62)`}>
      {/* epicardial fat halo */}
      <circle r={50} fill="rgba(255,210,122,0.05)" />
      {/* vessel wall */}
      <circle r={38} fill="#6b2a33" />
      <circle r={38} fill="none" stroke="rgba(255,255,255,0.10)" />
      {kind === 0 ? (
        <circle r={29} fill="#a3202f" />
      ) : (
        <>
          {/* narrowed lumen, pushed down by the plaque */}
          <ellipse cx={0} cy={10} rx={24} ry={17} fill="#a3202f" />
          {/* plaque crescent between the wall and the lumen */}
          <path d="M-30 -11 A32 32 0 0 1 30 -11 Q0 -3 -30 -11 Z" fill="#e8c46f" opacity={0.92} />
        </>
      )}
      {kind === 2 && (
        <g filter="url(#calGlow)">
          <path d="M-21 -17 q5 -7 12 -8 q-1 6 -9 10 z" fill="#fff" />
          <path d="M1 -25 q9 -2 14 3 q-7 3 -14 1 z" fill="#fff" />
          <circle cx={21} cy={-15} r={2.6} fill="#fff" />
        </g>
      )}
    </g>
  )
  const cap = (x: number, t: string, s: string, c: string) => (
    <g transform={`translate(${x},138)`}>
      <text textAnchor="middle" className="cal-svg-lbl" style={{ fontWeight: 650 }}>{t}</text>
      <text y={16} textAnchor="middle" className="cal-svg-sub" style={{ fill: c }}>{s}</text>
    </g>
  )
  return (
    <svg viewBox="0 0 420 170" className="cal-artery" role="img"
      aria-label="Three cross-sections of a coronary artery: healthy; with soft plaque, which this scan cannot see; with calcified plaque, which shows up bright">
      <defs>
        <filter id="calGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {stage(70, 0)}
      {stage(210, 1)}
      {stage(350, 2)}
      <path d="M128 62 h22 m-6 -5 l6 5 l-6 5 M268 62 h22 m-6 -5 l6 5 l-6 5" stroke="var(--faint)" strokeWidth={1.5} fill="none" />
      {cap(70, 'Healthy', 'smooth wall', 'var(--muted)')}
      {cap(210, 'Soft plaque', 'invisible on this scan', 'var(--amber)')}
      {cap(350, 'Calcified plaque', 'bright: ≥130 HU', '#fff')}
    </svg>
  )
}

/** The Agatston density weights as a staircase on a HU ruler, with this scan's landmarks. */
function WeightStairs({ vm }: { vm: CalciumVM }) {
  const [ref, w] = useWidth<HTMLDivElement>(560)
  const W = Math.max(300, w)
  const m = vm.method
  const pad = { l: 12, r: 18, t: 30, b: 58 }
  const H = 210
  const hu0 = -20, hu1 = 520
  const x = (hu: number) => pad.l + ((hu - hu0) / (hu1 - hu0)) * (W - pad.l - pad.r)
  const plotH = H - pad.t - pad.b
  const maxW = Math.max(...m.bands.map((b) => b.weight))
  const y = (wt: number) => pad.t + plotH - (wt / maxW) * plotH
  const blood = vm.report.noise?.heartInteriorMeanHU
  const small = W < 460
  const ticks = [0, 100, 200, 300, 400, 500]
  const landmarks: { hu: number; label: string; sub: string; color: string }[] = []
  if (typeof blood === 'number') landmarks.push({ hu: blood, label: `${fmtNum(blood, 1)} HU`, sub: small ? 'blood/muscle' : 'blood & muscle here', color: 'var(--muted)' })
  if (vm.maxPeak > 0) landmarks.push({ hu: vm.maxPeak, label: `${fmtNum(vm.maxPeak, 0)} HU`, sub: small ? 'brightest here' : 'brightest candidate', color: 'var(--amber)' })
  return (
    <div ref={ref} className="cal-stairs">
      <svg width={W} height={H} role="img"
        aria-label={`Density weights: ${m.bands.map((b) => `${b.min}${Number.isFinite(b.max) ? `–${b.max}` : '+'} HU weight ${b.weight}`).join(', ')}. Brightest candidate in this scan: ${fmtNum(vm.maxPeak, 0)} HU.`}>
        <defs>
          <linearGradient id="calNoiseFade" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(138,151,168,0.0)" />
            <stop offset="1" stopColor="rgba(138,151,168,0.10)" />
          </linearGradient>
        </defs>
        {/* below-threshold zone */}
        <rect x={x(hu0)} y={pad.t} width={x(m.threshold) - x(hu0)} height={plotH} fill="url(#calNoiseFade)" />
        <text x={(x(hu0) + x(m.threshold)) / 2} y={pad.t + plotH / 2} textAnchor="middle" className="cal-svg-sub">not counted</text>
        {m.bands.map((b, i) => {
          const x0 = x(b.min), x1 = x(Number.isFinite(b.max) ? b.max + 1 : hu1)
          return (
            <g key={b.min}>
              <rect x={x0 + 1} y={y(b.weight)} width={Math.max(2, x1 - x0 - 2)} height={pad.t + plotH - y(b.weight)} rx={4}
                fill="var(--heart)" opacity={0.3 + (0.7 * (i + 1)) / m.bands.length} />
              <text x={(x0 + x1) / 2} y={y(b.weight) - 8} textAnchor="middle" className="cal-svg-lbl" style={{ fontWeight: 700 }}>×{b.weight}</text>
            </g>
          )
        })}
        {/* threshold */}
        <line x1={x(m.threshold)} x2={x(m.threshold)} y1={pad.t - 18} y2={pad.t + plotH} stroke="#fff" strokeWidth={1.5} />
        <text x={x(m.threshold) - 5} y={pad.t - 8} textAnchor="end" className="cal-svg-lbl" style={{ fontWeight: 700 }}>{m.threshold} HU threshold</text>
        {/* axis */}
        <line x1={x(hu0)} x2={x(hu1)} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--line-2)" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={pad.t + plotH + 14} textAnchor="middle" className="cal-svg-tick">{t}</text>
        ))}
        <text x={x(hu1)} y={pad.t + plotH + 14} textAnchor="end" className="cal-svg-tick" dx={14}>HU</text>
        {landmarks.map((l, i) => (
          <g key={l.label} transform={`translate(${x(l.hu)},${pad.t + plotH})`}>
            <path d="M0 0 v24" stroke={l.color} strokeWidth={1.5} />
            <circle cy={0} r={3.5} fill={l.color} />
            <text y={36} textAnchor={i === 0 ? 'middle' : 'start'} dx={i === 0 ? 0 : -6} className="cal-svg-lbl" style={{ fill: l.color, fontWeight: 650 }}>{l.label}</text>
            <text y={50} textAnchor={i === 0 ? 'middle' : 'start'} dx={i === 0 ? 0 : -6} className="cal-svg-sub">{l.sub}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function WorkedExample({ vm }: { vm: CalciumVM }) {
  const m = vm.method
  // the biggest thing that is (or could be) counted: coronary first, then pending, then anything
  const pool = vm.counted.length ? vm.counted : vm.pending.length ? vm.pending : vm.candidates
  const ex = pool
    .map((c) => ({ c, b: candidateBreakdown(c, m) }))
    .sort((a, b) => b.b.score - a.b.score)[0]
  if (!ex) return null
  const v = verdict(ex.c.finalClass)
  return (
    <div className="cal-worked">
      <div className="cal-worked-text">
        <div className="eyebrow">Worked example with a real candidate</div>
        <p className="muted" style={{ marginTop: 6 }}>
          Candidate <b className="mono">#{ex.c.id}</b> is the biggest {vm.counted.length ? 'lesion that was counted' : vm.pending.length ? 'borderline spot in this scan' : 'bright spot in this scan'}.
          Here is exactly what it {v.counted ? 'adds' : 'would add if it were coronary plaque'}: each spot's area times its weight, summed, then
          halved for the overlapping slices.
        </p>
        <p className="cal-foot">
          {v.counted
            ? <>This lesion is counted, so it contributes these points to the total.</>
            : <>Verdict for #{ex.c.id}: <b style={{ color: v.color }}>{v.label.toLowerCase()}</b>, so it adds <b>0</b> to the real score.</>}
        </p>
      </div>
      <div className="cal-table-wrap">
        <table className="data cal-worked-table">
          <thead>
            <tr><th>Slice / spot</th><th className="num">Area</th><th className="num">Peak</th><th className="num">Weight</th><th className="num">Area × weight</th></tr>
          </thead>
          <tbody>
            {ex.b.rows.map((r, i) => {
              const same = ex.b.rows.filter((q) => q.z === r.z)
              const tag = same.length > 1 ? String.fromCharCode(97 + same.indexOf(r)) : ''
              return (
              <tr key={i}>
                <td className="mono" title={tag ? `Two separate spots on slice ${r.z}` : undefined}>{r.z}{tag && <span className="muted">{tag}</span>}</td>
                <td className="num">{fmtNum(r.area, 2)} mm²</td>
                <td className="num">{fmtNum(r.peak, 0)} HU</td>
                <td className="num">×{r.weight}</td>
                <td className="num">{fmtNum(r.points, 2)}</td>
              </tr>
              )
            })}
            <tr className="sum">
              <td colSpan={4}>Sum over slices</td>
              <td className="num">{fmtNum(ex.b.raw, 2)}</td>
            </tr>
            <tr className="sum">
              <td colSpan={4}>× {m.overlap} overlap correction ({m.thickness} mm slices every {m.increment} mm)</td>
              <td className="num"><b>{fmtScore(+ex.b.score.toFixed(1))}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Explainer({ vm }: { vm: CalciumVM }) {
  const m = vm.method
  const px = vm.vol ? vm.vol.spacing[0] * vm.vol.spacing[1] : null
  return (
    <div className="cal-explain">
      <div className="cal-explain-top">
        <div className="cal-explain-text">
          <p className="cal-lead">
            Your heart muscle is fed by its own small arteries, the <b>coronary arteries</b>, which run over the heart's surface.
            Over decades, fatty <b>plaque</b> can build up in their walls, and as plaque matures some of it turns to <b>calcium</b>.
          </p>
          <p>
            Calcium is dense, so it lights up on CT even without any contrast dye. In <b>1990</b>, cardiologist Arthur Agatston
            proposed simply measuring it: the <b>coronary artery calcium (CAC) score</b>. It works because calcium is a footprint
            of plaque: the more calcium, the more plaque overall. In large studies, people with higher scores have more heart
            attacks, independently of cholesterol and blood pressure, and people with a score of zero have very few.
          </p>
          <p className="cal-src">
            Agatston AS, Janowitz WR, Hildner FJ, et al. Quantification of coronary artery calcium using ultrafast computed
            tomography. J Am Coll Cardiol. 1990;15(4):827–832.
          </p>
        </div>
        <figure className="cal-artery-fig">
          <ArteryStages />
          <figcaption>A coronary artery in cross-section. Only the last stage is visible on a calcium-score scan.</figcaption>
        </figure>
      </div>
      <div className="cal-explain-recipe">
        <div className="cal-recipe-steps">
          <h3>The recipe</h3>
          <ol className="cal-steps">
            <li><b>Scan the heart, timed to the ECG.</b> <span className="muted">This scan: {m.series || `${m.thickness} mm slices every ${m.increment} mm`}.</span></li>
            <li><b>On every slice, find bright spots:</b> <span className="muted">connected pixels ≥ <b>{m.threshold} HU</b> covering ≥ <b>{m.minArea} mm²</b>{px ? <> (≈{Math.round(m.minArea / px)} pixels at this resolution)</> : null}.</span></li>
            <li><b>Keep only spots inside a coronary artery.</b> <span className="muted">Not the aorta, valves, bone or image noise. This is where judgement comes in.</span></li>
            <li><b>Score each spot:</b> <span className="muted">its area in mm² × a density weight (1 to 4) set by its brightest pixel, as in the chart.</span></li>
            <li><b>Add everything up.</b> <span className="muted">Here the {m.thickness} mm slices are taken every {m.increment} mm, so each bit of tissue shows up on two slices; the sum is multiplied by <b>{m.overlap}</b> to compensate.</span></li>
          </ol>
        </div>
        <div className="cal-recipe-viz">
          <div className="eyebrow">Step 4: density weights</div>
          <WeightStairs vm={vm} />
        </div>
        <WorkedExample vm={vm} />
      </div>
    </div>
  )
}
