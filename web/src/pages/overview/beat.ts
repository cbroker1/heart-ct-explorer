/**
 * One shared heartbeat clock for the Overview page, so the ECG sweep and the 3D heart stay in phase.
 * All curves take t = seconds on this clock and RR = 60 / bpm.
 */
const T0 = typeof performance !== 'undefined' ? performance.now() : 0
export const beatClock = () => (performance.now() - T0) / 1000

/** Seconds since the most recent R peak, in [0, RR). */
export function sinceR(t: number, rr: number): number {
  return ((t % rr) + rr) % rr
}

/** Signed seconds relative to the nearest R peak, in [-0.35 RR, 0.65 RR). */
export function aroundR(t: number, rr: number): number {
  const s = sinceR(t, rr)
  return s >= 0.65 * rr ? s - rr : s
}

const gauss = (x: number, c: number, s: number) => Math.exp(-0.5 * ((x - c) / s) ** 2)
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * Illustrative PQRST shape (NOT a recording), unitless with R = 1.
 * x = seconds relative to the R peak.
 */
export function ecgShape(x: number): number {
  return (
    0.11 * gauss(x, -0.165, 0.026) -
    0.1 * gauss(x, -0.03, 0.009) +
    1.0 * gauss(x, 0, 0.0105) -
    0.24 * gauss(x, 0.03, 0.011) +
    0.26 * gauss(x, 0.235, 0.048)
  )
}

/**
 * Mechanical activity (0..1) per chamber group, roughly following the cardiac cycle:
 * atria squeeze just before the R wave, ventricles squeeze ~40-300 ms after it (systole) while the
 * great arteries swell with the ejected blood.
 */
export function mechanics(t: number, rr: number) {
  const s = sinceR(t, rr)
  const a = aroundR(t, rr)
  return {
    atria: gauss(a, -0.075, 0.045),
    ventricles: smooth(0.04, 0.27, s) * (1 - smooth(0.3, 0.47, s)),
    arteries: smooth(0.07, 0.17, s) * (1 - smooth(0.21, 0.5, s)),
  }
}
