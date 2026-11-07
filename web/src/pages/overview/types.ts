/** Local types for the Overview page: exam.json is not typed in the shared lib, so we describe the parts we read. */
import type { Vec3 } from '../../lib/data'

export interface TopogramMeta {
  png: string
  /** [rowStart, rowEnd, colStart, colEnd] of the crop applied to the original DICOM topogram */
  crop: [number, number, number, number]
  /** [row spacing, column spacing] in mm */
  pixelSpacing: [number, number]
  orientation: number[]
  position: Vec3
  kvp: number
  /** [rows, cols] of the PNG */
  shape: [number, number]
  /** PNG pixel rows (pixel-centre convention) of the top and bottom of the scanned range */
  scanRangeRows?: [number, number]
}

export interface ExamJson {
  exam: Record<string, string | number | string[]>
  series?: Record<string, { key: string; description: string; sliceThickness: number; size: Vec3 }>
  topograms?: { ap?: TopogramMeta; lateral?: TopogramMeta }
  radiologistMeasurement?: {
    label: string
    what: string
    series: string
    instance: number
    pointsLPS: [Vec3, Vec3]
    lengthMM: number
  }
  dose?: {
    dlpTotal_mGycm: number
    ctdivol_mGy: number
    ssde_mGy: number
    waterEquivalentDiameter_cm: number
    kvp: number
    rotationTime_s: number
    mode: string
  }
  ecg?: { hrAvg: number; hrMin: number; hrMax: number; scanPhase: string; reconPhase: string }
  clearRead?: { lungVolumeRightL: number; lungVolumeLeftL: number; findings: number; note: string }
}

/** Shared state for drag-to-spin: written by DOM pointer handlers, read every frame by the 3D scene. */
export interface SpinState {
  angle: number
  vel: number
  dragging: boolean
  lastX: number
  lastT: number
}
