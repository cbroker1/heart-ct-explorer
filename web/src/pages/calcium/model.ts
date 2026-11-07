/**
 * Pure helpers for the DIY calcium-score page: Agatston arithmetic, verdict styling,
 * percentile brackets, noise statistics and scan-geometry facts.
 * Every patient number shown on the page is read from calcium.json / exam.json;
 * this file only holds definitions (Agatston weights, CAC-DRS categories) and math.
 */
import type { Manifest, Vec3 } from '../../lib/data'
import type { CalciumCandidate, CalciumReport } from '../../lib/reports'

// ------------------------------------------------------------------ exam.json (subset we use)
export interface TopogramMeta {
  png: string
  crop: number[]
  pixelSpacing: number[]
  orientation: number[]
  position: number[]
  shape: number[]
  scanRangeRows?: number[]
}
export interface ExamJson {
  dose?: { dlpTotal_mGycm?: number; ctdivol_mGy?: number; ssde_mGy?: number; kvp?: number; rotationTime_s?: number; mode?: string }
  ecg?: { hrAvg?: number; hrMin?: number; hrMax?: number; scanPhase?: string; reconPhase?: string }
  topograms?: { ap?: TopogramMeta; lateral?: TopogramMeta }
}

// ------------------------------------------------------------------ method numbers
export interface DensityBand { min: number; max: number; weight: number }

/** Parse "130-199 HU: 1, 200-299: 2, 300-399: 3, >=400: 4" (falls back to the 1990 definition). */
export function parseDensityWeights(s: unknown, threshold = 130): DensityBand[] {
  const out: DensityBand[] = []
  if (typeof s === 'string') {
    for (const m of s.matchAll(/(\d+)\s*[-–]\s*(\d+)[^:,]*:\s*(\d+)/g)) out.push({ min: +m[1], max: +m[2], weight: +m[3] })
    const top = s.match(/(?:>=|≥)\s*(\d+)[^:,]*:\s*(\d+)/)
    if (top) out.push({ min: +top[1], max: Infinity, weight: +top[2] })
  }
  const ok = out.length >= 2 && out.every((b, i) => i === 0 || b.min > out[i - 1].min)
  if (ok) return out
  return [
    { min: threshold, max: 199, weight: 1 },
    { min: 200, max: 299, weight: 2 },
    { min: 300, max: 399, weight: 3 },
    { min: 400, max: Infinity, weight: 4 },
  ]
}

export interface Method {
  threshold: number
  minArea: number
  thickness: number
  increment: number
  overlap: number
  bands: DensityBand[]
  massCal: number | null
  series: string
  searchRegion: string
}

export function readMethod(r: CalciumReport): Method {
  const m = r.method ?? {}
  const num = (k: string): number | null => (typeof m[k] === 'number' ? (m[k] as number) : null)
  const threshold = num('thresholdHU') ?? 130
  const thickness = num('sliceThickness') ?? 3
  const increment = num('sliceIncrement') ?? thickness
  return {
    threshold,
    minArea: num('minAreaMM2') ?? 1,
    thickness,
    increment,
    overlap: num('overlapCorrection') ?? increment / thickness,
    bands: parseDensityWeights(m.densityWeights, threshold),
    massCal: num('massCalibration_mgPerHUcm3'),
    series: typeof m.series === 'string' ? m.series : '',
    searchRegion: typeof m.searchRegion === 'string' ? m.searchRegion : '',
  }
}

export function densityWeight(peak: number, bands: DensityBand[]): number {
  for (let i = bands.length - 1; i >= 0; i--) if (peak >= bands[i].min) return bands[i].weight
  return 0
}

/** Per-slice Agatston arithmetic for one candidate, as if it were coronary plaque. */
export function candidateBreakdown(c: CalciumCandidate, m: Method) {
  const rows = c.blobs
    .slice()
    .sort((a, b) => a.z - b.z)
    .map((b) => {
      const w = densityWeight(b.peak, m.bands)
      return { z: b.z, area: b.area, peak: b.peak, weight: w, points: b.area * w }
    })
  const raw = rows.reduce((s, r) => s + r.points, 0)
  return { rows, raw, score: raw * m.overlap }
}

export const candidateScore = (c: CalciumCandidate, m: Method) => candidateBreakdown(c, m).score

// ------------------------------------------------------------------ verdicts
export interface VerdictMeta {
  key: string
  label: string
  short: string
  color: string
  chip: string // css chip modifier
  order: number
  counted: boolean
  blurb: string
}

const V: Record<string, Omit<VerdictMeta, 'key'>> = {
  coronary: { label: 'Coronary calcium', short: 'Coronary', color: '#ff4d5e', chip: 'bad', order: 0, counted: true, blurb: 'Calcified plaque in a coronary artery. This counts toward the score.' },
  review: { label: 'Needs a closer look', short: 'Review', color: '#ffb547', chip: 'warn', order: 1, counted: false, blurb: 'Passed every automatic rule, so a reviewer has to decide.' },
  aortic: { label: 'Aortic calcium', short: 'Aortic', color: '#a08bff', chip: 'cal-chip-violet', order: 2, counted: false, blurb: 'Calcium in the aorta wall. Real, but not part of the coronary score.' },
  valvular: { label: 'Valve calcium', short: 'Valve', color: '#a08bff', chip: 'cal-chip-violet', order: 3, counted: false, blurb: 'Calcium on a heart valve. Real, but not part of the coronary score.' },
  other: { label: 'Other', short: 'Other', color: '#9aa7b8', chip: '', order: 4, counted: false, blurb: 'Bright, but not coronary calcium.' },
  bone: { label: 'Bone', short: 'Bone', color: '#9aa7b8', chip: '', order: 5, counted: false, blurb: 'Bone edge that slipped into the search region.' },
  // borderline candidates (no rule could dismiss them) that the AI reviewers then called noise / artifact
  'noise-artifact': { label: 'Cleared by AI review', short: 'Cleared by review', color: '#dbe3ee', chip: 'cal-chip-cleared', order: 6, counted: false, blurb: 'Borderline: it passed every automatic rule, so the AI reviewers examined it closely and called it image noise or an artifact, not calcium.' },
  noise: { label: 'Ruled out: noise', short: 'Noise', color: '#7f8ea3', chip: '', order: 7, counted: false, blurb: 'Dismissed automatically by a triage rule (see the reasons).' },
}

export function verdict(key: string | undefined | null): VerdictMeta {
  const k = (key ?? 'other').toLowerCase()
  const v = V[k]
  if (v) return { key: k, ...v }
  return { key: k, ...V.other, label: k.replace(/[-_]/g, ' ') }
}

export const VERDICT_ORDER = Object.keys(V)

export function sortCandidates(cs: CalciumCandidate[]): CalciumCandidate[] {
  return cs.slice().sort((a, b) => verdict(a.finalClass).order - verdict(b.finalClass).order || b.peakHU - a.peakHU || a.id - b.id)
}

export function countBy<T>(xs: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
  return m
}

// ------------------------------------------------------------------ names
const ARTERIES: Record<string, string> = {
  LM: 'Left main', LAD: 'Left anterior descending (LAD)', LCX: 'Left circumflex (LCX)', RCA: 'Right coronary artery (RCA)',
  PDA: 'Posterior descending (PDA)', OM: 'Obtuse marginal branch', D1: 'First diagonal branch', D2: 'Second diagonal branch',
  RAMUS: 'Ramus intermedius', unassigned: 'Artery not assigned',
}
export const arteryName = (a: string) => ARTERIES[a] ?? ARTERIES[a.toUpperCase()] ?? a

export function chamberLabel(ch: string | undefined, manifest: Manifest | null): string {
  if (!ch) return 'Unknown'
  if (ch === 'outside' || ch === 'none') return 'Outside the heart chambers'
  const n = manifest?.meshes.nodes.find((x) => x.name === ch)
  if (n) return n.display
  const l = manifest?.labels.classes.find((x) => x.name === ch)
  if (l) return l.display
  return ch.replace(/^heart_/, '').replace(/_/g, ' ')
}

// ------------------------------------------------------------------ categories & percentiles
export interface CacCategory { key: string; label: string; range: string; color: string; blurb: string; caption: string }
/** CAC-DRS score categories (SCCT 2018). */
export const CAC_CATEGORIES: CacCategory[] = [
  { key: 'zero', label: 'Zero', range: '0', color: '#3ee08f', blurb: 'no detectable calcified plaque', caption: 'No detectable calcified plaque' },
  { key: 'mild', label: 'Mild', range: '1–99', color: '#ffb547', blurb: 'mild calcified plaque', caption: 'Mild calcified plaque' },
  { key: 'moderate', label: 'Moderate', range: '100–299', color: '#ff8a4c', blurb: 'moderate calcified plaque', caption: 'Moderate calcified plaque' },
  { key: 'severe', label: 'Severe', range: '≥300', color: '#ff5c5c', blurb: 'extensive calcified plaque', caption: 'Extensive calcified plaque' },
]
export function cacCategory(score: number): CacCategory {
  if (!(score > 0)) return CAC_CATEGORIES[0]
  if (score < 100) return CAC_CATEGORIES[1]
  if (score < 300) return CAC_CATEGORIES[2]
  return CAC_CATEGORIES[3]
}

export type PctRow = NonNullable<CalciumReport['percentileContext']>['rows'][number]

/** Where a score falls among the published percentiles for one group. */
export function percentileBracket(score: number, r: PctRow): { short: string; long: string; level: number } {
  if (score <= r.p75) return { short: '≤ 75th', long: score === 0 && r.p75 === 0 ? 'at or below the 75th percentile: the most common result' : 'at or below the 75th percentile', level: 0 }
  if (score < r.p90) return { short: '75th–90th', long: 'between the 75th and 90th percentile', level: 1 }
  if (score === r.p90) return { short: '≈ 90th', long: 'about the 90th percentile', level: 2 }
  if (score < r.p95) return { short: '90th–95th', long: 'between the 90th and 95th percentile', level: 2 }
  if (score === r.p95) return { short: '≈ 95th', long: 'about the 95th percentile', level: 3 }
  if (score < r.p97_5) return { short: '95th–97.5th', long: 'between the 95th and 97.5th percentile', level: 3 }
  if (score === r.p97_5) return { short: '≈ 97.5th', long: 'about the 97.5th percentile', level: 4 }
  return { short: '> 97.5th', long: 'above the 97.5th percentile', level: 4 }
}

/** "White men, age 37" -> "White men" */
export const groupName = (g: string) => g.replace(/,?\s*age\s*\d+.*$/i, '').trim()

// ------------------------------------------------------------------ noise statistics
/** Complementary error function (Numerical Recipes erfcc, fractional error < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}
/** One-sided Gaussian tail probability P(Z > z). */
export const gaussTail = (z: number) => 0.5 * erfc(z / Math.SQRT2)

export function perMillionText(p: number): string {
  const pm = p * 1e6
  if (pm >= 100) return `about ${Math.round(pm / 10) * 10} in a million`
  if (pm >= 1) return `about ${Math.round(pm)} in a million`
  return `about 1 in ${Math.round(1 / p).toLocaleString('en-US')}`
}

// ------------------------------------------------------------------ where the blobs are
export function blobsPerSlice(cs: CalciumCandidate[], nSlices: number): number[] {
  const out = new Array<number>(Math.max(nSlices, 1)).fill(0)
  for (const c of cs) for (const b of c.blobs) if (b.z >= 0 && b.z < out.length) out[b.z]++
  return out
}

/** The unbroken run of non-empty slices around the busiest slice (capped to +-4 slices if it sprawls). */
export function denseBand(counts: number[]): { from: number; to: number; blobs: number } | null {
  let arg = -1
  counts.forEach((c, i) => { if (c > 0 && (arg < 0 || c > counts[arg])) arg = i })
  if (arg < 0) return null
  let from = arg, to = arg
  while (from > 0 && counts[from - 1] > 0) from--
  while (to < counts.length - 1 && counts[to + 1] > 0) to++
  if (to - from > 10) { from = Math.max(from, arg - 4); to = Math.min(to, arg + 4) }
  let blobs = 0
  for (let i = from; i <= to; i++) blobs += counts[i]
  return { from, to, blobs }
}

/** "Prospectively ECG-triggered sequential (step-and-shoot), 4 steps" -> 4 */
export function parseSteps(mode: string | undefined): number | null {
  const m = mode?.match(/(\d+)\s*steps?\b/i)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n > 1 && n < 20 ? n : null
}

/** Approximate seams between equal table steps, as fractional slice indices. */
export function stepSeams(nSlices: number, nSteps: number): number[] {
  const out: number[] = []
  for (let i = 1; i < nSteps; i++) out.push(((nSlices - 1) * i) / nSteps)
  return out
}

// ------------------------------------------------------------------ formatting
export function fmtNum(v: number, maxFrac = 1): string {
  if (!Number.isFinite(v)) return '–'
  return v.toLocaleString('en-US', { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 })
}
export const fmtScore = (v: number) => (v === 0 ? '0' : fmtNum(v, 1))
/** Confidence as a 0..1 fraction, accepting either 0..1 or 0..100 input; null if missing. */
export function frac01(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(1, Math.max(0, v > 1 ? v / 100 : v))
}
export const fmtArea = (v: number) => `${fmtNum(v, 2)} mm²`
export const pct = (v: number) => `${Math.round(v * 100)}%`
export function sliceRange(sl: number[]): string {
  if (!sl.length) return '–'
  const a = Math.min(...sl), b = Math.max(...sl)
  return a === b ? `slice ${a}` : `slices ${a}–${b}`
}

/** Deep link into the slice explorer (axial, calcium window by default) at an LPS point. */
export function sliceViewerLink(lps: Vec3, series = 'calcium', window = 'calcium'): string {
  return `/slices?series=${encodeURIComponent(series)}&lps=${lps.map((v) => v.toFixed(2)).join(',')}&plane=axial&window=${encodeURIComponent(window)}`
}

/** Compact tag for a triage-rule reason (the full sentence goes in a tooltip). */
export function shortReason(r: string): string {
  const s = r.toLowerCase()
  if (s.includes('single') && s.includes('slice')) return 'faint · single slice'
  if (s.includes('deep inside')) return 'faint · deep in heart'
  if (s.includes('liver')) return 'in the liver'
  if (s.includes('aorta')) return 'in the aorta'
  return r.length > 32 ? `${r.slice(0, 30)}…` : r
}

export const thumbUrl = (id: number) => `calcium_thumbs/thumb_${String(id).padStart(3, '0')}.png`
export const sheetUrl = (id: number) => `calcium_thumbs/cand_${String(id).padStart(3, '0')}.png`
