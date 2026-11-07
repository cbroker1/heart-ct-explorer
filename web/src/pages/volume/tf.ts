/** Transfer-function helpers: control points in HU -> 256-entry RGBA lookup table. */

export interface TFPoint {
  hu: number
  /** sRGB hex colour */
  color: string
  /** opacity per millimetre of ray (0..1+) */
  alpha: number
}

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const srgbToLinear = (c: number) => Math.pow(c, 2.2)
export const linearToSrgb = (c: number) => Math.pow(Math.max(0, c), 1 / 2.2)

export function rgbToCss(c: RGB, a = 1): string {
  const r = Math.round(c[0] * 255), g = Math.round(c[1] * 255), b = Math.round(c[2] * 255)
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`
}

/** Apply the user's shift (HU) and width (scale about `pivot`) to a preset's control points. */
export function transformPoints(points: TFPoint[], shift: number, width: number, pivot: number): TFPoint[] {
  return points.map((p) => ({ ...p, hu: pivot + shift + (p.hu - pivot) * width }))
}

/** Evaluate a piecewise-linear TF (colour interpolated in linear light). Returns linear rgb + alpha. */
export function evalTF(points: TFPoint[], hu: number): [number, number, number, number] {
  if (!points.length) return [0, 0, 0, 0]
  const lin = (p: TFPoint) => hexToRgb(p.color).map(srgbToLinear) as RGB
  if (hu <= points[0].hu) { const c = lin(points[0]); return [c[0], c[1], c[2], points[0].alpha] }
  const last = points[points.length - 1]
  if (hu >= last.hu) { const c = lin(last); return [c[0], c[1], c[2], last.alpha] }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    if (hu >= a.hu && hu <= b.hu) {
      const t = b.hu === a.hu ? 0 : (hu - a.hu) / (b.hu - a.hu)
      const ca = lin(a), cb = lin(b)
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, a.alpha + (b.alpha - a.alpha) * t]
    }
  }
  return [0, 0, 0, 0]
}

/**
 * Build the 256-entry LUT, indexed exactly like the uint8 volume:
 * entry i <-> HU = huMin + i/255 * (huMax - huMin). Returns Float32 RGBA (linear rgb, alpha per mm).
 */
export function buildLUT(points: TFPoint[], huMin: number, huMax: number): Float32Array {
  const out = new Float32Array(256 * 4)
  // Supersample each entry a little so narrow ramps are not aliased by the 11.8 HU bins.
  const S = 4
  for (let i = 0; i < 256; i++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let s = 0; s < S; s++) {
      const f = (i + (s + 0.5) / S - 0.5) / 255
      const hu = huMin + Math.min(1, Math.max(0, f)) * (huMax - huMin)
      const c = evalTF(points, hu)
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]
    }
    // opacity-weighted colour average (avoids dark fringes where a ramp starts)
    const o = i * 4
    if (a > 1e-9) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a } else {
      const c = evalTF(points, huMin + (i / 255) * (huMax - huMin)); out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]
    }
    out[o + 3] = a / S
  }
  return out
}

/** Histogram of a uint8 volume (256 bins); bin 0 (pure air / outside body) is dropped. */
export function histogram(data: Uint8Array): Float32Array {
  const h = new Float64Array(256)
  // stride sampling is plenty for a display histogram
  const stride = data.length > 4e6 ? 3 : 1
  for (let i = 0; i < data.length; i += stride) h[data[i]]++
  h[0] = 0
  const out = new Float32Array(256)
  for (let i = 0; i < 256; i++) out[i] = h[i]
  return out
}

/** Plain-English tissue class for a HU value (rough, for tooltips). */
export function tissueName(hu: number): string {
  if (hu < -900) return 'air'
  if (hu < -500) return 'lung tissue (mostly air)'
  if (hu < -200) return 'lung / soft-tissue edge'
  if (hu < -30) return 'fat'
  if (hu < 20) return 'water-like fluid / soft tissue'
  if (hu < 100) return 'soft tissue, muscle or blood'
  if (hu < 300) return 'dense tissue, cartilage or calcium'
  return 'bone or calcium'
}
