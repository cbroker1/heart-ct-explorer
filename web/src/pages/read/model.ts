/**
 * AI Second Read: data model for the report page.
 *
 * `read.json` is produced by an AI pipeline, so this module treats it as untrusted input:
 * `normalizeReport` turns anything JSON-shaped into a fully populated `NReport` (every array
 * present, numbers finite or null, severities clamped), so the UI never has to guard fields.
 */
import { dataUrl, loadJSON, type Manifest, type Vec3, type VolumeMeta } from '../../lib/data'
import { SEVERITY_LABEL, type ReadReport, type Severity } from '../../lib/reports'

export { SEVERITY_LABEL }
export type { Severity }

// ------------------------------------------------------------------ tones & labels
export type Tone = 'green' | 'cyan' | 'amber' | 'red' | 'violet' | 'neutral'
export type VerdictKey = ReadReport['verdict']
export type Plane = 'axial' | 'coronal' | 'sagittal'

export const SEVERITIES: Severity[] = [0, 1, 2, 3]
export const SEV_TONE: Record<Severity, Tone> = { 0: 'green', 1: 'cyan', 2: 'amber', 3: 'red' }
export const SEV_SHORT: Record<Severity, string> = { 0: 'Nothing to do', 1: 'Good to know', 2: 'Mention to your doctor', 3: 'Prompt attention' }

export interface VerdictMeta { key: VerdictKey; label: string; short: string; tone: Tone; blurb: string }
export const VERDICTS: VerdictMeta[] = [
  { key: 'reassuring', label: 'Reassuring', short: 'Reassuring', tone: 'green', blurb: 'Nothing that needs action' },
  { key: 'minor-notes', label: 'Minor notes', short: 'Minor notes', tone: 'cyan', blurb: 'Small things, good to know' },
  { key: 'follow-up-suggested', label: 'Follow-up suggested', short: 'Follow-up', tone: 'amber', blurb: 'Worth mentioning to your doctor' },
  { key: 'urgent', label: 'Urgent', short: 'Urgent', tone: 'red', blurb: 'Needs prompt medical attention' },
]
export const verdictMeta = (v: VerdictKey) => VERDICTS.find((x) => x.key === v) ?? VERDICTS[1]

export const STATUS_META: Record<string, { label: string; tone: Tone; blurb: string }> = {
  normal: { label: 'Normal', tone: 'green', blurb: 'Nothing of note in this system' },
  minor: { label: 'Minor notes', tone: 'cyan', blurb: 'Small, good-to-know observations' },
  attention: { label: 'Attention', tone: 'amber', blurb: 'Something here is worth discussing with a doctor' },
}
export const statusMeta = (s: string) => STATUS_META[s] ?? { label: titleCase(s || 'unknown'), tone: 'neutral' as Tone, blurb: '' }

export const CATEGORY_META: Record<string, { label: string; blurb: string }> = {
  'normal-variant': { label: 'Normal variant', blurb: 'A harmless difference in how bodies are built.' },
  'benign-incidental': { label: 'Benign incidental', blurb: 'Found by chance and considered benign (harmless).' },
  indeterminate: { label: 'Indeterminate', blurb: 'Cannot be fully characterised on this type of scan.' },
  'potentially-significant': { label: 'Potentially significant', blurb: 'Could matter for your health; worth discussing with a doctor.' },
  artifact: { label: 'Imaging artifact', blurb: 'A quirk of how the images were made, not something in your body.' },
}
export const categoryMeta = (c: string) => CATEGORY_META[c] ?? { label: titleCase(c || 'uncategorised'), blurb: '' }

export const VERIF_META: Record<string, { label: string; tone: Tone; blurb: string }> = {
  confirmed: { label: 'Confirmed', tone: 'violet', blurb: 'Independent skeptics tried to knock this finding down, and it held up.' },
  downgraded: { label: 'Downgraded', tone: 'cyan', blurb: 'After skeptic review, this finding was judged less significant than first reported.' },
  refuted: { label: 'Refuted', tone: 'neutral', blurb: 'The skeptics showed it is not real or not relevant. Kept here for transparency only.' },
  unverified: { label: 'Not verified', tone: 'neutral', blurb: 'No skeptic review was recorded for this finding.' },
}
export const verifMeta = (s: string) => VERIF_META[s] ?? { label: titleCase(s || 'unknown'), tone: 'neutral' as Tone, blurb: '' }

/** The skeptics each attack a finding from one angle ("lens"). */
export const LENS_META: Record<string, { label: string; question: string }> = {
  artifact: { label: 'Artifact hunter', question: 'Could this be noise, motion or an imaging artifact?' },
  criteria: { label: 'Criteria checker', question: 'Does it really meet the textbook definition and size?' },
  relevance: { label: 'Relevance judge', question: 'Does it actually matter for this person?' },
  anatomy: { label: 'Anatomy checker', question: 'Is it really where, and what, it is said to be?' },
  measurement: { label: 'Measurement checker', question: 'Do the numbers hold up when re-measured?' },
  normal: { label: 'Normal-variant advocate', question: 'Could this just be a normal variant?' },
}
export const lensMeta = (lens: string) => LENS_META[lens.toLowerCase()] ?? { label: titleCase(lens || 'Skeptic'), question: '' }

/** Window presets the slice explorer understands (see WEB_SPEC). */
export const WINDOW_PRESETS = ['soft', 'mediastinum', 'lung', 'bone', 'calcium', 'liver', 'fat']

// ------------------------------------------------------------------ normalized types
export interface NImage { src: string; url: string; caption: string }
export interface NVote { lens: string; refuted: boolean; note: string }
export interface NLink { series: string | null; lps: Vec3 | null; plane: Plane; window: string | null }
export interface NFinding {
  id: string
  /** 1-based number across the whole report (used on the findings map). */
  n: number
  systemKey: string
  systemTitle: string
  title: string
  description: string
  plainEnglish: string
  location: string
  category: string
  severity: Severity
  confidence: number | null
  recommendation: string
  measurements: string
  status: string
  votes: NVote[]
  images: NImage[]
  link: NLink | null
  isArtifact: boolean
  isRefuted: boolean
}
export interface NChecked { item: string; result: string; kind: 'ok' | 'na' | 'note' }
export interface NMeasurement { name: string; value: string; reference: string; method: string }
/** Something a specialist flagged that the skeptic panel then threw out (from `checked`). */
export interface NDismissed { item: string; result: string; systemKey: string; systemTitle: string; anchor: string }
/** How the read was produced (read.json `panel`); every count may be missing. */
export interface NPanel {
  reviewers: number | null
  findingsExamined: number | null
  skepticVotes: number | null
  dismissed: number | null
  merged: number | null
  calciumAdjudicators: number | null
  imagesRendered: number | null
  agents: number | null
  toolCalls: number | null
}
export interface NSystem {
  key: string
  anchor: string
  title: string
  status: string
  summary: string
  checked: NChecked[]
  dismissed: NDismissed[]
  measurements: NMeasurement[]
  findings: NFinding[]
  images: NImage[]
}
export interface NReport {
  generated: string
  mock: boolean
  panel: NPanel | null
  headline: string
  /** null when the report has no recognisable verdict (never guessed). */
  verdict: VerdictKey | null
  impression: { n: number; text: string; severity: Severity }[]
  technique: string
  coverage: string
  systems: NSystem[]
  calcium: { agatston: number | null; summary: string; confidenceZero: number | null } | null
  limitations: string[]
  method: string
  disclaimer: string
  /** All findings, flattened in report order. */
  findings: NFinding[]
  /** Everything the skeptic panel threw out, flattened in report order. */
  dismissed: NDismissed[]
}

// ------------------------------------------------------------------ coercion helpers
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const obj = (v: unknown): Obj => (isObj(v) ? v : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return fallback
}
/** Free text that the pipeline might have emitted as a list or a key/value object. */
function text(v: unknown): string {
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('; ')
  if (isObj(v)) return Object.entries(v).map(([k, x]) => `${k}: ${text(x)}`).join('; ')
  return str(v)
}
function sev(v: unknown): Severity {
  const n = num(v)
  if (n === null) return 1
  return Math.max(0, Math.min(3, Math.round(n))) as Severity
}
/** Confidence as 0..1. Accepts 0..1 or a percentage. */
function conf(v: unknown): number | null {
  let n = num(v)
  if (n === null) return null
  if (n > 1 && n <= 100) n /= 100
  return Math.max(0, Math.min(1, n))
}
function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return /^(true|yes|refuted|1)$/i.test(v.trim())
  return v === 1
}
export function titleCase(s: string): string {
  const t = s.replace(/[-_]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

/** Image paths are relative to data/ (e.g. "read/heart_01.png"). */
export function imageUrl(src: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  return dataUrl(src.replace(/^\.?\/+/, '').replace(/^data\//, ''))
}
function image(v: unknown, fallbackCaption: string): NImage | null {
  const src = typeof v === 'string' ? v.trim() : str(obj(v).src ?? obj(v).file ?? obj(v).path)
  if (!src) return null
  const caption = typeof v === 'string' ? fallbackCaption : str(obj(v).caption, fallbackCaption)
  return { src, url: imageUrl(src), caption }
}

/** Short lowercase words that are real words, not acronyms, at the start of a caption. */
const CAPTION_WORDS = new Set(['the', 'and', 'for', 'top', 'low', 'mid', 'all', 'two', 'one', 'new', 'old', 'raw', 'end', 'see', 'via', 'per', 'map', 'row', 'set', 'sum', 'max', 'min', 'fat', 'air', 'rib', 'arm', 'leg', 'hip', 'key', 'fig'])
const CAPTION_INDEX_RE = /^(?:atlas\s+)?\d{1,3}\s+(?=\S)/i
/**
 * The reviewers' file-name-style captions ("40 KEY mediastinum labeled levels", "atlas 01 coverage ...")
 * made readable: a numeric index shared by the whole gallery and KEY/FIG/FINDING markers are dropped,
 * a leading acronym ("lll", "gej") is upper-cased and the first letter capitalised. Wording is kept.
 */
function tidyCaptions(images: NImage[]): NImage[] {
  const indexed = images.length > 1 && images.every((im) => CAPTION_INDEX_RE.test(im.caption))
  return images.map((im) => {
    let t = im.caption.replace(/\s+/g, ' ').trim()
    if (indexed) t = t.replace(CAPTION_INDEX_RE, '')
    t = t.replace(/^(?:KEY|FIG|FINDING)(?:\s+|\s*[:_-]\s*)(?=\S)/, '')
    const lead = /^[a-z]{2,3}\d*(?=\s|$)/.exec(t)
    if (lead && !CAPTION_WORDS.has(lead[0])) t = lead[0].toUpperCase() + t.slice(lead[0].length)
    return { ...im, caption: t ? t[0].toUpperCase() + t.slice(1) : t }
  })
}

const PANEL_KEYS = ['reviewers', 'findingsExamined', 'skepticVotes', 'dismissed', 'merged', 'calciumAdjudicators', 'imagesRendered', 'agents', 'toolCalls'] as const
function panel(v: unknown): NPanel | null {
  if (!isObj(v)) return null
  const out = {} as NPanel
  let any = false
  for (const k of PANEL_KEYS) {
    const n = num(v[k])
    out[k] = n !== null && n >= 0 ? Math.round(n) : null
    if (out[k] !== null) any = true
  }
  return any ? out : null
}

/** `checked` items that record something the skeptic panel threw out. */
const DISMISSED_RE = /^\s*(?:considered and\s+)?(?:dismissed|rejected|refuted|thrown out)\s+by\s+(?:the\s+)?skeptics?(?:\s+panel)?\s*[:–—-]\s*/i

function lps(v: unknown): Vec3 | null {
  const a = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null
  if (!a || a.length !== 3) return null
  const p = a.map(num)
  return p.every((x) => x !== null) ? (p as Vec3) : null
}
function link(v: unknown): NLink | null {
  if (!isObj(v)) return null
  const p = lps(v.lps)
  const series = str(v.series) || null
  if (!p && !series) return null
  const planeRaw = str(v.plane).toLowerCase()
  const plane: Plane = planeRaw === 'coronal' || planeRaw === 'sagittal' ? planeRaw : 'axial'
  const w = str(v.window).toLowerCase()
  return { series, lps: p, plane, window: WINDOW_PRESETS.includes(w) ? w : null }
}

const OK_RE = /^(normal|unremarkable|negative|none|absent|no\b|not (seen|present|identified|detected|found))/i
const HEDGE_RE = /\b(but|however|except|although|mild|mildly|borderline|small|minimal|trace|possible|possibly|probable|suspicious|equivocal)\b|;/i
const NA_RE = /(not assess|not evaluable|non-?diagnostic|outside|not (included|covered|visible|visualized|imaged|in (the )?(scan|field))|cannot be|can't be|n\/a|limited)/i
export function checkedKind(result: string): NChecked['kind'] {
  if (NA_RE.test(result)) return 'na'
  if (OK_RE.test(result) && !HEDGE_RE.test(result)) return 'ok'
  return 'note'
}

export const VERDICT_KEYS = VERDICTS.map((v) => v.key)
const VERDICT_ALIASES: Record<string, VerdictKey> = {
  reassuring: 'reassuring', normal: 'reassuring',
  'minor-notes': 'minor-notes', minor: 'minor-notes', 'minor notes': 'minor-notes',
  'follow-up-suggested': 'follow-up-suggested', 'follow-up': 'follow-up-suggested', followup: 'follow-up-suggested', 'follow up suggested': 'follow-up-suggested',
  urgent: 'urgent',
}

// ------------------------------------------------------------------ normalize
export function normalizeReport(raw: unknown): NReport {
  const r = obj(raw)
  const usedIds = new Set<string>()
  const usedAnchors = new Set<string>()
  const all: NFinding[] = []

  const systems: NSystem[] = arr(r.systems).filter(isObj).map((s, si) => {
    const key = str(s.key) || `system-${si + 1}`
    const title = str(s.title) || titleCase(key)
    let anchor = `rd-sys-${slug(key)}`
    while (usedAnchors.has(anchor)) anchor += '-x'
    usedAnchors.add(anchor)

    const findings: NFinding[] = arr(s.findings).filter(isObj).map((f, fi) => {
      let id = str(f.id) || `${key}-${fi + 1}`
      while (usedIds.has(id)) id += '-x'
      usedIds.add(id)
      const ver = obj(f.verification)
      const votes: NVote[] = arr(ver.votes).filter(isObj).map((v) => ({
        lens: str(v.lens, 'skeptic'),
        refuted: bool(v.refuted),
        note: text(v.note),
      }))
      const status = str(ver.status).toLowerCase() || 'unverified'
      const category = str(f.category).toLowerCase()
      const ftitle = str(f.title) || 'Untitled finding'
      const images = arr(f.images).map((im) => image(im, '')).filter((x): x is NImage => !!x)
      const nf: NFinding = {
        id,
        n: 0,
        systemKey: key,
        systemTitle: title,
        title: ftitle,
        description: text(f.description),
        plainEnglish: text(f.plainEnglish),
        location: text(f.location),
        category,
        severity: sev(f.severity),
        confidence: conf(f.confidence),
        // A bare "None." adds nothing to the severity ("Nothing to do"), so no recommendation box is shown.
        recommendation: /^(?:none|n\/a|-+)\.?$/i.test(text(f.recommendation)) ? '' : text(f.recommendation),
        measurements: text(f.measurements),
        status,
        votes,
        images,
        link: link(f.link),
        isArtifact: category === 'artifact',
        isRefuted: status === 'refuted',
      }
      all.push(nf)
      return nf
    })

    const checked: NChecked[] = []
    const dismissed: NDismissed[] = []
    for (const c of arr(s.checked)) {
      const o = obj(c)
      const item = typeof c === 'string' ? c.trim() : text(o.item)
      const result = typeof c === 'string' ? '' : text(o.result)
      const d = DISMISSED_RE.exec(item)
      if (d && item.slice(d[0].length).trim()) {
        dismissed.push({ item: item.slice(d[0].length).trim(), result, systemKey: key, systemTitle: title, anchor })
        continue
      }
      if (typeof c === 'string') { if (item) checked.push({ item, result: '', kind: 'note' }); continue }
      checked.push({ item: item || '(unnamed check)', result, kind: checkedKind(result) })
    }

    // "-" / "n/a" placeholders carry no information, so they are treated as empty.
    const blank = (t: string) => (/^(?:-+|–|—|n\/?a|none)$/i.test(t) ? '' : t)
    const measurements: NMeasurement[] = arr(s.measurements).filter(isObj).map((m) => ({
      name: text(m.name) || '(unnamed)',
      value: text(m.value),
      reference: blank(text(m.reference)),
      method: blank(text(m.method)),
    }))

    const images = tidyCaptions(arr(s.images).map((im) => image(im, '')).filter((x): x is NImage => !!x))

    return { key, anchor, title, status: str(s.status).toLowerCase() || 'normal', summary: text(s.summary), checked, dismissed, measurements, findings, images }
  })
  all.forEach((f, i) => { f.n = i + 1 })

  const impression = arr(r.impression)
    .map((it, i) => {
      if (typeof it === 'string') return { n: i + 1, text: it, severity: 0 as Severity }
      const o = obj(it)
      return { n: num(o.n) ?? i + 1, text: text(o.text), severity: sev(o.severity ?? 0) }
    })
    .filter((it) => it.text)

  // Unknown or missing verdict: show "no verdict" rather than guessing one.
  const verdict = VERDICT_ALIASES[str(r.verdict).toLowerCase().replace(/_/g, '-')] ?? null

  const cal = isObj(r.calcium) ? r.calcium : null
  const generated = str(r.generated)

  return {
    generated,
    mock: r.mock === true || generated.toUpperCase() === 'MOCK',
    panel: panel(r.panel),
    headline: text(r.headline),
    verdict,
    impression,
    technique: text(r.technique),
    coverage: text(r.coverage),
    systems,
    calcium: cal ? { agatston: num(cal.agatston), summary: text(cal.summary), confidenceZero: conf(cal.confidenceZero) } : null,
    limitations: arr(r.limitations).map(text).filter(Boolean),
    method: text(r.method),
    disclaimer: text(r.disclaimer),
    findings: all,
    dismissed: systems.flatMap((s) => s.dismissed),
  }
}

// ------------------------------------------------------------------ loading
export interface LoadedReport { report: NReport; file: string; isMock: boolean }

const looksLikeReport = (v: unknown) => isObj(v) && (Array.isArray(v.systems) || typeof v.headline === 'string')

/** read.json (the manifest's `files.read` first, then the default name). */
export async function loadReport(manifest: Manifest): Promise<LoadedReport> {
  const listed = manifest.files?.read
  const tries = [...new Set([listed, 'read.json'].filter((x): x is string => !!x))]
  let lastError: unknown = null
  for (const file of tries) {
    try {
      const raw = await loadJSON(file)
      if (looksLikeReport(raw)) {
        const report = normalizeReport(raw)
        return { report, file, isMock: report.mock }
      }
      lastError = new Error(`${file} does not look like an AI read report.`)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError ?? new Error('No AI read file is listed.')
}

// ------------------------------------------------------------------ exam.json (topograms)
export interface Topogram {
  png: string
  crop: [number, number, number, number]
  pixelSpacing: [number, number]
  orientation: number[]
  position: Vec3
  shape: [number, number]
  scanRangeRows?: [number, number]
}
export interface ExamInfo {
  topograms: { key: 'ap' | 'lateral'; label: string; topo: Topogram }[]
  dose?: { dlpTotal_mGycm?: number; ctdivol_mGy?: number }
}

function validTopo(v: unknown): Topogram | null {
  const t = obj(v)
  const okNums = (a: unknown, n: number) => Array.isArray(a) && a.length >= n && a.slice(0, n).every((x) => num(x) !== null)
  if (typeof t.png !== 'string' || !okNums(t.crop, 4) || !okNums(t.pixelSpacing, 2) || !okNums(t.orientation, 6) || !okNums(t.position, 3) || !okNums(t.shape, 2)) return null
  return t as unknown as Topogram
}

export async function loadExamInfo(manifest: Manifest): Promise<ExamInfo | null> {
  try {
    const ex = obj(await loadJSON(manifest.files?.exam || 'exam.json'))
    const topos = obj(ex.topograms)
    const list: ExamInfo['topograms'] = []
    const ap = validTopo(topos.ap)
    const lat = validTopo(topos.lateral)
    if (ap) list.push({ key: 'ap', label: 'Front view', topo: ap })
    if (lat) list.push({ key: 'lateral', label: 'Side view', topo: lat })
    return { topograms: list, dose: obj(ex.dose) as ExamInfo['dose'] }
  } catch {
    return null
  }
}

/** LPS mm -> pixel (x = column, y = row) in the cropped topogram PNG. */
export function lpsToTopo(t: Topogram, p: Vec3): { x: number; y: number } {
  const d = [p[0] - t.position[0], p[1] - t.position[1], p[2] - t.position[2]]
  const rowDir = t.orientation.slice(0, 3)
  const colDir = t.orientation.slice(3, 6)
  const col = (d[0] * rowDir[0] + d[1] * rowDir[1] + d[2] * rowDir[2]) / t.pixelSpacing[1]
  const row = (d[0] * colDir[0] + d[1] * colDir[1] + d[2] * colDir[2]) / t.pixelSpacing[0]
  return { x: col - t.crop[2], y: row - t.crop[0] }
}

// ------------------------------------------------------------------ slice-viewer deep links
export function sliceRoute(l: NLink, volumes: VolumeMeta[]): string {
  const q: string[] = []
  if (l.series && volumes.some((v) => v.key === l.series)) q.push(`series=${encodeURIComponent(l.series)}`)
  if (l.lps) q.push(`lps=${l.lps.map((v) => +v.toFixed(2)).join(',')}`)
  q.push(`plane=${l.plane}`)
  if (l.window) q.push(`window=${l.window}`)
  return `/slices?${q.join('&')}`
}

export function seriesLabel(key: string | null, volumes: VolumeMeta[]): string | null {
  if (!key) return null
  return volumes.find((v) => v.key === key)?.label ?? null
}

// ------------------------------------------------------------------ misc formatting
export function formatGenerated(g: string): string {
  if (!g) return ''
  const d = new Date(g)
  if (Number.isNaN(d.getTime()) || !/\d{4}-\d{2}-\d{2}/.test(g)) return g
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** "20261105" -> "5 Nov 2026" */
export function formatDicomDate(s: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s ?? ''))
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
/** Thousands separators, matching the English copy ("1,037"). */
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')
export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`

/** Skeptics per examined finding: exact from the panel totals, else the most common vote count. */
export function skepticsPerFinding(p: NPanel | null, findings: NFinding[]): number | null {
  if (p?.skepticVotes && p.findingsExamined && p.skepticVotes % p.findingsExamined === 0) return p.skepticVotes / p.findingsExamined
  return mode(findings.filter((f) => f.votes.length > 0).map((f) => f.votes.length))
}

/** "8 AI specialists · 1,037 images inspected · 7 findings cross-examined by 3 skeptics each (21 votes) · 2 thrown out" */
export function describePanel(p: NPanel, systems: number, perFinding: number | null): string {
  const parts: string[] = []
  const reviewers = p.reviewers ?? systems
  if (reviewers) parts.push(plural(reviewers, 'AI specialist'))
  if (p.imagesRendered) parts.push(`${fmtInt(p.imagesRendered)} images inspected`)
  if (p.findingsExamined === 0) parts.push('nothing needed cross-examining')
  else if (p.findingsExamined) {
    const by = perFinding ? ` by ${plural(perFinding, 'skeptic')}${p.findingsExamined > 1 ? ' each' : ''}` : ' by AI skeptics'
    const votes = p.skepticVotes ? ` (${plural(p.skepticVotes, 'vote')})` : ''
    parts.push(`${plural(p.findingsExamined, 'finding')} cross-examined${by}${votes}`)
    if (p.dismissed !== null) parts.push(`${fmtInt(p.dismissed)} thrown out`)
  }
  return parts.join(' · ')
}

/** The most common value (ties go to the larger value). */
export function mode(xs: number[]): number | null {
  if (!xs.length) return null
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
}
