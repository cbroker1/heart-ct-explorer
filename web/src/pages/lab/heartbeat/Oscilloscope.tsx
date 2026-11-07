/**
 * Scrolling ECG "oscilloscope": the real digitized trace, glowing phosphor green, ECG-paper grid,
 * the scanner's R markers and printed heart rates, and the X-ray windows as green bands
 * (the same marks the scanner drew). Past is bright, the next ~second is a dim preview.
 */
import { useEffect, useRef } from 'react'
import { clamp, type Cardio } from './ecg'
import type { FrameFn, Player } from './player'

const BG = '#020705'
const GREEN = '125,255,181'

export function Oscilloscope(props: { player: Player; model: Cardio; bus: Set<FrameFn> }) {
  const { player, model, bus } = props
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let W = 0, H = 0, dpr = 1
    const data = model.data
    const R = model.R
    const iv = data.intervals
    const X = model.x

    const draw = (t: number) => {
      if (!W || !H) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)
      const pps = clamp(W / 4.2, 92, 290)               // pixels per second
      const px = Math.round(W * (W < 520 ? 0.72 : 0.76)) // playhead x
      const o0 = -px / pps, o1 = (W - px) / pps
      const base = H * 0.66, amp = H * 0.5
      const yOf = (v: number) => base - v * amp
      const xOf = (o: number) => px + o * pps

      // ECG paper grid anchored to the (never wrapping) virtual time
      const vt = player.vt
      ctx.lineWidth = 1
      for (const [step, a] of [[0.04, 0.045], [0.2, 0.11]] as const) {
        ctx.strokeStyle = `rgba(62,224,143,${a})`
        ctx.beginPath()
        const first = Math.ceil((vt + o0) / step) * step
        for (let s = first; s <= vt + o1; s += step) {
          const x = Math.round(xOf(s - vt)) + 0.5
          ctx.moveTo(x, 0); ctx.lineTo(x, H)
        }
        const ystep = step === 0.04 ? 0.1 : 0.5
        for (let v = -0.6; v <= 1.6; v += ystep) {
          const y = Math.round(yOf(v)) + 0.5
          if (y < 0 || y > H) continue
          ctx.moveTo(0, y); ctx.lineTo(W, y)
        }
        ctx.stroke()
      }

      const pieces = player.pieces(o0, o1)
      // ---- X-ray windows (behind the trace)
      for (const pc of pieces) {
        const r1 = pc.r0 + (pc.o1 - pc.o0)
        for (const e of X) {
          if (e.xray[1] < pc.r0 || e.xray[0] > r1) continue
          const xa = xOf(pc.o0 + (e.xray[0] - pc.r0)), xb = xOf(pc.o0 + (e.xray[1] - pc.r0))
          const ra = xOf(pc.o0 + (e.recon[0] - pc.r0)), rb = xOf(pc.o0 + (e.recon[1] - pc.r0))
          const live = t >= e.xray[0] && t <= e.xray[1] + 0.05
          const future = xa > px
          const g = ctx.createLinearGradient(0, 0, 0, H)
          const k = live ? 1 : future ? 0.45 : 0.75
          g.addColorStop(0, `rgba(62,224,143,${0.04 * k})`)
          g.addColorStop(1, `rgba(62,224,143,${0.34 * k})`)
          ctx.fillStyle = g
          ctx.fillRect(xa, 14, xb - xa, H - 14)
          ctx.strokeStyle = `rgba(220,255,235,${0.55 * k})`
          ctx.strokeRect(Math.round(ra) + 0.5, 16.5, Math.max(1, rb - ra - 1), H - 18)
          if (live) {
            ctx.save()
            ctx.shadowColor = 'rgba(93,255,176,0.9)'
            ctx.shadowBlur = 18
            ctx.fillStyle = 'rgba(93,255,176,0.18)'
            ctx.fillRect(xa, 14, xb - xa, H - 14)
            ctx.restore()
          }
          ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace'
          ctx.fillStyle = `rgba(139,255,190,${0.9 * k})`
          ctx.textAlign = 'center'
          ctx.fillText(`X-RAY ${e.n}/${X.length}`, (xa + xb) / 2, H - 6)
        }
      }

      // ---- R markers + printed heart rates (like the scanner's printout)
      ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
      ctx.textAlign = 'center'
      for (const pc of pieces) {
        const r1 = pc.r0 + (pc.o1 - pc.o0)
        for (let i = 0; i < R.length; i++) {
          const m = data.beats[i].marker
          if (m < pc.r0 || m > r1) continue
          const x = xOf(pc.o0 + (m - pc.r0))
          ctx.fillStyle = x > px ? 'rgba(231,237,245,0.3)' : 'rgba(231,237,245,0.85)'
          ctx.fillRect(Math.round(x) - 1, 7, 2, 2)
        }
        for (const it of iv) {
          const mid = 0.5 * (it.markerStart + it.markerEnd)
          if (mid < pc.r0 || mid > r1) continue
          const x = xOf(pc.o0 + (mid - pc.r0))
          ctx.fillStyle = x > px ? 'rgba(231,237,245,0.25)' : 'rgba(231,237,245,0.62)'
          ctx.fillText(String(it.hrPrinted), x, 12)
        }
      }

      // ---- the trace: past (bright, fading with age) and the upcoming preview (dim)
      const fs = model.fs
      const sig = model.sig
      const pastPath = new Path2D()
      const futPath = new Path2D()
      for (const pc of pieces) {
        const i0 = Math.max(0, Math.ceil(pc.r0 * fs))
        const i1 = Math.min(sig.length - 1, Math.floor((pc.r0 + (pc.o1 - pc.o0)) * fs))
        let startedP = false, startedF = false
        for (let i = i0; i <= i1; i++) {
          const o = pc.o0 + (i / fs - pc.r0)
          const x = xOf(o), y = yOf(sig[i])
          if (o <= 0) {
            if (!startedP) { pastPath.moveTo(x, y); startedP = true } else pastPath.lineTo(x, y)
          }
          if (o >= -1 / fs) {
            if (!startedF) { futPath.moveTo(x, y); startedF = true } else futPath.lineTo(x, y)
          }
        }
        // join the past path exactly at the playhead
        if (startedP && pc.o0 <= 0 && pc.o1 >= 0) {
          const v = model.sample(pc.r0 - pc.o0)
          if (Number.isFinite(v)) pastPath.lineTo(px, yOf(v))
        }
      }
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = `rgba(${GREEN},0.16)`
      ctx.lineWidth = 1.2
      ctx.stroke(futPath)
      const fade = ctx.createLinearGradient(0, 0, px, 0)
      fade.addColorStop(0, `rgba(${GREEN},0.0)`)
      fade.addColorStop(0.25, `rgba(${GREEN},0.35)`)
      fade.addColorStop(1, `rgba(${GREEN},1)`)
      const glow = ctx.createLinearGradient(0, 0, px, 0)
      glow.addColorStop(0, `rgba(${GREEN},0)`)
      glow.addColorStop(1, `rgba(${GREEN},0.16)`)
      ctx.strokeStyle = glow
      ctx.lineWidth = 7
      ctx.stroke(pastPath)
      ctx.lineWidth = 3.4
      ctx.stroke(pastPath)
      ctx.strokeStyle = fade
      ctx.lineWidth = 1.7
      ctx.stroke(pastPath)

      // ---- time ticks
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'
      ctx.textAlign = 'left'
      for (const pc of pieces) {
        const r1 = pc.r0 + (pc.o1 - pc.o0)
        for (let s = Math.ceil(pc.r0); s <= r1; s++) {
          const x = xOf(pc.o0 + (s - pc.r0))
          ctx.fillStyle = 'rgba(139,151,168,0.55)'
          ctx.fillRect(Math.round(x), H - 4, 1, 4)
          if (x < px - 8 || x > px + 40) ctx.fillText(`${s} s`, x + 3, H - 18)
        }
      }

      // ---- playhead beam
      const vNow = model.sample(t)
      const lg = ctx.createLinearGradient(0, 0, 0, H)
      lg.addColorStop(0, `rgba(${GREEN},0)`)
      lg.addColorStop(0.5, `rgba(${GREEN},0.45)`)
      lg.addColorStop(1, `rgba(${GREEN},0)`)
      ctx.fillStyle = lg
      ctx.fillRect(px - 0.5, 0, 1, H)
      if (Number.isFinite(vNow)) {
        const y = yOf(vNow)
        const rg = ctx.createRadialGradient(px, y, 0, px, y, 16)
        rg.addColorStop(0, 'rgba(220,255,236,0.95)')
        rg.addColorStop(0.25, `rgba(${GREEN},0.55)`)
        rg.addColorStop(1, `rgba(${GREEN},0)`)
        ctx.fillStyle = rg
        ctx.beginPath(); ctx.arc(px, y, 16, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#eafff3'
        ctx.beginPath(); ctx.arc(px, y, 2.4, 0, Math.PI * 2); ctx.fill()
      }
      // phosphor fade at the left edge
      const edge = ctx.createLinearGradient(0, 0, 70, 0)
      edge.addColorStop(0, 'rgba(2,7,5,1)')
      edge.addColorStop(1, 'rgba(2,7,5,0)')
      ctx.fillStyle = edge
      ctx.fillRect(0, 0, 70, H)
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = cv.clientWidth
      H = cv.clientHeight
      cv.width = Math.max(1, Math.round(W * dpr))
      cv.height = Math.max(1, Math.round(H * dpr))
      draw(player.t)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()
    bus.add(draw)
    return () => { ro.disconnect(); bus.delete(draw) }
  }, [player, model, bus])

  return <canvas ref={ref} className="hb-scope" role="img" aria-label="Scrolling ECG trace with the X-ray windows marked in green" />
}
