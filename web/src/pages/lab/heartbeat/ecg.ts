/**
 * ecg.json (pipeline/06_ecg.py) types, plus a small physiological model that turns the real ECG
 * timing (R peaks, P waves, QRS onsets) into heart-motion curves for the 3D animation.
 *
 * The ECG, the beat times and the X-ray windows are measured from the scanner's printout.
 * The *motion* is a textbook model timed to those events: the CT itself is a single still frame.
 */
import { loadJSON } from '../../../lib/data'

export interface EcgBeat {
  r: number                // R-peak time (s), from the digitized trace
  marker: number           // the scanner's own R marker (it triggers on the upstroke, ~25 ms earlier)
  amp: number              // R amplitude (normalized)
  p: number | null         // P-wave peak time
  pAmp: number | null
  t: number | null         // T-wave peak time
  tAmp: number | null
  qrsOnset: number
}
export interface EcgInterval {
  from: number; to: number
  start: number; end: number; rr: number
  hrPrinted: number        // heart rate the scanner printed for this R-R interval
  hrMeasured: number
  markerStart: number; markerEnd: number
}
export interface EcgExposure {
  n: number
  xray: [number, number]   // X-ray on (s)
  recon: [number, number]  // image-data window (s)
  durationMs: number
  reconMs: number
  interval: number
  hrPrinted: number
  phase: { xrayStart: number; xrayCenter: number; xrayEnd: number; reconCenter: number }
  predicted: { rrFromPreviousBeat: number; centerAt75pct: number; errorMs: number }
  tablePosition?: [number, number]
  zRangeLPS?: [number, number]
}
export interface EcgRow {
  strip: number; image: string; row: number
  t0: number; t1: number
  cropBoxPx: number[]
  png: string
  yOffsetInPng: number
  yPx: number[]
  amp: number[]
}
export interface EcgData {
  version: number
  generated: string
  source: { what: string; series: string; scanner: string; images: number; rows: number; deidentified: string }
  header: {
    hrXray: { avg: number; min: number; max: number }
    channel: number
    signalStrength: string
    scanPhase: string
    reconPhase: string
  }
  calibration: {
    pxPerSecond: number; pxPerSecondFit: number; pxPerSecondMean: number
    fitResidualMsRms: number; fitResidualMsMax: number
    rowWidthPx: number; rowSeconds: number
    rowBreakGapPx: number[]; rowJoinLevelJumpPx: number[]
    rPeakHeightPx: number
    amplitude: string
  }
  fs: number
  duration: number
  signal: number[]
  beats: EcgBeat[]
  intervals: EcgInterval[]
  exposures: EcgExposure[]
  rhythm: {
    beats: number; rrIntervals: number
    hrPrintedRange: [number, number]
    hrFirst8Avg: number; hrLast8Avg: number
    rrRange: [number, number]
    maxBeatToBeatChangeMs: number
    prematureBeats: number
    pWaveBeforeEveryQRS: boolean
    pWavesFound: number
    qrsWidthMsMedian: number
    qrsWidthMsRange: [number, number]
    prIntervalMsMedian: number
    note: string
  }
  rows: EcgRow[]
  assumptions: string[]
}

export const loadEcg = () => loadJSON<EcgData>('ecg.json')

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const smooth01 = (x: number) => {
  const c = clamp(x, 0, 1)
  return c * c * (3 - 2 * c)
}

export type Stage = 'systole' | 'relax' | 'filling' | 'diastasis' | 'atrial'
export const STAGE_LABEL: Record<Stage, string> = {
  systole: 'Squeeze (systole)',
  relax: 'Relaxing',
  filling: 'Filling',
  diastasis: 'Quiet phase (diastasis)',
  atrial: 'Atrial kick',
}

export interface CardiacState {
  k: number          // index of the last R peak at or before t (-1 before the first one)
  r0: number         // start of the current cycle (an R peak; virtual before the first)
  rr: number         // length of the current cycle (s)
  tau: number        // time since r0 (s)
  phase: number      // tau / rr, 0..1
  ts: number         // end of ejection, s after R
  v: number          // ventricular contraction: 0 = relaxed & full, 1 = end-systole
  a: number          // atrial contraction 0..1
  waveA: number      // atrial depolarisation progress 0..1 (P wave), -1 when idle
  waveV: number      // ventricular depolarisation progress 0..1 (QRS), -1 when idle
  stage: Stage
}

/** Model constants (seconds). Textbook values; the rest of the timing comes from the real ECG. */
const EMD = 0.03          // electro-mechanical delay after the R wave
const IVR = 0.06          // isovolumic relaxation
const RAPID_FILL = 0.09   // rapid early filling
const P_WAVE = 0.09       // atrial depolarisation spread
const QRS = 0.09          // ventricular depolarisation spread (measured median QRS ~86 ms)
const DEFAULT_PR = 0.15   // R minus P-peak, used when a beat's P wave is unusable

export class Cardio {
  readonly R: number[]
  readonly M: number[]       // the scanner's R markers (its trigger points)
  readonly P: number[]       // P-peak time per beat (sanitised)
  readonly Q: number[]       // QRS onset per beat
  readonly sig: Float32Array
  readonly fs: number
  readonly duration: number
  /** Loop restart point: a splice from the end (diastole) into the start that keeps an R-R of ~0.8 s. */
  readonly loopStart: number
  readonly x: EcgExposure[]
  readonly slabY: [number, number][]   // per exposure, heart-space y range (mm)

  constructor(public readonly data: EcgData, worldCenterZ: number) {
    this.R = data.beats.map((b) => b.r)
    this.M = data.beats.map((b) => b.marker)
    this.P = data.beats.map((b) => {
      const pr = b.p == null ? DEFAULT_PR : b.r - b.p
      return b.r - (pr > 0.09 && pr < 0.22 ? pr : DEFAULT_PR)
    })
    this.Q = data.beats.map((b) => b.qrsOnset)
    this.sig = Float32Array.from(data.signal)
    this.fs = data.fs
    this.duration = (this.sig.length - 1) / this.fs
    const lastR = this.R[this.R.length - 1]
    const gapAfterLast = this.duration - lastR
    this.loopStart = clamp(this.R[0] - Math.max(0.12, 0.8 - gapAfterLast), 0, this.R[0] - 0.1)
    this.x = data.exposures
    this.slabY = data.exposures.map((e) => {
      const z = e.zRangeLPS ?? [0, 0]
      return [z[0] - worldCenterZ, z[1] - worldCenterZ]
    })
  }

  /** ECG amplitude at recording time t (linear interpolation), NaN outside the recording. */
  sample(t: number): number {
    const f = t * this.fs
    if (!(f >= 0) || f > this.sig.length - 1) return NaN
    const i = Math.floor(f)
    const w = f - i
    return i + 1 < this.sig.length ? this.sig[i] * (1 - w) + this.sig[i + 1] * w : this.sig[i]
  }

  /** Index of the last R peak at or before t (-1 if none). */
  beatIndex(t: number): number {
    const R = this.R
    let lo = 0, hi = R.length - 1, ans = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (R[m] <= t) { ans = m; lo = m + 1 } else hi = m - 1
    }
    return ans
  }

  /** Phase within the beat as the scanner counts it: 0 at its R marker, 1 at the next one. */
  scannerPhase(t: number): number {
    const M = this.M, n = M.length
    let lo = 0, hi = n - 1, k = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (M[m] <= t) { k = m; lo = m + 1 } else hi = m - 1
    }
    let a: number, b: number
    if (k < 0) { b = M[0]; a = b - (M[1] - M[0]) }
    else if (k >= n - 1) { a = M[n - 1]; b = a + (M[n - 1] - M[n - 2]) }
    else { a = M[k]; b = M[k + 1] }
    return clamp((t - a) / (b - a), 0, 1)
  }

  /** Printed HR of the R-R interval that ended at beat k (what a monitor shows after beat k). */
  hrAfterBeat(k: number): number | null {
    if (k <= 0 || k - 1 >= this.data.intervals.length) return null
    return this.data.intervals[k - 1].hrPrinted
  }

  /** Index of the exposure whose X-ray window contains t, else -1. */
  exposureAt(t: number): number {
    for (let i = 0; i < this.x.length; i++) if (t >= this.x[i].xray[0] && t <= this.x[i].xray[1]) return i
    return -1
  }

  /** Playback slow-down factor around the X-ray shots (1 = normal). */
  slowFactor(t: number): number {
    let f = 1
    for (const e of this.x) {
      const d = Math.max(0, e.xray[0] - t, t - e.xray[1])
      f = Math.min(f, 0.2 + 0.8 * smooth01(d / 0.28))
    }
    return f
  }

  /** X-ray envelope for the visuals: which shot, how bright (0..1), tube angle (rad). */
  xray(t: number): { i: number; on: number; angle: number } {
    let best = { i: -1, on: 0, angle: 0 }
    for (let i = 0; i < this.x.length; i++) {
      const [a, b] = this.x[i].xray
      let on = 0
      if (t >= a && t <= b) on = 1
      else if (t > b) on = Math.exp(-(t - b) / 0.22)
      else if (t > a - 0.04) on = (t - (a - 0.04)) / 0.04
      if (on > best.on) best = { i, on, angle: ((t - a) / 0.25) * Math.PI * 2 }   // 0.25 s per rotation
    }
    return best
  }

  /** Height (heart-space mm) of the scanner's beam ring: parked, then stepping slab to slab. */
  ringY(t: number): number {
    const S = this.slabY, X = this.x
    if (!S.length) return 0
    const c = S.map((s) => 0.5 * (s[0] + s[1]))
    if (t <= X[0].xray[1]) return c[0]
    for (let k = 0; k < X.length - 1; k++) {
      if (t <= X[k + 1].xray[0]) {
        const m0 = X[k].xray[1] + 0.06, m1 = X[k + 1].xray[0] - 0.18
        return c[k] + (c[k + 1] - c[k]) * smooth01((t - m0) / Math.max(0.05, m1 - m0))
      }
      if (t <= X[k + 1].xray[1]) return c[k + 1]
    }
    return c[c.length - 1]
  }

  private prOf(j: number): number {
    return j >= 0 && j < this.R.length ? this.R[j] - this.P[j] : DEFAULT_PR
  }

  /** The mechanical state of the (model) heart at recording time t. */
  state(t: number): CardiacState {
    const R = this.R, n = R.length
    const k = this.beatIndex(t)
    let r0: number, r1: number
    if (k < 0) { const rr0 = R[1] - R[0]; r0 = R[0] - rr0; r1 = R[0] }
    else if (k >= n - 1) { const rrL = R[n - 1] - R[n - 2]; r0 = R[n - 1]; r1 = r0 + rrL }
    else { r0 = R[k]; r1 = R[k + 1] }
    const rr = r1 - r0
    const tau = t - r0
    const prNext = this.prOf(k + 1)
    const ts = clamp(0.4 * Math.sqrt(rr) - 0.045, 0.24, 0.36)     // end of ejection ~ end of T wave (QT-like scaling)
    const aStart = rr - prNext + 0.02
    const fillEnd = Math.min(ts + IVR + RAPID_FILL, aStart - 0.01)

    let v: number, stage: Stage
    if (tau < EMD) { v = 0; stage = 'systole' }
    else if (tau < ts) { const x = (tau - EMD) / (ts - EMD); v = 1 - Math.pow(1 - x, 2.2); stage = 'systole' }
    else if (tau < Math.min(ts + IVR, fillEnd)) { v = 1; stage = 'relax' }
    else if (tau < fillEnd) { const x = (tau - ts - IVR) / (fillEnd - ts - IVR); v = 1 - 0.8 * (1 - Math.pow(1 - x, 4)); stage = 'filling' }
    else if (tau < aStart) { const x = (tau - fillEnd) / Math.max(1e-3, aStart - fillEnd); v = 0.2 - 0.06 * x; stage = 'diastasis' }
    else { const x = (tau - aStart) / Math.max(1e-3, rr - aStart); v = 0.14 * (1 - smooth01(x)); stage = 'atrial' }

    // atrial contraction: a sin^2 bump from just after the P peak to just after the R
    const bump = (pj: number, rj: number) => {
      const a0 = pj + 0.02, a1 = rj + 0.04
      const x = (t - a0) / (a1 - a0)
      return x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 2) : 0
    }
    const pNext = r1 - prNext
    const pCur = k >= 0 ? this.P[k] : r0 - DEFAULT_PR
    const a = Math.max(bump(pNext, r1), bump(pCur, r0))

    let waveA = -1
    for (const pj of [pCur, pNext]) {
      const x = (t - (pj - P_WAVE / 2)) / P_WAVE
      if (x >= 0 && x <= 1) waveA = x
    }
    let waveV = -1
    for (const j of [k, k + 1]) {
      const q = j >= 0 && j < n ? this.Q[j] : j === n ? r1 - 0.04 : NaN
      const x = (t - q) / QRS
      if (x >= 0 && x <= 1) waveV = x
    }
    return { k, r0, rr, tau, phase: clamp(tau / rr, 0, 1), ts, v, a, waveA, waveV, stage }
  }

  /** How fast the model heart is moving, ~0 (still) .. 1 (fastest), for the "stillest moment" meter. */
  motion(t: number): number {
    const h = 0.01
    const s0 = this.state(t - h), s1 = this.state(t + h)
    const dv = Math.abs(s1.v - s0.v) / (2 * h), da = Math.abs(s1.a - s0.a) / (2 * h)
    return clamp((dv + 0.25 * da) / 6, 0, 1)
  }
}

export const fmtS = (t: number, d = 1) => `${t.toFixed(d)} s`
export const pct = (x: number) => `${Math.round(x * 100)}%`
