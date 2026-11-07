/**
 * Pure helpers for the AI adjudication data in calcium.json: reviewer names, vote statistics,
 * the soft-tissue "203 HU" cross-check (adjudication.s8Blob) and the calcifications the reviewers
 * found outside the candidate list (adjudication.missedLesions).
 * Everything is read defensively: fields the shared CalciumReport type doesn't declare yet are
 * validated here before use.
 */
import type { Manifest, Vec3 } from '../../lib/data'
import type { CalciumCandidate, CalciumReport, CalciumVote } from '../../lib/reports'

// ------------------------------------------------------------------ text clean-up
/** Drop references to working files ("Files: a.png, b.png.", absolute paths, "(x.png)") from reviewer prose. */
export function cleanNote(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/\s*\b(?:Files?|Figures?|Images?)\s*:\s*(?:[^\s,;]+\.(?:png|jpe?g|gif|svg|webp)[,;]?\s*(?:and\s+)?)+\.?/gi, ' ')
    .replace(/\s*\([^()]*\.(?:png|jpe?g|gif|svg|webp)\)/gi, '')
    .replace(/\s*\(?\/(?:home|Users|tmp|mnt|data)\/\S+\)?/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim()
}

/** First sentence (or the whole string if it is short). */
export function firstSentence(s: string, max = 220): string {
  const t = s.trim()
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/)
  const out = m ? m[0] : t
  return out.length > max ? `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : out
}

// ------------------------------------------------------------------ reviewers
export interface ReviewerInfo {
  key: string
  index: number
  /** short display name, e.g. "Blind sweeper" */
  name: string
  /** the lens string from the data */
  lens: string
  /** one line on how this reviewer worked (falls back to the lens) */
  approach: string
  estimate: number | null
  confZero: number | null
  summary: string
}

/** Plain-English names for the reviewer lenses this pipeline uses; unknown keys fall back to their own lens text. */
const KNOWN: Record<string, { name: string; approach: string }> = {
  cal_candidates: {
    name: 'Candidate adjudicator',
    approach: 'Judged every candidate one by one: zoomed views of neighbouring slices in three window settings, plus side-on reformats.',
  },
  cal_blind: {
    name: 'Blind sweeper',
    approach: 'Swept all the calcium slices without seeing the candidate list first, artery territory by artery territory.',
  },
  cal_cross: {
    name: 'Physics checker',
    approach: 'Compared the other reconstructions of the same scan and tested every blob against a calibrated noise model.',
  },
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function readReviewers(r: CalciumReport): ReviewerInfo[] {
  const list = Array.isArray(r.adjudication?.reviewers) ? r.adjudication!.reviewers : []
  return list.map((x, i) => {
    const key = str(x?.key) || `reviewer_${i + 1}`
    const lens = str(x?.lens)
    const known = KNOWN[key] ?? KNOWN[key.replace(/^calcium_/, '')]
    return {
      key,
      index: i,
      name: known?.name ?? (cap(lens) || `Reviewer ${i + 1}`),
      lens,
      approach: known?.approach ?? (lens ? `${cap(lens)}.` : ''),
      estimate: num(x?.agatstonEstimate),
      confZero: conf01(x?.confidenceZero),
      summary: cleanNote(str(x?.summary)),
    }
  })
}

/** Which reviewer cast a vote: the longest reviewer key contained in the vote's reviewer string. */
export function matchReviewer(voteReviewer: string | undefined, reviewers: ReviewerInfo[]): ReviewerInfo | null {
  const s = (voteReviewer ?? '').toLowerCase()
  if (!s) return null
  let best: ReviewerInfo | null = null
  for (const r of reviewers) {
    const k = r.key.toLowerCase()
    if (k && s.includes(k) && (!best || k.length > best.key.length)) best = r
  }
  return best
}

/** Short name for a vote's reviewer, even when it can't be matched to a known reviewer. */
export function voterName(v: CalciumVote, i: number, reviewers: ReviewerInfo[]): string {
  const r = matchReviewer(v.reviewer, reviewers)
  if (r) return r.name
  const raw = (v.reviewer ?? '').split(/[(:]/)[0].trim()
  if (!raw) return `Reviewer ${i + 1}`
  return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw
}

// ------------------------------------------------------------------ votes
export function conf01(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(1, Math.max(0, v > 1 ? v / 100 : v))
}

export const isNoise = (v: string | undefined) => !!v && /^(noise|artifact|artefact)/i.test(v.trim())

const VOTE_LABEL: Record<string, string> = {
  'noise-artifact': 'noise / artifact', noise: 'noise', artifact: 'artifact', coronary: 'coronary', aortic: 'aortic',
  valvular: 'valve', bone: 'bone', other: 'other',
}
export const voteLabel = (v: string | undefined) => VOTE_LABEL[(v ?? '').toLowerCase()] ?? (v ?? '?').replace(/[-_]/g, ' ')
export const voteColor = (v: string | undefined) =>
  isNoise(v) ? '#8a97a8' : (v ?? '').toLowerCase() === 'coronary' ? '#ff4d5e' : (v ?? '').toLowerCase() === 'review' ? '#ffb547' : '#a08bff'

export interface VoteSummary {
  n: number
  /** the most common verdict and how many votes it got */
  top: string
  topN: number
  unanimous: boolean
  confMin: number | null
  confMax: number | null
}

export function summarizeVotes(c: CalciumCandidate): VoteSummary | null {
  const vs = c.reviewVotes ?? []
  if (!vs.length) return null
  const counts = new Map<string, number>()
  for (const v of vs) {
    const k = isNoise(v.verdict) ? 'noise-artifact' : (v.verdict ?? '?').toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const [top, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const confs = vs.map((v) => conf01(v.confidence)).filter((x): x is number => x !== null)
  return {
    n: vs.length,
    top,
    topN,
    unanimous: counts.size === 1 && vs.length > 1,
    confMin: confs.length ? Math.min(...confs) : null,
    confMax: confs.length ? Math.max(...confs) : null,
  }
}

export interface VoteStats {
  reviewers: number
  votes: number
  noiseVotes: number
  coronaryVotes: number
  candidatesVoted: number
  unanimousCandidates: number
  /** every candidate received a vote from every reviewer and they all agreed */
  unanimousAll: boolean
}

export function voteStats(cands: CalciumCandidate[], reviewers: ReviewerInfo[]): VoteStats | null {
  const voted = cands.filter((c) => c.reviewVotes?.length)
  if (!voted.length) return null
  let votes = 0, noiseVotes = 0, coronaryVotes = 0, unanimous = 0
  for (const c of voted) {
    const vs = c.reviewVotes!
    votes += vs.length
    noiseVotes += vs.filter((v) => isNoise(v.verdict)).length
    coronaryVotes += vs.filter((v) => (v.verdict ?? '').toLowerCase() === 'coronary').length
    if (summarizeVotes(c)?.unanimous) unanimous++
  }
  const nRev = reviewers.length || Math.max(...voted.map((c) => c.reviewVotes!.length))
  return {
    reviewers: nRev,
    votes,
    noiseVotes,
    coronaryVotes,
    candidatesVoted: voted.length,
    unanimousCandidates: unanimous,
    unanimousAll: voted.length === cands.length && unanimous === cands.length && voted.every((c) => c.reviewVotes!.length >= nRev),
  }
}

// ------------------------------------------------------------------ normalisation
/**
 * The pipeline writes finalClass "noise" for every dismissed candidate. To tell the story honestly we
 * separate the two routes to "noise": candidates the triage rules dismissed (the reviewers agreed) and
 * the borderline ones that passed every rule and were dismissed by the AI reviewers ("noise-artifact").
 */
export function normalizeReport(r: CalciumReport): CalciumReport {
  if (!r.reviewed) return r
  let changed = false
  const candidates = r.candidates.map((c) => {
    const fc = (c.finalClass ?? '').toLowerCase()
    let next = fc
    if (c.ruleClass === 'review' && (fc === 'noise' || fc === 'noise-artifact')) next = 'noise-artifact'
    else if (c.ruleClass === 'noise' && fc === 'noise-artifact') next = 'noise'
    if (next === c.finalClass) return c
    changed = true
    return { ...c, finalClass: next }
  })
  return changed ? { ...r, candidates } : r
}

// ------------------------------------------------------------------ the 203 HU cross-check
export interface CrossEntry { verdict: string; note: string; lps: Vec3 | null; peakHU: number | null }
export interface CrossCheck {
  peakHU: number
  lps: Vec3 | null
  /** the calcium candidate the reviewers traced it to */
  candId: number | null
  entries: CrossEntry[]
}

const vec3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : null

type AdjExtra = { s8Blob?: unknown; missedLesions?: unknown }

export function readCrossCheck(r: CalciumReport): CrossCheck | null {
  const raw = (r.adjudication as AdjExtra | undefined)?.s8Blob
  const list = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []) as Record<string, unknown>[]
  const entries: CrossEntry[] = list
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ verdict: cleanNote(str(e.verdict)), note: cleanNote(str(e.note)), lps: vec3(e.lps), peakHU: num(e.peakHU) }))
    .filter((e) => e.verdict || e.note)
  if (!entries.length) return null
  const peaks = entries.map((e) => e.peakHU).filter((x): x is number => x !== null)
  if (!peaks.length) return null
  // most-cited candidate id ("same structure as calcium candidate #22")
  const ids = new Map<number, number>()
  for (const e of entries) {
    for (const m of `${e.verdict} ${e.note}`.matchAll(/(?:candidate|calcium)\s*#\s*(\d+)/gi)) ids.set(+m[1], (ids.get(+m[1]) ?? 0) + 1)
  }
  const ids2 = [...ids.entries()].sort((a, b) => b[1] - a[1])
  const candId = ids2.length && r.candidates.some((c) => c.id === ids2[0][0]) ? ids2[0][0] : null
  return { peakHU: Math.max(...peaks), lps: entries.find((e) => e.lps)?.lps ?? null, candId, entries }
}

// ------------------------------------------------------------------ calcifications outside the candidate list
export interface OutsideFinding {
  title: string
  detail: string
  verdict: string
  severity: number | null
  coronary: boolean
  peakHU: number | null
  areaMM2: number | null
  lps: Vec3 | null
  seriesKey: string | null
  slice: number | null
  evidence: string[]
}

/** "Small calcification in X, just right of Y (anterior...)" -> title "Small calcification in X", detail = the rest. */
function splitTitle(desc: string): { title: string; detail: string } {
  const d = desc.trim()
  const cut = d.search(/\s*\(|,\s|\.\s/)
  let title = cut > 12 ? d.slice(0, cut) : d
  if (title.length > 96) title = `${title.slice(0, 95).replace(/\s+\S*$/, '')}…`
  let rest = cut > 12 ? d.slice(cut).replace(/^[\s,.;:]+/, '') : ''
  // "(anterior chest wall), not covered by..." -> "Anterior chest wall, not covered by..."
  const paren = rest.match(/^\(([^()]*)\)([\s\S]*)$/)
  if (paren) rest = `${paren[1]}${paren[2]}`.trim()
  return { title, detail: rest ? cap(rest) : '' }
}

/** "normal-variant (costal cartilage calcification, very common, severity 0)" -> "Normal variant (costal cartilage calcification, very common)" */
export function cleanVerdict(v: string): string {
  let s = v.replace(/normal-variant/gi, 'normal variant')
  s = s.replace(/[,;]?\s*severity\s*\d+(?:\s*[-–]\s*\d+)?/gi, '')
  s = s.replace(/\(\s*[,;]\s*/g, '(').replace(/\s*[,;]\s*\)/g, ')').replace(/\(\s*\)/g, '')
  const base = s
  s = s.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (base.replace(m, '').toLowerCase().includes(inner.trim().toLowerCase()) ? '' : m))
  s = s.trim().replace(/[,;:]$/, '')
  return cap(s)
}

export function readOutside(r: CalciumReport, m: Manifest): OutsideFinding[] {
  const raw = (r.adjudication as AdjExtra | undefined)?.missedLesions
  if (!Array.isArray(raw)) return []
  const keys = new Set(m.volumes.map((v) => v.key))
  return (raw as Record<string, unknown>[])
    .filter((e) => e && typeof e === 'object' && (str(e.description) || str(e.verdict)))
    .map((e) => {
      const desc = cleanNote(str(e.description))
      const { title, detail } = splitTitle(desc || cleanVerdict(str(e.verdict)))
      const verdictRaw = str(e.verdict)
      const sev = verdictRaw.match(/severity\s*(\d)/i)
      const series = str(e.series).trim().match(/^[a-z_]+/i)?.[0] ?? ''
      const evidence = (Array.isArray(e.evidence) ? e.evidence : [])
        .filter((x): x is string => typeof x === 'string')
        .filter((x) => !/^\s*images?\s*:/i.test(x) && !/^\s*\//.test(x) && !/\.(png|jpe?g)\s*$/i.test(x.trim()))
        .map((x) => cleanNote(x))
        .filter((x) => x.length > 0)
      const artery = str(e.artery).trim()
      return {
        title,
        detail,
        verdict: cleanVerdict(verdictRaw),
        severity: sev ? Number(sev[1]) : null,
        coronary: !!artery || (/\bcoronary\b/i.test(verdictRaw) && !/not\s+coronary/i.test(verdictRaw)),
        peakHU: num(e.peakHU),
        areaMM2: num(e.areaMM2),
        lps: vec3(e.lps),
        seriesKey: keys.has(series) ? series : keys.has('calcium') ? 'calcium' : null,
        slice: num(e.sliceIndex),
        evidence,
      }
    })
}
