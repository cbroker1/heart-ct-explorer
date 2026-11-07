/** Small UI pieces for the volume page (all classes prefixed `vol-`). */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { evalTF, linearToSrgb, type TFPoint } from './tf'
import type { ViewName } from './presets'

// ------------------------------------------------------------------ dual-thumb range slider

export function RangeSlider(props: {
  label: string
  value: [number, number]
  onChange: (v: [number, number]) => void
  format: (v: [number, number]) => string
  title?: string
  minGap?: number
  ends?: [string, string]
}) {
  const { value, onChange, minGap = 0.03 } = props
  const [lo, hi] = value
  const set = (which: 0 | 1, raw: number) => {
    const v = raw / 1000
    if (which === 0) onChange([Math.min(v, hi - minGap), hi])
    else onChange([lo, Math.max(v, lo + minGap)])
  }
  return (
    <div className="vol-range" title={props.title}>
      <div className="vol-range-lbl">
        <span>{props.label}</span>
        <span className="val">{props.format(value)}</span>
      </div>
      <div className="vol-range-track">
        <div className="vol-range-fill" style={{ left: `${lo * 100}%`, right: `${(1 - hi) * 100}%` }} />
        <input type="range" min={0} max={1000} step={1} value={Math.round(lo * 1000)} aria-label={`${props.label} minimum`}
          onChange={(e) => set(0, Number(e.target.value))} />
        <input type="range" min={0} max={1000} step={1} value={Math.round(hi * 1000)} aria-label={`${props.label} maximum`}
          onChange={(e) => set(1, Number(e.target.value))} />
      </div>
      {props.ends && (
        <div className="vol-range-ends"><span>{props.ends[0]}</span><span>{props.ends[1]}</span></div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ transfer-function strip

// Piecewise-linear HU axis: -1024..500 HU gets 84% of the width (where tissues differ), 500..1600 the rest.
const HU_LO = -1024
const HU_KNEE = 500
const HU_HI = 1600
const KNEE_X = 0.84
const huToX = (hu: number) => (hu <= HU_KNEE ? ((hu - HU_LO) / (HU_KNEE - HU_LO)) * KNEE_X : KNEE_X + ((Math.min(hu, HU_HI) - HU_KNEE) / (HU_HI - HU_KNEE)) * (1 - KNEE_X))
const xToHu = (x: number) => (x <= KNEE_X ? HU_LO + (x / KNEE_X) * (HU_KNEE - HU_LO) : HU_KNEE + ((x - KNEE_X) / (1 - KNEE_X)) * (HU_HI - HU_KNEE))
const BANDS: { lo: number; hi: number; name: string }[] = [
  { lo: -1024, hi: -900, name: 'air' },
  { lo: -900, hi: -500, name: 'lung' },
  { lo: -190, hi: -30, name: 'fat' },
  { lo: 0, hi: 100, name: 'soft' },
  { lo: 250, hi: 1600, name: 'bone' },
]

export function TFStrip(props: {
  points: TFPoint[] | null
  hist: Float32Array | null
  huMin: number
  huMax: number
  mipWindow?: [number, number] | null
  onShift?: (deltaHU: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(268)
  const H = 92

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(120, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(w * dpr); c.height = Math.round(H * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, H)
    const plotH = H - 22
    const x = (hu: number) => huToX(hu) * w
    // tissue bands
    g.font = '600 9px Inter, system-ui, sans-serif'
    g.textBaseline = 'top'
    for (const b of BANDS) {
      const x0 = x(b.lo), x1 = x(b.hi)
      g.fillStyle = 'rgba(255,255,255,0.025)'
      g.fillRect(x0, 0, x1 - x0, plotH)
      g.fillStyle = 'rgba(138,151,168,0.75)'
      g.textAlign = 'center'
      g.fillText(b.name, (x0 + x1) / 2, plotH + 11)
    }
    // histogram (log)
    if (props.hist) {
      const hist = props.hist
      let mx = 0
      for (let i = 1; i < 256; i++) mx = Math.max(mx, Math.log1p(hist[i]))
      g.beginPath()
      g.moveTo(0, plotH)
      for (let i = 1; i < 256; i++) {
        const hu = props.huMin + (i / 255) * (props.huMax - props.huMin)
        if (hu > HU_HI) break
        const y = plotH - (Math.log1p(hist[i]) / (mx || 1)) * (plotH - 6)
        g.lineTo(x(hu), y)
      }
      g.lineTo(x(Math.min(HU_HI, props.huMax)), plotH)
      g.closePath()
      g.fillStyle = 'rgba(160,175,195,0.13)'
      g.fill()
    }
    if (props.points && props.points.length) {
      // colour fill under the opacity curve
      const yOf = (a: number) => plotH - Math.pow(Math.min(1, a), 0.42) * (plotH - 4)
      for (let px = 0; px < w; px++) {
        const hu = xToHu(px / w)
        const c4 = evalTF(props.points, hu)
        if (c4[3] <= 0.0005) continue
        const y = yOf(c4[3])
        g.fillStyle = `rgba(${Math.round(linearToSrgb(c4[0]) * 255)},${Math.round(linearToSrgb(c4[1]) * 255)},${Math.round(linearToSrgb(c4[2]) * 255)},0.85)`
        g.fillRect(px, y, 1.2, plotH - y)
      }
      g.beginPath()
      for (let px = 0; px <= w; px++) {
        const hu = xToHu(px / w)
        const y = yOf(evalTF(props.points, hu)[3])
        if (px === 0) g.moveTo(px, y); else g.lineTo(px, y)
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)'
      g.lineWidth = 1.4
      g.stroke()
    } else if (props.mipWindow) {
      const [lo, hi] = props.mipWindow
      const grad = g.createLinearGradient(x(lo), 0, x(hi), 0)
      grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0.9)')
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(x(lo), plotH); g.lineTo(x(hi), 4); g.lineTo(w, 4); g.lineTo(w, plotH); g.closePath()
      g.fill()
      g.beginPath(); g.moveTo(0, plotH); g.lineTo(x(lo), plotH); g.lineTo(x(hi), 4); g.lineTo(w, 4)
      g.strokeStyle = 'rgba(56,214,255,0.95)'; g.lineWidth = 1.4; g.stroke()
    }
    // axis
    g.fillStyle = 'rgba(255,255,255,0.12)'
    g.fillRect(0, plotH, w, 1)
    g.font = '500 9px "JetBrains Mono", ui-monospace, monospace'
    g.fillStyle = 'rgba(138,151,168,0.9)'
    // knee marker
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(x(HU_KNEE), 0, 1, plotH)
    g.fillStyle = 'rgba(138,151,168,0.9)'
    for (const t of [-1000, -500, 0, 500, 1500]) {
      const xx = x(t)
      g.fillRect(xx, plotH, 1, 3)
      g.textAlign = t === -1000 ? 'left' : t === 1500 ? 'right' : 'center'
      g.fillText(String(t), Math.max(1, Math.min(w - 1, xx)), plotH + 1.5)
    }
  }, [w, props.points, props.hist, props.huMin, props.huMax, props.mipWindow])

  // drag horizontally to slide the whole transfer function
  const drag = useRef<{ x: number } | null>(null)
  return (
    <div className="vol-tf" ref={wrap}>
      <canvas
        ref={ref}
        style={{ width: '100%', height: H, cursor: props.onShift ? 'ew-resize' : 'default' } as CSSProperties}
        onPointerDown={(e) => { if (!props.onShift) return; drag.current = { x: e.clientX }; (e.target as Element).setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => {
          if (!drag.current || !props.onShift) return
          const dx = e.clientX - drag.current.x
          drag.current.x = e.clientX
          props.onShift((dx / (w * KNEE_X)) * (HU_KNEE - HU_LO))
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        aria-label="Transfer function: opacity (curve) and colour per Hounsfield unit, over the histogram of this scan"
        role="img"
      />
    </div>
  )
}

// ------------------------------------------------------------------ orientation cube (CSS 3D)

const FACES: { view: ViewName; label: string; tf: string; title: string }[] = [
  { view: 'front', label: 'Front', tf: 'translateZ(var(--h))', title: 'View from the front (anterior)' },
  { view: 'back', label: 'Back', tf: 'rotateY(180deg) translateZ(var(--h))', title: 'View from the back (posterior)' },
  { view: 'left', label: 'Left', tf: 'rotateY(90deg) translateZ(var(--h))', title: "View from the patient's left side" },
  { view: 'right', label: 'Right', tf: 'rotateY(-90deg) translateZ(var(--h))', title: "View from the patient's right side" },
  { view: 'top', label: 'Head', tf: 'rotateX(90deg) translateZ(var(--h))', title: 'View from above (head end)' },
  { view: 'bottom', label: 'Feet', tf: 'rotateX(-90deg) translateZ(var(--h))', title: 'View from below (feet end, like axial CT slices)' },
]

export function OrientationCube(props: { cubeRef: React.RefObject<HTMLDivElement | null>; onPick: (v: ViewName) => void }) {
  return (
    <div className="vol-cube-wrap" aria-label="Orientation cube: click a face to look from that side">
      <div className="vol-cube" ref={props.cubeRef}>
        {FACES.map((f) => (
          <button key={f.view} className={`vol-face vol-face-${f.view}`} style={{ transform: f.tf }} title={f.title}
            onClick={() => props.onPick(f.view)}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** CSS matrix3d for the cube from the camera's world->view rotation (flip y: CSS y points down). */
export function cubeTransform(viewInverse: ArrayLike<number>): string {
  // r_ij = e[j*4+i]; T = F R F, F = diag(1,-1,1)
  const e = viewInverse
  const r = (i: number, j: number) => e[j * 4 + i]
  const f = [1, -1, 1]
  const t = (i: number, j: number) => r(i, j) * f[i] * f[j]
  const v = [t(0, 0), t(1, 0), t(2, 0), 0, t(0, 1), t(1, 1), t(2, 1), 0, t(0, 2), t(1, 2), t(2, 2), 0, 0, 0, 0, 1]
  return `matrix3d(${v.map((x) => (Math.abs(x) < 1e-7 ? 0 : x).toFixed(6)).join(',')})`
}

/** Patient-direction letters for a world-space direction (+X = L, +Y = S, +Z = A). */
export function patientDir(x: number, y: number, z: number): string {
  const comps: [number, string][] = [
    [Math.abs(x), x >= 0 ? 'L' : 'R'],
    [Math.abs(y), y >= 0 ? 'S' : 'I'],
    [Math.abs(z), z >= 0 ? 'A' : 'P'],
  ]
  comps.sort((a, b) => b[0] - a[0])
  return comps.filter((c, i) => i === 0 || c[0] > 0.38).slice(0, 2).map((c) => c[1]).join('')
}

export const DIR_WORDS: Record<string, string> = { L: 'patient left', R: 'patient right', S: 'head', I: 'feet', A: 'front', P: 'back' }

// ------------------------------------------------------------------ legend

export function Legend(props: { title: string; items: { color: string; label: string; note?: string; ring?: boolean }[]; footer?: string }) {
  if (!props.items.length) return null
  return (
    <div className="vol-legend">
      <div className="eyebrow">{props.title}</div>
      <ul>
        {props.items.map((it) => (
          <li key={it.label}>
            <span className={`sw${it.ring ? ' ring' : ''}`} style={{ background: it.color }} />
            <span className="lbl">{it.label}</span>
            {it.note && <span className="note">{it.note}</span>}
          </li>
        ))}
      </ul>
      {props.footer && <div className="foot">{props.footer}</div>}
    </div>
  )
}
