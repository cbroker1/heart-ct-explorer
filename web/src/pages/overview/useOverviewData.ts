import { useEffect, useMemo, useState } from 'react'
import { loadJSON, type Manifest } from '../../lib/data'
import type { CalciumReport, ReadReport } from '../../lib/reports'
import type { ExamJson } from './types'

// Small JSON files are cached for the session so coming back to the landing page is instant.
const jsonCache = new Map<string, Promise<unknown>>()
function cachedJSON<T>(rel: string): Promise<T> {
  let p = jsonCache.get(rel)
  if (!p) {
    p = loadJSON<T>(rel)
    jsonCache.set(rel, p)
    p.catch(() => jsonCache.delete(rel))
  }
  return p as Promise<T>
}

export interface OverviewData {
  exam: ExamJson | null
  calcium: CalciumReport | null
  /** The real AI second read, only when the pipeline has listed it in manifest.files (never the mock). */
  read: ReadReport | null
  examError: string | null
}

export function useOverviewData(manifest: Manifest): OverviewData {
  const [exam, setExam] = useState<ExamJson | null>(null)
  const [calcium, setCalcium] = useState<CalciumReport | null>(null)
  const [read, setRead] = useState<ReadReport | null>(null)
  const [examError, setExamError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const files = manifest.files ?? {}
    cachedJSON<ExamJson>(files.exam ?? 'exam.json')
      .then((v) => alive && setExam(v))
      .catch((e) => alive && setExamError(String(e?.message ?? e)))
    if (files.calcium) {
      cachedJSON<CalciumReport>(files.calcium)
        .then((v) => alive && setCalcium(v))
        .catch(() => { /* the stat tile shows a dash */ })
    }
    // Only fetch the AI read when the pipeline listed it (avoids a 404 in the console).
    if (files.read) {
      cachedJSON<ReadReport>(files.read)
        .then((v) => alive && !v.mock && setRead(v))
        .catch(() => { /* optional teaser */ })
    }
    return () => { alive = false }
  }, [manifest])

  return { exam, calcium, read, examError }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Facts we can show immediately from the manifest (no extra fetch). */
export function useManifestFacts(manifest: Manifest) {
  return useMemo(() => {
    const ex = manifest.exam ?? {}
    const age = parseInt(String(ex.PatientAge ?? ''), 10)
    const sd = String(ex.StudyDate ?? '')
    let monthYear: string | null = null
    let dayMonthYear: string | null = null
    if (/^\d{8}$/.test(sd)) {
      const y = sd.slice(0, 4), m = Number(sd.slice(4, 6)), d = Number(sd.slice(6, 8))
      if (m >= 1 && m <= 12) {
        monthYear = `${MONTHS[m - 1]} ${y}`
        dayMonthYear = `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
      }
    }
    const scanner = [ex.Manufacturer, ex.ManufacturerModelName].filter(Boolean).join(' ')
      .replace(/\s*Healthineers\s*/i, ' ').replace(/\s+/g, ' ').trim()
    const totalImages = manifest.volumes.reduce((s, v) => s + (v.dims?.[2] ?? 0), 0)
    const seriesCount = manifest.volumes.length
    const structureCount = manifest.labels?.classes?.length ?? 0
    // Scan length: first-to-last slice centre on the thin series the 3D model was built from.
    const thin = manifest.volumes.find((v) => v.key === 'thin_lung') ?? manifest.volumes[0]
    const slabMM = thin ? (thin.dims[2] - 1) * thin.spacing[2] : null
    const vertebrae = (manifest.labels?.classes ?? [])
      .map((c) => /^vertebrae_T(\d+)$/.exec(c.name))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
    const vertebraRange = vertebrae.length ? [Math.min(...vertebrae), Math.max(...vertebrae)] as const : null
    return {
      age: Number.isFinite(age) ? age : null,
      monthYear,
      dayMonthYear,
      scanner,
      totalImages,
      seriesCount,
      structureCount,
      slabMM,
      vertebraRange,
    }
  }, [manifest])
}

/** "13.6" for 136.5 mm: truncated, so the label never overstates the scanned length. */
export function slabCm(mm: number): string {
  return (Math.floor(mm) / 10).toFixed(1)
}
