/** Types for public/data/biomarkers.json (written by pipeline/07_lab_assets.py). */
import type { Vec3 } from '../../../lib/data'

export type Confidence = 'measured' | 'AI estimate' | 'rough'
export type Tone = 'good' | 'neutral' | 'warn' | 'bad'
export type Status = 'typical' | 'borderline' | 'high' | 'low' | 'info'

export interface GaugeZone { from: number; to: number; tone: Tone; label: string }
export interface Gauge { min: number; max: number; zones: GaugeZone[]; ticks?: number[] }

export interface MetricLink {
  series: string
  lps: Vec3
  plane: 'axial' | 'coronal' | 'sagittal'
  window?: string
}

export interface ChamberDetail { key: string; name: string; label: string; ml: number; color: string; role: string }
export interface LevelDetail {
  level: string; meanHU: number; medianHU: number; sd: number; n: number; bodyML: number; partial: boolean
  zRange: [number, number]
}
export interface LobeDetail { key: string; name: string; label: string; side: 'R' | 'L'; ml: number; color: string }
export interface SpecItem { k: string; v: number | string; unit: string; hint?: string }
export interface Equivalent { key: string; label: string; value: number; unit: string; per: string; icon: string }

export interface Metric {
  key: string
  group: string
  label: string
  value: number
  unit: string
  display?: string
  caption: string
  context: string
  method: string
  confidence: Confidence
  series?: string
  status?: Status
  statusLabel?: string
  viz?: 'gauge' | 'chambers' | 'levels' | 'lobes' | 'radiation' | 'specs' | 'none'
  gauge?: Gauge
  detail?: Record<string, unknown>
  /** key into BiomarkerReport.images */
  image?: string
  link?: MetricLink
}

export interface ReportImage { src: string; caption: string; w: number; h: number }

export interface ArHotspot { name: string; label: string; position: Vec3; normal: Vec3 }
export interface ArNode { name: string; display: string; color: string; group: string; triangles: number; volumeML: number }
export interface ArModel {
  file: string
  bytes: number
  triangles: number
  sizeMM: Vec3
  sizeNote?: string
  nodes: ArNode[]
  hotspots: ArHotspot[]
}

export interface BiomarkerReport {
  version: number
  generated: string
  disclaimer: string
  exam?: { studyDate?: string; age?: string; sex?: string; kvp?: number; phase?: string; heartRate?: number }
  confidenceLegend?: Record<string, string>
  groups: { key: string; label: string; blurb: string }[]
  metrics: Metric[]
  radiation?: { dlp_mGycm: number; k: number; effective_mSv: number; equivalents: Equivalent[] }
  images?: Record<string, ReportImage>
  arModel?: ArModel
}

/** exam.json bits the Lab uses. */
export interface StlInfo { name: string; file: string; bytes: number; triangles: number; watertight: boolean; sizeMM: Vec3 }
export interface ExamInfo { stl?: StlInfo[]; dose?: Record<string, number | string> }
