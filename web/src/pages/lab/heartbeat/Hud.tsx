/**
 * Live read-outs next to the 3D heart. React re-renders once per beat (HR, beat number, the X-ray
 * window on the ring); everything continuous (ring progress, phase %, stage, motion) is written
 * straight to the DOM from the frame loop.
 */
import { useEffect, useRef } from 'react'
import { STAGE_LABEL, type Cardio } from './ecg'
import type { FrameFn, Player } from './player'

const R = 46
const C = 2 * Math.PI * R

export function Hud(props: { player: Player; model: Cardio; bus: Set<FrameFn>; beat: number }) {
  const { player, model, bus, beat } = props
  const arc = useRef<SVGCircleElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  const pctT = useRef<SVGTextElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const motion = useRef<HTMLDivElement>(null)
  const still = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let lastStage = ''
    const f: FrameFn = (t) => {
      const s = model.state(t)
      const ph = model.scannerPhase(t)
      if (arc.current) arc.current.style.strokeDashoffset = String(C * (1 - ph))
      if (dot.current) {
        const a = -Math.PI / 2 + ph * Math.PI * 2
        dot.current.setAttribute('cx', (60 + R * Math.cos(a)).toFixed(2))
        dot.current.setAttribute('cy', (60 + R * Math.sin(a)).toFixed(2))
      }
      if (pctT.current) pctT.current.textContent = `${Math.round(ph * 100)}%`
      const lbl = STAGE_LABEL[s.stage]
      if (stage.current && lbl !== lastStage) { stage.current.textContent = lbl; lastStage = lbl }
      if (time.current) time.current.textContent = `${t.toFixed(1)} / ${model.duration.toFixed(1)} s`
      const m = model.motion(t)
      if (motion.current) motion.current.style.transform = `scaleX(${Math.max(0.02, m).toFixed(3)})`
      if (still.current) still.current.style.opacity = m < 0.12 ? '1' : '0.25'
    }
    bus.add(f)
    f(player.t)
    return () => { bus.delete(f) }
  }, [player, model, bus])

  const hr = model.hrAfterBeat(beat)
  // the R-R that just ended (the same interval the printed HR belongs to)
  const iv = beat >= 1 ? model.data.intervals[beat - 1] : undefined
  // the X-ray window for this beat: the real one if this beat was imaged, else the 75% target
  const shot = model.x.find((e) => e.interval === beat)
  const w0 = shot ? shot.phase.xrayStart : 0.63
  const w1 = shot ? shot.phase.xrayEnd : 0.87
  return (
    <div className="hb-hud" aria-live="off">
      <div className="hb-card hb-hr">
        <div className="eyebrow">Heart rate</div>
        <div className="hb-hr-v">
          <span key={beat} className="hb-hr-num">{hr ?? '—'}</span>
          <small>bpm</small>
        </div>
        <div className="hb-sub">
          beat <b className="mono">{beat < 0 ? '—' : beat + 1}</b> of {model.R.length}
          {iv ? <> · R-R <b className="mono">{iv.rr.toFixed(2)} s</b></> : null}
        </div>
        <div className="hb-sub mono faint"><span ref={time} /></div>
      </div>
      <div className="hb-card hb-phase">
        <div className="eyebrow">Where in the beat</div>
        <div className="hb-phase-row">
          <svg viewBox="0 0 120 120" className="hb-ring" aria-hidden>
            <circle cx="60" cy="60" r={R} className="hb-ring-track" />
            <circle
              cx="60" cy="60" r={R}
              className={shot ? 'hb-ring-xray live' : 'hb-ring-xray'}
              strokeDasharray={`${(w1 - w0) * C} ${C}`}
              strokeDashoffset={-w0 * C}
              transform="rotate(-90 60 60)"
            />
            <circle ref={arc} cx="60" cy="60" r={R} className="hb-ring-arc" strokeDasharray={`${C} ${C}`} transform="rotate(-90 60 60)" />
            <circle ref={dot} cx="60" cy={60 - R} r="5" className="hb-ring-dot" />
            <text ref={pctT} x="60" y="64" textAnchor="middle" className="hb-ring-pct">0%</text>
          </svg>
          <div className="hb-phase-side">
            <div ref={stage} className="hb-stage-lbl">…</div>
            <div className="hb-motion" title="How fast the model heart is moving right now (illustrative)">
              <div className="hb-motion-track"><div ref={motion} className="hb-motion-fill" /></div>
              <div className="hb-motion-lbl"><span>motion (model)</span><span ref={still} className="hb-still">still</span></div>
            </div>
          </div>
        </div>
        <div className="hb-sub">
          <i className="hb-key xray" /> {shot ? `X-ray window of shot ${shot.n}` : 'X-ray window (target 75%)'}
        </div>
      </div>
    </div>
  )
}
