/**
 * The few facts the landing page quotes from the AI second read (read.json). The file is written by an
 * AI pipeline, so everything is parsed defensively: a missing or reshaped field just hides the sentence.
 */
import type { ReadFinding, ReadReport } from '../../lib/reports'

export interface ReadFacts {
  /** Lung speck the AI read found (e.g. mm "3"), with its finding id for #/read?finding=<id>. */
  nodule: { mm: number; text: string; id: string; plain: string } | null
  /** Ascending aorta at its widest per the AI read (e.g. "37–38" mm). */
  aorta: { lo: number; hi: number; text: string; id: string; plain: string; highNormal: boolean } | null
}

/** "3 mm", "37-38 mm", "(about 37–38 mm)" */
const MM = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*mm\b/i

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function allFindings(r: ReadReport): ReadFinding[] {
  const systems = Array.isArray(r.systems) ? r.systems : []
  return systems.flatMap((s) => (s && Array.isArray(s.findings) ? s.findings : [])).filter((f) => f && typeof f === 'object')
}

/** Real (not artifact, not refuted by the skeptic panel) findings only. */
const isLive = (f: ReadFinding) => f.category !== 'artifact' && f.verification?.status !== 'refuted'

export function readFacts(r: ReadReport | null): ReadFacts {
  if (!r) return { nodule: null, aorta: null }
  const live = allFindings(r).filter(isLive)

  let nodule: ReadFacts['nodule'] = null
  const nod = live.find((f) => /nodul/i.test(str(f.title)) && MM.test(str(f.title)))
  if (nod) {
    const m = MM.exec(str(nod.title))!
    const mm = Number(m[2] ?? m[1])
    if (Number.isFinite(mm)) nodule = { mm, text: m[2] ? `${m[1]}–${m[2]}` : m[1], id: str(nod.id), plain: str(nod.plainEnglish) }
  }

  let aorta: ReadFacts['aorta'] = null
  const aor = live.find((f) => /ascending aorta/i.test(str(f.title)) && MM.test(str(f.title)))
  if (aor) {
    const m = MM.exec(str(aor.title))!
    const lo = Number(m[1])
    const hi = Number(m[2] ?? m[1])
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      aorta = {
        lo,
        hi,
        text: m[2] ? `${m[1]}–${m[2]}` : m[1],
        id: str(aor.id),
        plain: str(aor.plainEnglish),
        highNormal: /(high|upper)[- ]normal|upper end of normal/i.test(`${str(aor.title)} ${str(aor.plainEnglish)}`),
      }
    }
  }
  return { nodule, aorta }
}

/** Deep link into the AI Read page for one finding (the page expands and scrolls to it). */
export const readFindingHref = (id: string) => (id ? `#/read?finding=${encodeURIComponent(id)}` : '#/read')
