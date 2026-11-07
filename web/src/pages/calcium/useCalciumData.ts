import { useEffect, useMemo, useState } from 'react'
import { loadJSON, type Manifest, type VolumeMeta } from '../../lib/data'
import { indexToLps } from '../../lib/coords'
import type { CalciumCandidate, CalciumReport } from '../../lib/reports'
import {
  blobsPerSlice, candidateScore, countBy, denseBand, parseSteps, readMethod, sortCandidates, stepSeams,
  type ExamJson, type Method,
} from './model'

export interface CalciumVM {
  manifest: Manifest
  report: CalciumReport
  exam: ExamJson | null
  method: Method
  /** calcium series grid (for slice -> z) */
  vol: VolumeMeta | null
  candidates: CalciumCandidate[] // sorted: most important verdict first
  nBlobs: number
  ruleCounts: Map<string, number>
  finalCounts: Map<string, number>
  reasonCounts: [string, number][]
  pending: CalciumCandidate[] // still finalClass === 'review'
  worstCase: number // score if every pending candidate were coronary
  counted: CalciumCandidate[] // finalClass === 'coronary'
  perSlice: number[]
  band: { from: number; to: number; blobs: number } | null
  nSteps: number | null
  seams: number[]
  maxPeak: number
  sliceZ: (k: number) => number | null
  isMock: string | null
}

type Loaded = { report: CalciumReport; exam: ExamJson | null; mock: string | null }

let cache: { key: string; p: Promise<Loaded> } | null = null

function mockMode(): string | null {
  if (!import.meta.env.DEV) return null
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  return q.get('mock')
}

async function load(calFile: string, examFile: string | undefined): Promise<Loaded> {
  const [report, exam] = await Promise.all([
    loadJSON<CalciumReport>(calFile),
    examFile ? loadJSON<ExamJson>(examFile).catch(() => null) : Promise.resolve(null),
  ])
  if (!report || !Array.isArray(report.candidates)) throw new Error(`${calFile}: unexpected format`)
  let mock: string | null = null
  if (import.meta.env.DEV) {
    mock = mockMode()
    if (mock) {
      const { applyDevMock } = await import('./devMock')
      return { report: applyDevMock(report, mock), exam, mock }
    }
  }
  return { report, exam, mock }
}

export function useCalciumData(manifest: Manifest) {
  const calFile = manifest.files?.calcium
  const [state, setState] = useState<{ data: Loaded | null; error: string | null }>({ data: null, error: null })

  useEffect(() => {
    if (!calFile) {
      setState({ data: null, error: 'This dataset has no calcium analysis (manifest.files.calcium is missing).' })
      return
    }
    let alive = true
    const key = `${calFile}|${mockMode() ?? ''}`
    if (!cache || cache.key !== key) {
      const p = load(calFile, manifest.files?.exam)
      cache = { key, p }
      p.catch(() => { if (cache?.p === p) cache = null })
    }
    cache.p.then(
      (data) => alive && setState({ data, error: null }),
      (e) => alive && setState({ data: null, error: String(e?.message ?? e) }),
    )
    return () => { alive = false }
  }, [calFile, manifest.files?.exam])

  const vm = useMemo<CalciumVM | null>(() => {
    const d = state.data
    if (!d) return null
    const { report, exam } = d
    const method = readMethod(report)
    const vol = manifest.volumes.find((v) => v.key === 'calcium') ?? null
    const candidates = sortCandidates(report.candidates)
    const nBlobs = report.candidates.reduce((s, c) => s + c.blobs.length, 0)
    const reasons = new Map<string, number>()
    for (const c of report.candidates) for (const r of c.ruleReasons) reasons.set(r, (reasons.get(r) ?? 0) + 1)
    const pending = candidates.filter((c) => c.finalClass === 'review')
    const nSlices = vol?.dims[2] ?? Math.max(1, ...report.candidates.flatMap((c) => c.slices.map((s) => s + 1)))
    const perSlice = blobsPerSlice(report.candidates, nSlices)
    const nSteps = parseSteps(exam?.dose?.mode)
    const sliceZ = (k: number) => (vol ? indexToLps(vol, [0, 0, k])[2] : null)
    return {
      manifest,
      report,
      exam,
      method,
      vol,
      candidates,
      nBlobs,
      ruleCounts: countBy(report.candidates, (c) => c.ruleClass),
      finalCounts: countBy(report.candidates, (c) => c.finalClass),
      reasonCounts: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
      pending,
      worstCase: pending.reduce((s, c) => s + candidateScore(c, method), 0),
      counted: candidates.filter((c) => c.finalClass === 'coronary'),
      perSlice,
      band: denseBand(perSlice),
      nSteps,
      seams: nSteps ? stepSeams(nSlices, nSteps) : [],
      maxPeak: Math.max(0, ...report.candidates.map((c) => c.peakHU)),
      sliceZ,
      isMock: d.mock,
    }
  }, [state.data, manifest])

  return { vm, error: state.error }
}
