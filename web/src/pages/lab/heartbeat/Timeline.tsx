/**
 * The whole 26.8 s recording as a mini-map: trace, beats, the four X-ray shots and the scan span.
 * Click or drag to seek.
 */
import { useEffect, useRef } from 'react'
import { clamp, type Cardio } from './ecg'
import type { FrameFn, Player } from './player'

export function Timeline(props: { player: Player; model: Cardio; bus: Set<FrameFn>; onSeek: (t: number) => void }) {
  const { player, model, bus, onSeek } = props
  const ref = useRef<HTMLCanvasElement>(null)
  const seekRef = useRef(onSeek)
  seekRef.current = onSeek

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let W = 0, H = 0, dpr = 1
    let staticLayer: HTMLCanvasElement | null = null
    let hoverX = -1
    const D = model.duration
    const PAD = 10
    const xOf = (t: number) => PAD + (t / D) * (W - 2 * PAD)
    const tOf = (x: number) => clamp(((x - PAD) / (W - 2 * PAD)) * D, 0, D)

    const renderStatic = () => {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(W * dpr))
      c.height = Math.max(1, Math.round(H * dpr))
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const mid = H * 0.62, amp = H * 0.34
      // scan span bracket
      const X = model.x
      if (X.length) {
        const a = xOf(X[0].xray[0]) - 4, b = xOf(X[X.length - 1].xray[1]) + 4
        g.fillStyle = 'rgba(62,224,143,0.07)'
        g.fillRect(a, 12, b - a, H - 14)
        g.strokeStyle = 'rgba(62,224,143,0.45)'
        g.beginPath(); g.moveTo(a, 16); g.lineTo(a, 12); g.lineTo(b, 12); g.lineTo(b, 16); g.stroke()
        g.font = '700 9.5px "JetBrains Mono", ui-monospace, monospace'
        g.fillStyle = 'rgba(139,255,190,0.85)'
        g.textAlign = 'center'
        g.fillText('X-RAY SHOTS', (a + b) / 2, 9)
      }
      // min/max envelope of the trace per pixel column
      const sig = model.sig, fs = model.fs
      g.strokeStyle = 'rgba(125,255,181,0.5)'
      g.lineWidth = 1
      g.beginPath()
      for (let x = PAD; x < W - PAD; x++) {
        const i0 = Math.floor(tOf(x) * fs), i1 = Math.min(sig.length - 1, Math.floor(tOf(x + 1) * fs))
        let lo = Infinity, hi = -Infinity
        for (let i = i0; i <= Math.max(i0, i1); i++) { const v = sig[i]; if (v < lo) lo = v; if (v > hi) hi = v }
        g.moveTo(x + 0.5, mid - hi * amp)
        g.lineTo(x + 0.5, mid - lo * amp + 0.5)
      }
      g.stroke()
      // shots
      for (const e of X) {
        const a = xOf(e.xray[0]), b = Math.max(a + 2, xOf(e.xray[1]))
        g.fillStyle = 'rgba(93,255,176,0.85)'
        g.fillRect(a, 16, b - a, H - 18)
      }
      // seconds
      g.font = '500 9px "JetBrains Mono", ui-monospace, monospace'
      g.textAlign = 'center'
      for (let s = 0; s <= D; s += 5) {
        g.fillStyle = 'rgba(139,151,168,0.6)'
        g.fillRect(Math.round(xOf(s)), H - 3, 1, 3)
      }
      staticLayer = c
    }

    let lastSec = -1
    const draw = (t: number) => {
      const sec = Math.floor(t)
      if (sec !== lastSec) { lastSec = sec; cv.setAttribute('aria-valuenow', String(sec)); cv.setAttribute('aria-valuetext', `${t.toFixed(0)} seconds`) }
      if (!W || !H) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, cv.width, cv.height)
      if (staticLayer) ctx.drawImage(staticLayer, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const x = xOf(t)
      // played part tint
      ctx.fillStyle = 'rgba(56,214,255,0.06)'
      ctx.fillRect(PAD, 14, x - PAD, H - 14)
      if (player.loop) {
        const lx = xOf(model.loopStart)
        ctx.fillStyle = 'rgba(231,237,245,0.35)'
        ctx.fillRect(Math.round(lx), 14, 1, H - 14)
      }
      ctx.fillStyle = '#e7fff1'
      ctx.fillRect(Math.round(x) - 1, 12, 2, H - 12)
      ctx.beginPath(); ctx.arc(x, 13, 4, 0, Math.PI * 2); ctx.fill()
      if (hoverX >= 0) {
        const ht = tOf(hoverX)
        ctx.fillStyle = 'rgba(231,237,245,0.35)'
        ctx.fillRect(Math.round(hoverX), 14, 1, H - 14)
        ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
        ctx.textAlign = hoverX > W - 60 ? 'right' : 'left'
        ctx.fillStyle = 'rgba(231,237,245,0.9)'
        ctx.fillText(`${ht.toFixed(1)} s`, hoverX + (hoverX > W - 60 ? -5 : 5), H - 6)
      }
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = cv.clientWidth
      H = cv.clientHeight
      cv.width = Math.max(1, Math.round(W * dpr))
      cv.height = Math.max(1, Math.round(H * dpr))
      renderStatic()
      draw(player.t)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()
    bus.add(draw)

    let dragging = false
    const local = (e: PointerEvent) => e.clientX - cv.getBoundingClientRect().left
    const down = (e: PointerEvent) => {
      dragging = true
      cv.setPointerCapture(e.pointerId)
      seekRef.current(tOf(local(e)))
      draw(player.t)
    }
    const move = (e: PointerEvent) => {
      hoverX = e.pointerType === 'mouse' ? local(e) : -1
      if (dragging) seekRef.current(tOf(local(e)))
      draw(player.t)
    }
    const up = (e: PointerEvent) => {
      dragging = false
      try { cv.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const leave = () => { hoverX = -1; draw(player.t) }
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1
      if (e.key === 'ArrowRight') { e.preventDefault(); seekRef.current(Math.min(D, player.t + step)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekRef.current(Math.max(0, player.t - step)) }
      else if (e.key === 'Home') { e.preventDefault(); seekRef.current(0) }
    }
    cv.addEventListener('keydown', key)
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('pointerleave', leave)
    return () => {
      ro.disconnect(); bus.delete(draw)
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      cv.removeEventListener('pointerleave', leave)
      cv.removeEventListener('keydown', key)
    }
  }, [player, model, bus])

  return (
    <canvas
      ref={ref}
      className="hb-timeline"
      role="slider"
      tabIndex={0}
      aria-label="Recording timeline: click, drag or use the arrow keys to jump"
      aria-valuemin={0}
      aria-valuemax={Math.round(model.duration)}
    />
  )
}
