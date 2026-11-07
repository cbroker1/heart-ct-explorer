/** Types for the JSON reports in public/data (produced by the Python pipeline). */
import type { Vec3 } from './data'

// ---------------------------------------------------------------- calcium.json
export interface CalciumBlob { z: number; area: number; peak: number }
export interface CalciumVote { reviewer: string; verdict: string; artery?: string; confidence: number; note: string }
export interface CalciumCandidate {
  id: number
  slices: number[]
  nSlices: number
  peakHU: number
  peakSlice: number
  meanHU: number
  areaSum_mm2: number
  maxArea_mm2: number
  volume_mm3: number
  centerLPS: Vec3
  centerVoxel: Vec3
  depthInHeart_mm: { min: number; mean: number }
  fracInHeart: number
  fracInPericardium: number
  fracInAorta: number
  fracInLiver: number
  distToAorta_mm: number
  chamber?: string
  blobs: CalciumBlob[]
  ruleClass: 'noise' | 'review' | 'aortic'
  ruleReasons: string[]
  /** after adjudication: coronary | aortic | valvular | noise-artifact | bone | other (or the ruleClass if unreviewed) */
  finalClass: string
  artery: string | null
  reviewNote?: string
  reviewVotes?: CalciumVote[]
}
export interface CalciumReport {
  method: Record<string, string | number>
  noise: { heartInteriorMeanHU: number; heartInteriorSD_HU: number; thresholdInSigmasAboveBlood: number }
  candidates: CalciumCandidate[]
  totals: { agatston: number; agatstonEven: number; agatstonOdd: number; volume_mm3: number; mass_mg: number }
  perArtery: Record<string, { agatston: number; volume_mm3: number; mass_mg: number; lesions: number }>
  thresholdSweep: { thresholdHU: number; blobs: number; naiveScoreIfAllCounted: number }[]
  reviewed: boolean
  /** filled in after the AI adjudication panel */
  adjudication?: {
    reviewers: { key: string; lens: string; agatstonEstimate: number; confidenceZero: number; summary: string }[]
    consensus: string
    openItems?: string[]
  }
  percentileContext?: {
    source: string
    url?: string
    age: number
    rows: { group: string; p75: number; p90: number; p95: number; p97_5: number }[]
    prevalenceNonzero?: Record<string, number>
    note?: string
  }
}

// ---------------------------------------------------------------- read.json (AI second read)
export type Severity = 0 | 1 | 2 | 3
export type FindingCategory = 'normal-variant' | 'benign-incidental' | 'indeterminate' | 'potentially-significant' | 'artifact'
export interface ReadFinding {
  id: string
  title: string
  description: string
  plainEnglish: string
  location: string
  category: FindingCategory
  severity: Severity
  confidence: number
  recommendation?: string
  measurements?: string
  verification: {
    status: 'confirmed' | 'downgraded' | 'refuted' | 'unverified'
    votes: { lens: string; refuted: boolean; note: string }[]
  }
  images: string[]                     // relative to data/, e.g. "read/heart_01.png"
  link?: { series: string; lps: Vec3; plane: 'axial' | 'coronal' | 'sagittal'; window?: string }
}
export interface ReadSystem {
  key: string
  title: string
  status: 'normal' | 'minor' | 'attention'
  summary: string
  checked: { item: string; result: string }[]
  measurements: { name: string; value: string; reference?: string; method?: string }[]
  findings: ReadFinding[]
  images: { src: string; caption: string }[]
}
export interface ReadReport {
  generated: string
  mock?: boolean
  /** how the AI read was produced (counts) */
  panel?: {
    reviewers: number
    findingsExamined: number
    skepticVotes: number
    dismissed: number
    calciumAdjudicators: number
    imagesRendered?: number
    agents?: number
    toolCalls?: number
  }
  headline: string
  verdict: 'reassuring' | 'minor-notes' | 'follow-up-suggested' | 'urgent'
  impression: { n: number; text: string; severity: Severity }[]
  technique: string
  coverage: string
  systems: ReadSystem[]
  calcium: { agatston: number; summary: string; confidenceZero?: number }
  limitations: string[]
  method: string
  disclaimer: string
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  0: 'Nothing to do',
  1: 'Minor, good to know',
  2: 'Mention to your doctor',
  3: 'Prompt attention',
}
