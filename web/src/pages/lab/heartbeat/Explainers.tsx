/** The cards under the player: one-beat diagram, HR chart, the four shots, rhythm check, proof. */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { dataUrl } from '../../../lib/data'
import type { Cardio, EcgData } from './ecg'
import { Toggle } from '../../../components/ui'

const XRAY_GREEN = '#2aa96b'
const REST_GREY = '#6b7686'

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ------------------------------------------------------------------------------ one real beat
export function BeatDiagram({ model }: { model: Cardio }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const d = model.data
  const ex = d.exposures[2] ?? d.exposures[0]
  const W = Math.max(300, w), H = W < 520 ? 230 : 250
  const view = useMemo(() => {
    if (!ex) return null
    const k = ex.interval
    const b0 = d.beats[k], b1 = d.beats[k + 1]
    const t0 = b0.r - 0.2, t1 = b1.r + 0.16
    const padL = 12, padR = 12
    const xOf = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR)
    const base = H * 0.56, amp = H * 0.4
    const yOf = (v: number) => base - v * amp
    let path = ''
    for (let t = t0; t <= t1; t += 1 / d.fs) path += `${path ? 'L' : 'M'}${xOf(t).toFixed(1)},${yOf(model.sample(t)).toFixed(1)}`
    // modelled ventricle size (1 = full)
    const sy0 = H - 34, sy1 = H - 12
    let size = ''
    for (let t = t0; t <= t1; t += 0.004) {
      const v = model.state(t).v
      size += `${size ? 'L' : 'M'}${xOf(t).toFixed(1)},${(sy0 + v * (sy1 - sy0)).toFixed(1)}`
    }
    return { b0, b1, xOf, yOf, path, size, sy0, sy1, rr: b1.marker - b0.marker }
  }, [ex, d, model, W, H])
  if (!ex || !view) return null
  const { b0, b1, xOf, yOf, path, size, sy0, rr } = view
  const xa = xOf(ex.xray[0]), xb = xOf(ex.xray[1])
  const ra = xOf(ex.recon[0]), rb = xOf(ex.recon[1])
  const yTop = 18
  const phaseX = (p: number) => xOf(b0.marker + p * rr)
  const tPeak = b0.t != null ? { x: xOf(b0.t), y: yOf(b0.tAmp ?? 0) } : null
  const pPeak = b1.p != null ? { x: xOf(b1.p), y: yOf(b1.pAmp ?? 0) } : null
  return (
    <div ref={ref} className="hb-diagram">
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={`One real heartbeat from the recording: R-R ${rr.toFixed(2)} seconds; the X-ray was on from ${Math.round(ex.phase.xrayStart * 100)}% to ${Math.round(ex.phase.xrayEnd * 100)}% of it.`}>
          <rect x={xa} y={yTop + 10} width={xb - xa} height={sy0 - yTop - 16} fill="rgba(62,224,143,0.16)" />
          <rect x={ra + 0.5} y={yTop + 12.5} width={Math.max(1, rb - ra - 1)} height={sy0 - yTop - 21} fill="none" stroke="rgba(220,255,235,0.55)" />
          {/* R-R bracket with phase ticks */}
          <line x1={phaseX(0)} x2={phaseX(1)} y1={yTop} y2={yTop} stroke="rgba(231,237,245,0.35)" />
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={phaseX(p)} x2={phaseX(p)} y1={yTop - 4} y2={yTop + 4} stroke={p === 0.75 ? '#8bffbe' : 'rgba(231,237,245,0.4)'} />
              <text x={phaseX(p)} y={yTop - 7} textAnchor="middle" className={p === 0.75 ? 'hb-dg-strong' : 'hb-dg-faint'}>{Math.round(p * 100)}%</text>
            </g>
          ))}
          <line x1={0} x2={W} y1={yOf(0)} y2={yOf(0)} stroke="rgba(255,255,255,0.06)" />
          <path d={path} fill="none" stroke="#7dffb5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* labels */}
          <text x={xOf(b0.r) + 7} y={yOf(b0.amp) + 6} className="hb-dg-lbl">R</text>
          <text x={xOf(b1.r) + 7} y={yOf(b1.amp) + 6} className="hb-dg-lbl">R</text>
          {tPeak && <text x={tPeak.x} y={tPeak.y - 9} textAnchor="middle" className="hb-dg-lbl">T</text>}
          {pPeak && <text x={pPeak.x} y={pPeak.y - 9} textAnchor="middle" className="hb-dg-lbl">P</text>}
          <text x={(xa + xb) / 2} y={yOf(0.62)} textAnchor="middle" className="hb-dg-strong">X-ray</text>
          <text x={(xa + xb) / 2} y={yOf(0.62) + 14} textAnchor="middle" className="hb-dg-faint">{ex.durationMs} ms</text>
          {/* modelled ventricle size */}
          <path d={size} fill="none" stroke="#ffb547" strokeWidth={2} strokeLinejoin="round" />
          <text x={xOf(b0.r + 0.03)} y={sy0 - 6} className="hb-dg-faint">ventricle size (model): squeeze</text>
          <text x={(xa + xb) / 2} y={sy0 + 30} textAnchor="middle" className="hb-dg-faint">quiet</text>
        </svg>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------ HR over time
export function HrChart({ data, beat }: { data: EcgData; beat: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const iv = data.intervals
  const shotOf = useMemo(() => new Map(data.exposures.map((e) => [e.interval, e.n])), [data])
  const W = Math.max(300, w), H = 230
  const m = { l: 40, r: 14, t: 26, b: 28 }
  const lo = 60, hi = 90
  const D = data.duration
  const xOf = (t: number) => m.l + (t / D) * (W - m.l - m.r)
  const yOf = (hr: number) => m.t + (1 - (hr - lo) / (hi - lo)) * (H - m.t - m.b)
  const pts = iv.map((it, i) => ({ i, x: xOf(0.5 * (it.start + it.end)), y: yOf(it.hrPrinted), it }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const iMin = pts.reduce((a, p) => (p.it.hrPrinted < a.it.hrPrinted ? p : a), pts[0])
  const iMax = pts.reduce((a, p) => (p.it.hrPrinted > a.it.hrPrinted ? p : a), pts[0])
  const scan = data.exposures.length ? [xOf(data.exposures[0].xray[0]) - 6, xOf(data.exposures[data.exposures.length - 1].xray[1]) + 6] : null
  const cur = beat >= 1 ? beat - 1 : -1
  const hp = hover != null ? pts[hover] : null
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const x = e.clientX - r.left + m.l
    let best = 0, bd = Infinity
    for (const p of pts) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p.i } }
    setHover(best)
  }
  return (
    <div ref={ref} className="hb-chart">
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Heart rate per beat, ${data.rhythm.hrPrintedRange[0]} to ${data.rhythm.hrPrintedRange[1]} beats per minute, rising over the 27 second recording. The four X-ray beats are marked.`}>
          {scan && <rect x={scan[0]} y={m.t - 8} width={scan[1] - scan[0]} height={H - m.t - m.b + 8} fill="rgba(62,224,143,0.07)" />}
          {scan && <text x={(scan[0] + scan[1]) / 2} y={m.t - 12} textAnchor="middle" className="hb-ax">scan</text>}
          {[60, 70, 80, 90].map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={yOf(v)} y2={yOf(v)} stroke="rgba(255,255,255,0.07)" />
              <text x={m.l - 8} y={yOf(v) + 4} textAnchor="end" className="hb-ax">{v}</text>
            </g>
          ))}
          <text x={4} y={m.t - 12} className="hb-ax">bpm</text>
          {[0, 5, 10, 15, 20, 25].map((s) => (
            <text key={s} x={xOf(s)} y={H - 8} textAnchor="middle" className="hb-ax">{s} s</text>
          ))}
          <path d={line} fill="none" stroke={REST_GREY} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => {
            const shot = shotOf.get(p.i)
            return (
              <g key={p.i}>
                <circle cx={p.x} cy={p.y} r={shot ? 5 : 4} fill={shot ? XRAY_GREEN : REST_GREY} stroke="#111722" strokeWidth={2} />
                {shot && <text x={p.x} y={shot % 2 ? p.y + 19 : p.y - 11} textAnchor="middle" className="hb-ax-strong">X{shot}</text>}
              </g>
            )
          })}
          {cur >= 0 && pts[cur] && <circle cx={pts[cur].x} cy={pts[cur].y} r={8} fill="none" stroke="#e7edf5" strokeWidth={1.5} />}
          <text x={iMin.x} y={iMin.y + 20} textAnchor="middle" className="hb-ax-strong">{iMin.it.hrPrinted}</text>
          <text x={iMax.x} y={iMax.y - 11} textAnchor="middle" className="hb-ax-strong">{iMax.it.hrPrinted}</text>
          {hp && (
            <g pointerEvents="none">
              <line x1={hp.x} x2={hp.x} y1={m.t - 4} y2={H - m.b} stroke="rgba(231,237,245,0.35)" />
              <circle cx={hp.x} cy={hp.y} r={6} fill="none" stroke="#e7edf5" strokeWidth={1.5} />
            </g>
          )}
          <rect x={m.l} y={0} width={W - m.l - m.r} height={H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hp && (
        <div
          className="tooltip hb-tip"
          style={{
            left: hp.x + 14 + 200 < W ? hp.x + 14 : Math.max(0, hp.x - 14 - 200),
            top: hp.y < H / 2 ? H - m.b - 86 : m.t,
          }}
        >
          <div><b className="mono">{hp.it.hrPrinted} bpm</b> <span className="muted">printed by the scanner</span></div>
          <div className="muted mono">beat {hp.i + 1}→{hp.i + 2} · R-R {hp.it.rr.toFixed(2)} s</div>
          <div className="muted mono">at {hp.it.start.toFixed(1)} s</div>
          {shotOf.get(hp.i) && <div style={{ color: '#8bffbe' }}>X-ray shot {shotOf.get(hp.i)} in this beat</div>}
        </div>
      )}
      <div className="hb-legend">
        <span><i style={{ background: REST_GREY }} /> heart rate of each beat (scanner's numbers)</span>
        <span><i style={{ background: XRAY_GREEN }} /> beats with an X-ray shot (X1-X4)</span>
      </div>
      <details className="hb-details">
        <summary>All {iv.length} beats as a table</summary>
        <div className="hb-table-wrap">
          <table className="data">
            <thead><tr><th>Beat</th><th>Starts</th><th>R-R</th><th>Printed HR</th><th>From spacing</th><th>Shot</th></tr></thead>
            <tbody>
              {iv.map((it, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}→{i + 2}</td>
                  <td className="num">{it.start.toFixed(2)} s</td>
                  <td className="num">{it.rr.toFixed(3)} s</td>
                  <td className="num">{it.hrPrinted} bpm</td>
                  <td className="num">{it.hrMeasured.toFixed(1)} bpm</td>
                  <td>{shotOf.get(i) ? `X${shotOf.get(i)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

// ------------------------------------------------------------------------------ the four shots
export function ShotsTable({ data, coverage, onJump }: { data: EcgData; coverage: string[][] | null; onJump: (i: number) => void }) {
  return (
    <div className="hb-table-wrap">
      <table className="data hb-shots">
        <thead>
          <tr>
            <th>Shot</th>
            <th title="Seconds from the start of the recording">At</th>
            <th title="Heart rate of that beat, as printed by the scanner">Heart rate</th>
            <th title="Where in the beat the X-ray window was centred (0% = R wave, 100% = next R wave)">Beam centred at</th>
            <th title="Length of the dark-green X-ray band">Beam on</th>
            <th title="Table position converted to height in the body (DICOM z)">Slab (height)</th>
            <th>Inside the slab</th>
          </tr>
        </thead>
        <tbody>
          {data.exposures.map((e, i) => (
            <tr key={e.n}>
              <td><button className="btn small cyan" onClick={() => onJump(i)} title="Replay this shot">▶ X{e.n}</button></td>
              <td className="num">{e.xray[0].toFixed(2)} s</td>
              <td className="num">{e.hrPrinted} bpm</td>
              <td className="num">{Math.round(e.phase.xrayCenter * 100)}% <span className="muted">(images {Math.round(e.phase.reconCenter * 100)}%)</span></td>
              <td className="num">{e.durationMs} ms</td>
              <td className="num">{e.zRangeLPS ? `${e.zRangeLPS[0].toFixed(0)}–${e.zRangeLPS[1].toFixed(0)} mm` : '—'}</td>
              <td className="muted">{coverage?.[i]?.length ? coverage[i].join(', ') : '…'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------------------ rhythm check
export function RhythmCard({ data }: { data: EcgData }) {
  const r = data.rhythm
  const items: { ok: boolean; title: string; body: string }[] = [
    {
      ok: r.pWaveBeforeEveryQRS && r.prematureBeats === 0,
      title: 'Regular rhythm, a P wave before every beat',
      body: `All ${r.beats} beats look alike and each QRS is preceded by a P wave: consistent with normal sinus rhythm (the heart's own pacemaker in charge).`,
    },
    {
      ok: r.prematureBeats === 0,
      title: 'No extra or skipped beats',
      body: `Over ${data.duration.toFixed(1)} s the beat-to-beat interval never jumps by more than ${r.maxBeatToBeatChangeMs} ms; it drifts smoothly.`,
    },
    {
      ok: r.qrsWidthMsMedian < 110,
      title: `Narrow QRS: about ${r.qrsWidthMsMedian} ms`,
      body: `Measured ${r.qrsWidthMsRange[0]}–${r.qrsWidthMsRange[1]} ms at 10 ms per pixel. Under ~110–120 ms means the electrical signal spreads through the ventricles along the normal fast wiring.`,
    },
    {
      ok: true,
      title: `Rate ${r.hrPrintedRange[0]}–${r.hrPrintedRange[1]} bpm, rising during the recording`,
      body: `About ${Math.round(r.hrFirst8Avg)} bpm at the start, ${Math.round(r.hrLast8Avg)} bpm by the X-rays. A rise like this around the breath-hold is common; the scanner simply adapts its timing.`,
    },
  ]
  return (
    <div className="hb-rhythm">
      {items.map((it) => (
        <div key={it.title} className="hb-rhythm-item">
          <span className={`chip ${it.ok ? 'good' : 'warn'}`}>{it.ok ? '✓ normal' : 'note'}</span>
          <div>
            <div className="hb-rhythm-title">{it.title}</div>
            <div className="muted">{it.body}</div>
          </div>
        </div>
      ))}
      <p className="disclaimer" style={{ marginTop: 6 }}>
        Not a medical device. This is a single-channel monitoring strip from the scanner (no amplitude calibration,
        unknown filters), not a diagnostic 12-lead ECG, so it can't judge things like ST segments. The official report is what counts.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------------------ proof: the printout
export function StripProof({ data }: { data: EcgData }) {
  const [overlay, setOverlay] = useState(true)
  return (
    <div>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
          The scanner's own printout: 3 images, 7 rows of 4 s each. The cyan line is my digitized trace drawn
          back on top; R markers and heart-rate numbers are the scanner's.
        </p>
        <Toggle label="Show digitized trace" checked={overlay} onChange={setOverlay} />
      </div>
      <div className="hb-strips">
        {data.rows.map((r) => (
          <figure key={r.strip} className="hb-strip">
            <div className="hb-strip-img">
              <img src={dataUrl(r.png)} alt={`ECG printout row ${r.strip} (${r.t0.toFixed(0)}–${r.t1.toFixed(0)} s)`} width={400} height={112} loading="lazy" />
              {overlay && (
                <svg viewBox="0 0 400 112" preserveAspectRatio="none" aria-hidden>
                  <polyline
                    points={r.yPx.map((y, x) => `${x + 0.5},${y + 0.5}`).join(' ')}
                    fill="none"
                    stroke="#38d6ff"
                    strokeWidth={1.1}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <figcaption className="mono">row {r.strip} · image {r.image.replace('I', '')} · {r.t0.toFixed(0)}–{Number((r.t1 + 0.01).toFixed(2))} s</figcaption>
          </figure>
        ))}
      </div>
      <ul className="hb-method muted">
        <li>
          Time scale: every printed heart rate (R-R = 60 / HR) against the spacing of the scanner's R markers gives{' '}
          <b className="mono">{data.calibration.pxPerSecondFit.toFixed(2)} px/s</b> (RMS error {data.calibration.fitResidualMsRms} ms),
          so the printout runs at exactly 100 px per second, 10 ms per pixel.
        </li>
        <li>The rows join seamlessly: the "73" label is split across images 1 and 2, and R-R intervals that span a row break match their printed rate.</li>
        <li>Amplitude has no mV calibration on the printout, so the trace is normalized to the median R-wave height.</li>
        <li>The images contain no name, ID or date. Only the pixels are used.</li>
      </ul>
    </div>
  )
}
