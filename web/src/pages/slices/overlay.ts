/**
 * 2D annotation layer drawn on a canvas above the WebGL canvas, in the same rAF as the GL frame:
 * crosshair, rulers, the radiologist's caliper, calcium-candidate markers and scale bars.
 */
import type { Vec3 } from '../../lib/data'
import { dist, dot, lpsToSlot, niceScale, type SlotModel } from './geom'
import type { Ruler } from './state'

export interface Caliper { a: Vec3; b: Vec3; lengthMM: number; text: string; short: string }
export interface CandidateMark { id: number; p: Vec3; color: string; strong: boolean; r: number }

export interface OverlayInput {
  W: number
  H: number
  dpr: number
  slots: SlotModel[]
  cursor: Vec3
  rulers: Ruler[]
  draft: Ruler | null
  caliper: Caliper | null
  candidates: CandidateMark[] | null
  selectedLesion: number | null
  hoverLesion: number
}

const CYAN = '56,214,255'
const RULER = '#3ee08f'
const AMBER = '#ffb547'
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

/** Caliper is shown on axial views within this distance of its slice (WEB_SPEC brief: ~2 mm). */
export const CALIPER_TOL_MM = 2

function crisp(v: number, dpr: number, widthDev: number) {
  const d = Math.round(v * dpr)
  return (widthDev % 2 === 1 ? d + 0.5 : d) / dpr
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right', bounds: { x: number; y: number; w: number; h: number }) {
  ctx.font = `600 11px ${MONO}`
  const tw = ctx.measureText(text).width
  const pw = tw + 14
  const ph = 20
  let px = align === 'center' ? x - pw / 2 : align === 'right' ? x - pw : x
  let py = y - ph / 2
  px = Math.min(Math.max(px, bounds.x + 4), bounds.x + bounds.w - pw - 4)
  py = Math.min(Math.max(py, bounds.y + 4), bounds.y + bounds.h - ph - 4)
  ctx.beginPath()
  ctx.roundRect(px, py, pw, ph, 6)
  ctx.fillStyle = 'rgba(7,10,15,0.86)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.6
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, px + 7, py + ph / 2 + 0.5)
}

function measureLine(
  ctx: CanvasRenderingContext2D, sl: SlotModel, a: Vec3, b: Vec3, color: string, label: string,
  opts: { dashed?: boolean; width?: number; labelSide?: 1 | -1 },
) {
  const [ax, ay] = lpsToSlot(sl, a)
  const [bx, by] = lpsToSlot(sl, b)
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = opts.width ?? 1.6
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 3
  if (opts.dashed) ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.setLineDash([])
  const t = 6
  ctx.beginPath()
  ctx.moveTo(ax - nx * t, ay - ny * t); ctx.lineTo(ax + nx * t, ay + ny * t)
  ctx.moveTo(bx - nx * t, by - ny * t); ctx.lineTo(bx + nx * t, by + ny * t)
  ctx.stroke()
  ctx.restore()
  // label on the "upper" side of the line
  let side = opts.labelSide ?? 1
  if (ny * side > 0) side = -side as 1 | -1
  const mx = (ax + bx) / 2 + nx * 18 * side
  const my = (ay + by) / 2 + ny * 18 * side
  pill(ctx, label, mx, my, color, 'center', sl.rect)
}

export function drawOverlay(ctx: CanvasRenderingContext2D, o: OverlayInput) {
  const { dpr } = o
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const lineDev = Math.max(1, Math.round(dpr))

  for (const sl of o.slots) {
    const r = sl.rect
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()

    // ---- calcium candidates near this plane
    if (o.candidates) {
      const tol = Math.max(1.6, sl.ax.step * 0.6)
      for (const c of o.candidates) {
        if (Math.abs(dot(c.p, sl.def.scroll) - sl.u) > tol) continue
        const [x, y] = lpsToSlot(sl, c.p)
        if (x < r.x - 20 || y < r.y - 20 || x > r.x + r.w + 20 || y > r.y + r.h + 20) continue
        const hot = c.id === o.hoverLesion || c.id === o.selectedLesion
        const rad = Math.max(8, c.r / sl.s + 5) + (hot ? 2 : 0)
        ctx.beginPath()
        ctx.arc(x, y, rad, 0, Math.PI * 2)
        ctx.strokeStyle = c.color
        ctx.globalAlpha = hot ? 1 : c.strong ? 0.9 : 0.42
        ctx.lineWidth = hot ? 2 : c.strong ? 1.5 : 1
        ctx.setLineDash(c.strong || hot ? [] : [2, 3])
        ctx.stroke()
        ctx.setLineDash([])
        if (c.strong || hot || sl.zoom >= 2.5) {
          ctx.font = `600 10.5px ${MONO}`
          ctx.fillStyle = c.color
          ctx.textAlign = 'left'
          ctx.textBaseline = 'bottom'
          ctx.shadowColor = 'rgba(0,0,0,0.9)'
          ctx.shadowBlur = 3
          ctx.fillText(`#${c.id}`, x + rad * 0.72 + 2, y - rad * 0.72)
          ctx.shadowBlur = 0
        }
        ctx.globalAlpha = 1
      }
    }

    // ---- radiologist's caliper (axial views within ~2 mm of its slice)
    if (o.caliper && sl.plane === 'axial') {
      const cu = dot(o.caliper.a, sl.def.scroll)
      if (Math.abs(cu - sl.u) <= CALIPER_TOL_MM + 1e-6) {
        measureLine(ctx, sl, o.caliper.a, o.caliper.b, AMBER, r.w < 420 ? o.caliper.short : o.caliper.text, { width: 1.8, labelSide: -1 })
      }
    }

    // ---- rulers
    const rulers = o.draft ? [...o.rulers, o.draft] : o.rulers
    for (const ru of rulers) {
      if (ru.plane !== sl.plane) continue
      if (Math.abs(ru.u - sl.u) > Math.max(sl.ax.step, ru.step) * 0.51 + 1e-3) continue
      const d = dist(ru.a, ru.b)
      measureLine(ctx, sl, ru.a, ru.b, RULER, `${d.toFixed(1)} mm`, { width: 1.6 })
    }

    // ---- crosshair (dashed, with a gap around the focus point)
    const [cx0, cy0] = lpsToSlot(sl, o.cursor)
    const cx = crisp(cx0, dpr, lineDev)
    const cy = crisp(cy0, dpr, lineDev)
    const gap = 11
    ctx.strokeStyle = `rgba(${CYAN},0.72)`
    ctx.lineWidth = lineDev / dpr
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    if (cx >= r.x && cx <= r.x + r.w) {
      ctx.moveTo(cx, r.y); ctx.lineTo(cx, cy - gap)
      ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, r.y + r.h)
    }
    if (cy >= r.y && cy <= r.y + r.h) {
      ctx.moveTo(r.x, cy); ctx.lineTo(cx - gap, cy)
      ctx.moveTo(cx + gap, cy); ctx.lineTo(r.x + r.w, cy)
    }
    ctx.stroke()
    ctx.setLineDash([])
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
      ctx.beginPath()
      ctx.arc(cx0, cy0, 1.6, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${CYAN},0.95)`
      ctx.fill()
    }

    // ---- scale bar (bottom right, above the zoom readout; tiny views have no room for it)
    if (r.w >= 220 && r.h >= 170) {
      const mm = niceScale(sl.s, Math.min(90, r.w * 0.16))
      const px = mm / sl.s
      const x1 = r.x + r.w - 26
      const x0 = x1 - px
      const y = crisp(r.y + r.h - 34, dpr, lineDev)
      ctx.strokeStyle = 'rgba(231,237,245,0.75)'
      ctx.lineWidth = lineDev / dpr
      ctx.beginPath()
      ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 4)
      ctx.stroke()
      ctx.font = `500 10.5px ${MONO}`
      ctx.fillStyle = 'rgba(231,237,245,0.8)'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 3
      ctx.fillText(`${mm} mm`, x0 - 7, y - 1)
      ctx.shadowBlur = 0
    }
    ctx.restore()
  }
}
