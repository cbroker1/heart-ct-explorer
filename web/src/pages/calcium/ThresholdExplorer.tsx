import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { axisTicks, compact, useWidth } from './hooks'
import { cacCategory, fmtNum, fmtScore, groupName, percentileBracket } from './model'
import type { CalciumVM } from './useCalciumData'

type Row = CalciumVM['report']['thresholdSweep'][number]

function message(vm: CalciumVM, r: Row): { tone: 'warn' | 'info' | 'good'; text: string } {
  const thr = vm.method.threshold
  const cat = cacCategory(r.naiveScoreIfAllCounted)
  const row0 = vm.report.percentileContext?.rows?.[0]
  const age = vm.report.percentileContext?.age
  const pctTxt = row0 && r.naiveScoreIfAllCounted > 0
    ? ` and would rank ${percentileBracket(r.naiveScoreIfAllCounted, row0).short} percentile for ${groupName(row0.group)}${age ? ` aged ${age}` : ''}`
    : ''
  if (r.thresholdHU < thr) {
    return {
      tone: 'warn',
      text: `Below the standard ${thr} HU, ordinary blood and muscle start lighting up: ${fmtNum(r.blobs, 0)} blobs. Counted blindly, that noise alone would be a "${cat.label.toLowerCase()}" score of ${fmtScore(r.naiveScoreIfAllCounted)}${pctTxt}.`,
    }
  }
  if (r.thresholdHU === thr) {
    return {
      tone: 'info',
      text: `The Agatston standard. Still ${fmtNum(r.blobs, 0)} blobs of noise get through: counted blindly they'd add up to a fake score of ${fmtScore(r.naiveScoreIfAllCounted)}${pctTxt}. After the rules${vm.report.reviewed ? ' and AI review' : ''}, the real count is ${fmtScore(vm.report.totals.agatston)}. That gap is why scoring needs judgement, not just a threshold.`,
    }
  }
  if (r.blobs > 0) {
    return {
      tone: 'info',
      text: `Raising the bar thins the noise to ${fmtNum(r.blobs, 0)} blob${r.blobs === 1 ? '' : 's'}, but it would also start hiding faint, real calcium. The ${thr} HU rule stays fixed so scores mean the same thing on every scanner.`,
    }
  }
  return {
    tone: 'good',
    text: `Silence: no blob reaches ${r.thresholdHU} HU anywhere in the search region. Nothing in this heart is that dense. A real calcified plaque would still shine here, but early, faint ones would be missed, so the standard can't simply be raised.`,
  }
}

function MiniChart(props: {
  rows: Row[]; sel: number; W: number; x: (hu: number) => number; get: (r: Row) => number; title: string; unit: string
  color: string; showX: boolean; thr: number; refLines?: { v: number; label: string }[]
}) {
  const { rows, sel, W, x, get, color, showX, thr } = props
  const pad = { t: 10, b: showX ? 26 : 8 }
  const plotH = 118
  const H = pad.t + plotH + pad.b
  const maxV = Math.max(1, ...rows.map(get))
  const { ticks, top } = axisTicks(maxV, 3)
  const y = (v: number) => pad.t + plotH - (v / top) * plotH
  const pts = rows.map((r) => `${x(r.thresholdHU).toFixed(1)},${y(get(r)).toFixed(1)}`)
  const s = rows[sel]
  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <span className="cal-mini-title"><i style={{ background: color }} />{props.title}</span>
        <span className="cal-mini-val mono">{fmtNum(get(s), 1)} <small>{props.unit}</small></span>
      </div>
      <svg width={W} height={H} aria-hidden>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(rows[0].thresholdHU)} x2={x(rows[rows.length - 1].thresholdHU)} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={x(rows[0].thresholdHU) - 6} y={y(t) + 4} textAnchor="end" className="cal-svg-tick">{compact(t)}</text>
          </g>
        ))}
        {props.refLines?.filter((r) => r.v < top).map((r) => (
          <g key={r.v}>
            <line x1={x(rows[0].thresholdHU)} x2={x(rows[rows.length - 1].thresholdHU)} y1={y(r.v)} y2={y(r.v)} stroke="rgba(255,181,71,0.35)" />
            <text x={x(rows[rows.length - 1].thresholdHU)} y={y(r.v) - 4} textAnchor="end" className="cal-svg-sub" style={{ fill: 'rgba(255,181,71,0.85)' }}>{r.label}</text>
          </g>
        ))}
        <path d={`M${x(rows[0].thresholdHU)},${y(0)} L${pts.join(' L')} L${x(rows[rows.length - 1].thresholdHU)},${y(0)} Z`} fill={color} opacity={0.1} />
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(thr)} x2={x(thr)} y1={pad.t} y2={y(0)} stroke="rgba(255,255,255,0.35)" />
        {rows.map((r, i) => (
          <circle key={r.thresholdHU} cx={x(r.thresholdHU)} cy={y(get(r))} r={i === sel ? 6 : 3.5}
            fill={i === sel ? '#fff' : color} stroke="var(--panel-solid)" strokeWidth={2} />
        ))}
        <line x1={x(rows[0].thresholdHU)} x2={x(rows[rows.length - 1].thresholdHU)} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
        {showX && rows.map((r, i) => (
          <text key={r.thresholdHU} x={x(r.thresholdHU)} y={y(0) + 17} textAnchor="middle" className="cal-svg-tick">
            {i === sel || (W < 520 && ![90, 130, 160, 200, 250, 300].includes(r.thresholdHU)) ? '' : r.thresholdHU}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default function ThresholdExplorer({ vm }: { vm: CalciumVM }) {
  const rows = (vm.report.thresholdSweep ?? []).slice().sort((a, b) => a.thresholdHU - b.thresholdHU)
  const thr = vm.method.threshold
  const initial = Math.max(0, rows.findIndex((r) => r.thresholdHU === thr))
  const [sel, setSel] = useState(initial)
  const [table, setTable] = useState(false)
  const [ref, w] = useWidth<HTMLDivElement>(700)
  const dragging = useRef(false)
  if (rows.length < 2) return <p className="muted">No threshold sweep in this dataset.</p>

  const W = Math.max(280, w)
  const padL = 46, padR = 18
  const lo = rows[0].thresholdHU, hi = rows[rows.length - 1].thresholdHU
  const x = (hu: number) => padL + ((hu - lo) / (hi - lo)) * (W - padL - padR)
  const r = rows[sel]
  const msg = message(vm, r)

  const pick = (clientX: number, el: Element) => {
    const bx = el.getBoundingClientRect()
    const px = clientX - bx.left
    let best = 0
    rows.forEach((row, i) => { if (Math.abs(x(row.thresholdHU) - px) < Math.abs(x(rows[best].thresholdHU) - px)) best = i })
    setSel(best)
  }
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pick(e.clientX, e.currentTarget)
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => { if (dragging.current) pick(e.clientX, e.currentTarget) }
  const onUp = () => { dragging.current = false }
  const snapTo = (hu: number) => {
    let best = 0
    rows.forEach((row, i) => { if (Math.abs(row.thresholdHU - hu) < Math.abs(rows[best].thresholdHU - hu)) best = i })
    setSel(best)
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const k = e.key
    let n = sel
    if (k === 'ArrowRight' || k === 'ArrowUp') n = Math.min(rows.length - 1, sel + 1)
    else if (k === 'ArrowLeft' || k === 'ArrowDown') n = Math.max(0, sel - 1)
    else if (k === 'Home') n = 0
    else if (k === 'End') n = rows.length - 1
    else return
    e.preventDefault()
    setSel(n)
  }
  const presets = rows.filter((row) => [90, 110, thr, 150, 200].includes(row.thresholdHU))

  return (
    <div className="cal-thr" ref={ref}>
      <div className="cal-thr-controls">
        <div className="cal-thr-readout">
          <div className="cal-thr-big mono">{r.thresholdHU}<small> HU</small></div>
          <div className="muted" style={{ fontSize: 12 }}>threshold{r.thresholdHU === thr ? ' (Agatston standard)' : ''}</div>
        </div>
        <div className="seg" role="group" aria-label="Threshold presets">
          {presets.map((p) => {
            const i = rows.indexOf(p)
            return (
              <button key={p.thresholdHU} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
                {p.thresholdHU}{p.thresholdHU === thr ? ' ★' : ''}
              </button>
            )
          })}
        </div>
        <button className="btn ghost small" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? 'Show chart' : 'Show as table'}</button>
      </div>

      {table ? (
        <div className="cal-table-wrap">
          <table className="data">
            <thead><tr><th className="num">Threshold</th><th className="num">Blobs ≥1 mm²</th><th className="num">Naive score (all counted)</th><th>Category if real</th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.thresholdHU} className={i === sel ? 'cal-row-sel' : ''} onClick={() => setSel(i)}>
                  <td className="num">{row.thresholdHU} HU{row.thresholdHU === thr ? ' ★' : ''}</td>
                  <td className="num">{fmtNum(row.blobs, 0)}</td>
                  <td className="num">{fmtScore(row.naiveScoreIfAllCounted)}</td>
                  <td>{cacCategory(row.naiveScoreIfAllCounted).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cal-thr-charts">
          <div
            className="cal-thr-hit"
            aria-hidden
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div className="cal-thr-cursor" style={{ left: x(r.thresholdHU) }}><span>{r.thresholdHU}</span></div>
            <MiniChart rows={rows} sel={sel} W={W} x={x} get={(q) => q.blobs} title="Blobs found (≥1 mm² each)" unit="blobs" color="var(--cyan)" showX={false} thr={thr} />
            <MiniChart rows={rows} sel={sel} W={W} x={x} get={(q) => q.naiveScoreIfAllCounted} title="Naive score if every blob counted" unit="Agatston" color="var(--violet)" showX thr={thr}
              refLines={[{ v: 100, label: '100: moderate' }, { v: 300, label: '300: severe' }]} />
          </div>
          <input
            type="range"
            className="cal-thr-range"
            min={lo}
            max={hi}
            step={1}
            value={r.thresholdHU}
            aria-label="Detection threshold in HU"
            aria-valuetext={`${r.thresholdHU} HU: ${r.blobs} blobs, naive score ${r.naiveScoreIfAllCounted}`}
            style={{ ['--pct' as string]: `${((r.thresholdHU - lo) / (hi - lo)) * 100}%`, marginLeft: padL - 8, width: W - padL - padR + 16 }}
            onChange={(e) => snapTo(Number(e.target.value))}
            onKeyDown={onKey}
          />
          <div className="cal-thr-axis muted">threshold (HU): drag the slider or the chart, or use the ← → keys</div>
        </div>
      )}
      <div className={`cal-thr-msg ${msg.tone}`} aria-live="polite">{msg.text}</div>
    </div>
  )
}
