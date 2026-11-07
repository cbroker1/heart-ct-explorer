/**
 * The AI second read's bottom line, right under the key numbers: verdict, headline and how the read
 * was made, with a link to the full report. Only rendered for the real read.json (never the mock).
 */
import type { ReadReport } from '../../lib/reports'
import { ArrowRight } from './icons'

type Tone = 'good' | 'info' | 'warn' | 'bad'

const VERDICT: Record<string, { tone: Tone; label: string }> = {
  reassuring: { tone: 'good', label: 'Reassuring' },
  'minor-notes': { tone: 'info', label: 'Minor notes' },
  'follow-up-suggested': { tone: 'warn', label: 'Follow-up suggested' },
  urgent: { tone: 'bad', label: 'Prompt attention' },
}

/** The headline is written for the report page ("notes are listed below"); point at the report instead. */
function forLanding(text: string): string {
  return text.replace(/\b(are|is)\s+(listed|shown|detailed|described)\s+below\b/gi, '$1 in the full report')
}

/** "Nothing concerning. The heart…" -> lead "Nothing concerning." + the rest (only when the lead is short). */
function splitLead(text: string): { lead: string | null; rest: string } {
  const m = /^(.{3,64}?[.!])\s+(\S[\s\S]*)$/.exec(text.trim())
  return m ? { lead: m[1], rest: m[2] } : { lead: null, rest: text.trim() }
}

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)

export function ReadTeaser({ read }: { read: ReadReport }) {
  const verdict = VERDICT[read.verdict] ?? { tone: 'info' as Tone, label: String(read.verdict || 'Read') }
  const headline = typeof read.headline === 'string' ? forLanding(read.headline) : ''
  const { lead, rest } = splitLead(headline)
  const p = read.panel
  const facts: [number, string][] = []
  const reviewers = count(p?.reviewers)
  const votes = count(p?.skepticVotes)
  const dismissed = count(p?.dismissed)
  const images = count(p?.imagesRendered)
  if (reviewers) facts.push([reviewers, 'specialist AI reviewers'])
  if (votes) facts.push([votes, 'skeptic votes on the findings'])
  if (dismissed) facts.push([dismissed, dismissed === 1 ? 'finding thrown out' : 'findings thrown out'])
  if (images) facts.push([images, 'images inspected'])

  return (
    <section className={`ovw-read ovw-read-${verdict.tone}`} aria-labelledby="ovw-read-k">
      <div className="ovw-read-glow" aria-hidden="true" />
      <div className="ovw-read-main">
        <div className="ovw-read-top">
          <span id="ovw-read-k" className="ovw-eyebrow">AI second read</span>
          <span className={`chip ${verdict.tone}`}>
            <span className="dot" style={{ background: 'currentColor' }} aria-hidden="true" />
            {verdict.label}
          </span>
        </div>
        {lead && <p className="ovw-read-lead">{lead}</p>}
        {rest && <p className="ovw-read-text">{rest}</p>}
        {facts.length > 0 && (
          <ul className="ovw-read-facts" aria-label="How the AI read was made">
            {facts.map(([n, label]) => (
              <li key={label}><b>{n.toLocaleString('en-US')}</b> {label}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="ovw-read-side">
        <a className="btn ovw-read-cta" href="#/read">
          Read the full report <ArrowRight size={15} />
        </a>
        <span className="ovw-read-note">An AI analysis for curiosity, not a diagnosis. The radiologist's report is what counts.</span>
      </div>
    </section>
  )
}
