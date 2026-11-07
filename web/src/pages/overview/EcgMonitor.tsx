/**
 * A bedside-monitor style sweep, drawn on a small 2D canvas. The waveform is illustrative (a textbook
 * PQRST shape) but its rate is the real average heart rate during the scan, and it shares the beat
 * clock with the 3D heart so the R wave lines up with each contraction.
 */
import { useEffect, useRef } from 'react'
import { aroundR, beatClock, ecgShape } from './beat'

const WINDOW_S = 3.0 // seconds of trace across the canvas
const GAP_PX = 16

export function EcgMonitor(props: { bpm: number | null; running: boolean; reducedMotion: boolean }) {
  const { bpm, running, reducedMotion } = props
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !bpm) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const rr = 60 / bpm
    let raf = 0
    const animate = running && !reducedMotion

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (w < 4 || h < 4) { if (animate) raf = requestAnimationFrame(draw); return }
      const W = Math.round(w * dpr), H = Math.round(h * dpr)
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Static mode (reduced motion): R wave placed at 40% of the width.
      const now = animate ? beatClock() : rr * 0.4 + WINDOW_S
      const headX = animate ? ((now % WINDOW_S) / WINDOW_S) * w : w
      const baseY = h * 0.66
      const amp = h * 0.56
      const yAt = (x: number) => {
        const back = x <= headX ? headX - x : headX - x + w
        const t = now - (back / w) * WINDOW_S
        return baseY - ecgShape(aroundR(t, rr)) * amp
      }

      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      const segment = (x0: number, x1: number, a0: number, a1: number) => {
        if (x1 - x0 < 1) return
        ctx.beginPath()
        for (let x = x0; x <= x1; x += 1) {
          const y = yAt(x)
          if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        const g = ctx.createLinearGradient(x0, 0, x1, 0)
        g.addColorStop(0, `rgba(255, 93, 108, ${a0})`)
        g.addColorStop(1, `rgba(255, 93, 108, ${a1})`)
        ctx.strokeStyle = g
        ctx.shadowColor = 'rgba(255, 77, 94, 0.85)'
        ctx.shadowBlur = 7
        ctx.lineWidth = 1.7
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      // brightness fades with age: newest at the sweep head
      const alpha = (age01: number) => Math.max(0.12, 1 - 0.85 * age01)
      segment(0, Math.floor(headX), alpha(headX / w), 1)
      if (animate) segment(Math.ceil(headX + GAP_PX), w, alpha(1 - GAP_PX / w), alpha(headX / w))

      if (animate) {
        const hy = yAt(Math.max(0, headX - 0.5))
        const rg = ctx.createRadialGradient(headX, hy, 0, headX, hy, 9)
        rg.addColorStop(0, 'rgba(255, 220, 224, 1)')
        rg.addColorStop(0.35, 'rgba(255, 93, 108, 0.8)')
        rg.addColorStop(1, 'rgba(255, 77, 94, 0)')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(headX, hy, 9, 0, Math.PI * 2)
        ctx.fill()
        raf = requestAnimationFrame(draw)
      }
    }
    draw()
    const ro = !animate && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null
    ro?.observe(cv)
    return () => { cancelAnimationFrame(raf); ro?.disconnect() }
  }, [bpm, running, reducedMotion])

  return <canvas ref={ref} className="ovw-ecg-canvas" aria-hidden="true" />
}
