/**
 * DEV-ONLY fixtures for exercising the "adjudicated" code paths before the real AI panel has run.
 * Loaded through a dynamic import guarded by `import.meta.env.DEV`, so it never ships in a build.
 *   #/calcium?mock=reviewed  -> reviewed=true, panel says zero
 *   #/calcium?mock=positive  -> reviewed=true, the biggest borderline candidate called coronary
 * Every mock string is tagged "[DEV MOCK]" so it can't be mistaken for real output.
 */
import type { CalciumReport } from '../../lib/reports'
import { candidateScore, densityWeight, readMethod } from './model'

export function applyDevMock(src: CalciumReport, mode: string): CalciumReport {
  const r: CalciumReport = JSON.parse(JSON.stringify(src))
  const m = readMethod(r)
  const review = r.candidates.filter((c) => c.ruleClass === 'review')
  const biggest = review.slice().sort((a, b) => candidateScore(b, m) - candidateScore(a, m))[0]
  for (const c of review) {
    const positive = mode === 'positive' && c === biggest
    c.finalClass = positive ? 'coronary' : 'noise-artifact'
    c.artery = positive ? 'RCA' : null
    c.reviewNote = `[DEV MOCK] ${positive ? 'Linear bright focus along the right AV groove.' : 'Speckle on a brighter band; no tubular structure on adjacent slices.'}`
    c.reviewVotes = ['blind', 'candidates', 'cross'].map((rv, i) => ({
      reviewer: rv,
      verdict: positive && i < 2 ? 'coronary' : 'noise-artifact',
      artery: positive && i < 2 ? 'RCA' : undefined,
      confidence: [0.82, 0.7, 0.9][i],
      note: `[DEV MOCK] reviewer ${rv} note for #${c.id}.`,
    }))
  }
  r.reviewed = true
  const cor = r.candidates.filter((c) => c.finalClass === 'coronary')
  const sc = cor.reduce((s, c) => s + candidateScore(c, m), 0)
  const part = (parity: number) =>
    cor.reduce((s, c) => s + c.blobs.filter((b) => b.z % 2 === parity).reduce((t, b) => t + b.area * densityWeight(b.peak, m.bands), 0), 0)
  const even = part(0)
  const odd = part(1)
  const vol = cor.reduce((s, c) => s + c.volume_mm3, 0)
  const mass = cor.reduce((s, c) => s + (c.meanHU * c.volume_mm3 * (m.massCal ?? 0.743)) / 1000, 0)
  r.totals = { agatston: +sc.toFixed(1), agatstonEven: +even.toFixed(1), agatstonOdd: +odd.toFixed(1), volume_mm3: +vol.toFixed(1), mass_mg: +mass.toFixed(1) }
  r.perArtery = cor.length ? { RCA: { agatston: +sc.toFixed(1), volume_mm3: +vol.toFixed(1), mass_mg: +mass.toFixed(1), lesions: cor.length } } : {}
  r.adjudication = {
    reviewers: [
      { key: 'blind', lens: '[DEV MOCK] Blind whole-heart read', agatstonEstimate: mode === 'positive' ? 10 : 0, confidenceZero: mode === 'positive' ? 0.3 : 0.9, summary: '[DEV MOCK] Looked at every slice without the candidate list first.' },
      { key: 'candidates', lens: '[DEV MOCK] Candidate-by-candidate review', agatstonEstimate: mode === 'positive' ? 11 : 0, confidenceZero: mode === 'positive' ? 0.25 : 0.85, summary: '[DEV MOCK] Checked each borderline candidate on neighbouring slices.' },
      { key: 'cross', lens: '[DEV MOCK] Cross-reconstruction check', agatstonEstimate: 0, confidenceZero: 0.8, summary: '[DEV MOCK] Compared against the independent soft-tissue reconstruction.' },
    ],
    consensus: mode === 'positive' ? '[DEV MOCK] Two of three reviewers call one small RCA focus real.' : '[DEV MOCK] All three reviewers agree: no coronary calcium.',
    openItems: ['[DEV MOCK] Example open item: compare with the official report.'],
  }
  return r
}
