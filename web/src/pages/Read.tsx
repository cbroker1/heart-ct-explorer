/**
 * AI Second Read (#/read): "do a complete doctor analysis of all the images; if you see anything
 * concerning let me know". A radiology report crossed with a calm health dashboard.
 *
 * Data: public/data/read.json (ReadReport). Deep links: #/read?finding=<id> or #/read?section=<system key>.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LoaderOverlay, navigate } from '../components/ui'
import { useApp } from '../lib/store'
import type { Manifest } from '../lib/data'
import {
  describePanel, fmtInt, formatDicomDate, formatGenerated, loadExamInfo, loadReport, mode, plural, SEV_SHORT, SEVERITIES, SEVERITY_LABEL,
  skepticsPerFinding, sliceRoute, verdictMeta,
  type ExamInfo, type LoadedReport, type NFinding, type NLink, type Severity,
} from './read/model'
import { ReadCtx, useMedia, type ReadCtxValue } from './read/ctx'
import { LightboxProvider } from './read/Lightbox'
import { FindingsMap } from './read/Topogram'
import { SystemSection, type HiddenInfo } from './read/SystemSection'
import { CalciumCard, DismissedCard, GlanceGrid, Impression, MockBanner, VerdictBanner, VerificationFunnel } from './read/Summary'
import { Actions, DEFAULT_FILTERS, Rail, Toolbar, type FilterCounts, type Filters, type TocEntry } from './read/Controls'
import { Prose } from './read/bits'
import { IcArrowUp, IcPrinter } from './read/icons'
import './read/read.css'

// Cached for the session (also avoids double fetches under StrictMode); failures are retried on remount.
let reportPromise: Promise<LoadedReport> | null = null
let examPromise: Promise<ExamInfo | null> | null = null
function getReport(m: Manifest) {
  if (!reportPromise) {
    reportPromise = loadReport(m)
    reportPromise.catch(() => { reportPromise = null })
  }
  return reportPromise
}
function getExam(m: Manifest) {
  if (!examPromise) {
    examPromise = loadExamInfo(m)
    examPromise.then((x) => { if (!x) examPromise = null })   // exam.json failed: try again next time
  }
  return examPromise
}

export default function Read() {
  const manifest = useApp((s) => s.manifest)
  const [data, setData] = useState<LoadedReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exam, setExam] = useState<ExamInfo | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!manifest) return
    let alive = true
    getReport(manifest)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)) })
    getExam(manifest).then((x) => { if (alive) setExam(x) })
    return () => { alive = false }
  }, [manifest, attempt])

  if (error) {
    return (
      <div className="page-pad">
        <div className="card rd-error" role="alert">
          <h3>The AI second read could not be loaded</h3>
          <p className="muted">The report file (<code>read.json</code>) did not load. Check your connection and try again.</p>
          <p className="mono rd-error-detail">{error}</p>
          <button type="button" className="btn" onClick={() => { setError(null); setAttempt((a) => a + 1) }}>Try again</button>
        </div>
      </div>
    )
  }
  if (!manifest || !data) return <LoaderOverlay label="Loading the AI second read…" />
  return <ReportView data={data} exam={exam} manifest={manifest} />
}

// ------------------------------------------------------------------------------------------------

async function waitForImages(root: HTMLElement | null, timeoutMs: number) {
  if (!root) return
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  const pending = [...root.querySelectorAll('img')].filter((i) => !i.complete)
  if (!pending.length) return
  const all = Promise.all(pending.map((i) => new Promise((r) => {
    i.addEventListener('load', r, { once: true })
    i.addEventListener('error', r, { once: true })
  })))
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))])
}

function prettyStudy(s: unknown): string {
  const t = String(s ?? '').trim().toLowerCase().replace(/\bct\b/g, 'CT')
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

function ReportView({ data, exam, manifest }: { data: LoadedReport; exam: ExamInfo | null; manifest: Manifest }) {
  const { report, isMock, file } = data
  const rootRef = useRef<HTMLDivElement>(null)
  const wide = useMedia('(min-width: 1180px)')
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [printing, setPrinting] = useState(false)
  const [active, setActive] = useState('rd-impression')
  const [showTop, setShowTop] = useState(false)

  // ---------------------------------------------------------------- filtering
  const passes = useCallback(
    (f: NFinding) => filters.sev[f.severity] && (filters.artifacts || !f.isArtifact) && (filters.refuted || !f.isRefuted),
    [filters],
  )
  const visibleAll = useMemo(() => report.findings.filter(passes), [report, passes])
  const counts: FilterCounts = useMemo(() => {
    const bySev: Record<Severity, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
    for (const f of report.findings) if ((filters.artifacts || !f.isArtifact) && (filters.refuted || !f.isRefuted)) bySev[f.severity]++
    return {
      bySev,
      artifacts: report.findings.filter((f) => f.isArtifact).length,
      refuted: report.findings.filter((f) => f.isRefuted).length,
      shown: visibleAll.length,
      total: report.findings.length,
    }
  }, [report, filters, visibleAll])
  const hiddenInfo = useCallback((list: NFinding[]): HiddenInfo => {
    const h = { artifacts: 0, refuted: 0, severity: 0 }
    for (const f of list) {
      if (passes(f)) continue
      if (!filters.artifacts && f.isArtifact) h.artifacts++
      else if (!filters.refuted && f.isRefuted) h.refuted++
      else h.severity++
    }
    return h
  }, [passes, filters])
  const showEverything = useCallback(() => setFilters({ sev: { 0: true, 1: true, 2: true, 3: true }, artifacts: true, refuted: true }), [])

  // ---------------------------------------------------------------- expand / navigate
  const toggleFinding = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }, [])
  const allOpen = visibleAll.length > 0 && visibleAll.every((f) => expanded.has(f.id))
  const expandAll = useCallback(() => setExpanded(new Set(visibleAll.map((f) => f.id))), [visibleAll])
  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  const goTo = useCallback((id: string, instant = false) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: reduced || instant ? 'auto' : 'smooth', block: 'start' })
  }, [reduced])

  const pickFinding = useCallback((id: string, instant = false) => {
    const f = report.findings.find((x) => x.id === id)
    if (!f) return
    flushSync(() => {
      setFilters((fl) => ({
        sev: { ...fl.sev, [f.severity]: true },
        artifacts: fl.artifacts || f.isArtifact,
        refuted: fl.refuted || f.isRefuted,
      }))
      setExpanded((s) => new Set(s).add(id))
    })
    const el = document.getElementById(`rd-f-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: reduced || instant ? 'auto' : 'smooth', block: 'start' })
    el.classList.remove('rd-flash')
    void el.offsetWidth
    el.classList.add('rd-flash')
    window.setTimeout(() => el.classList.remove('rd-flash'), 1800)
  }, [report, reduced])

  const openSlice = useCallback((l: NLink, fromFinding?: string) => {
    // Rewrite this history entry first, so Back from the slice viewer lands on the same finding
    // instead of the top of a very long report. (replaceState does not fire hashchange.)
    if (fromFinding) {
      try { window.history.replaceState(window.history.state, '', `#/read?finding=${encodeURIComponent(fromFinding)}`) } catch { /* ignore */ }
    }
    const app = useApp.getState()
    if (l.lps) app.setCursor(l.lps)
    if (l.series && manifest.volumes.some((v) => v.key === l.series)) app.setSliceSeries(l.series)
    navigate(sliceRoute(l, manifest.volumes))
  }, [manifest])

  // Deep links: #/read?finding=<id> | #/read?section=<system key or element id>.
  // Applied on arrival (instant jump: smooth-scrolling a 20k px page is slow) and when the hash changes in place.
  const deepLink = useRef<() => void>(() => {})
  deepLink.current = () => {
    const [path, q] = window.location.hash.replace(/^#/, '').split('?')
    if (path !== '/read' || !q) return
    const qs = new URLSearchParams(q)
    const fid = qs.get('finding')
    const sec = qs.get('section')
    if (fid && report.findings.some((f) => f.id === fid)) pickFinding(fid, true)
    else if (sec) {
      const s = report.systems.find((x) => x.key === sec || x.anchor === sec)
      goTo(s ? s.anchor : sec.startsWith('rd-') ? sec : `rd-${sec}`, true)
    }
  }
  useEffect(() => {
    const t = window.setTimeout(() => deepLink.current(), 80)
    const onHash = () => deepLink.current()
    window.addEventListener('hashchange', onHash)
    return () => { window.clearTimeout(t); window.removeEventListener('hashchange', onHash) }
  }, [])

  // ---------------------------------------------------------------- scroll spy + back-to-top
  const toc: TocEntry[] = useMemo(() => [
    { id: 'rd-impression', label: 'Impression' },
    { id: 'rd-glance', label: 'At a glance' },
    ...report.systems.map((s) => ({
      id: s.anchor,
      label: s.title,
      status: s.status,
      count: s.findings.filter((f) => !f.isArtifact && !f.isRefuted).length,
      group: 'systems' as const,
    })),
    { id: 'rd-about', label: 'How this was made' },
  ], [report])

  useEffect(() => {
    const scroller = rootRef.current?.closest('.page-scroll') as HTMLElement | null
    if (!scroller) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top
        let current = toc[0]?.id ?? ''
        for (const e of toc) {
          const el = document.getElementById(e.id)
          if (el && el.getBoundingClientRect().top - top <= 160) current = e.id
        }
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && toc.length) current = toc[toc.length - 1].id
        setActive(current)
        setShowTop(scroller.scrollTop > 900)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { scroller.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [toc])

  // ---------------------------------------------------------------- print
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('rd-print-scope')
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      html.classList.remove('rd-print-scope')
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  const doPrint = useCallback(async () => {
    flushSync(() => setPrinting(true))
    await waitForImages(rootRef.current, 4000)
    window.print()
  }, [])

  // ---------------------------------------------------------------- derived copy
  const real = report.findings.filter((f) => !f.isArtifact && !f.isRefuted)
  const nSys = report.systems.length
  const pn = report.panel
  const perFinding = skepticsPerFinding(pn, report.findings)
  const checks = report.systems.reduce((a, s) => a + s.checked.length, 0)
  const votes = report.findings.reduce((a, f) => a + f.votes.length, 0)
  const sevMix = SEVERITIES.map((s) => [s, real.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${SEV_SHORT[s].toLowerCase()}`).join(' · ')
  const findingStat = { v: real.length, k: real.length === 1 ? 'finding' : 'findings', cap: real.length ? sevMix : 'nothing flagged' }

  // With the panel block (how the read was produced) the counts are the panel's own; otherwise
  // they are derived from the findings, and only what the data shows is claimed.
  let madeBy: string
  let stats: { v: number; k: string; cap: string }[]
  if (pn) {
    madeBy = describePanel(pn, nSys, perFinding)
    const nRev = pn.reviewers ?? nSys
    const examined = pn.findingsExamined
    stats = [
      { v: nRev, k: nRev === 1 ? 'AI specialist' : 'AI specialists', cap: `${nRev === nSys ? 'one per body system' : `across ${plural(nSys, 'body system')}`} · ${plural(checks, 'item')} checked` },
      pn.imagesRendered
        ? { v: pn.imagesRendered, k: 'images inspected', cap: 'rendered and examined by the specialists' }
        : { v: checks, k: 'items checked', cap: 'specific things looked for, listed per system' },
      findingStat,
      {
        v: pn.skepticVotes ?? votes,
        k: 'skeptic votes',
        cap: examined
          ? `${plural(examined, 'finding')} cross-examined${pn.dismissed !== null ? ` · ${fmtInt(pn.dismissed)} thrown out` : ''}`
          : 'independent attempts to disprove the findings',
      },
    ]
  } else {
    const reviewers = nSys ? plural(nSys, 'AI specialist reviewer') : 'AI specialist reviewers'
    const voted = real.filter((f) => f.votes.length > 0)
    const skeptics = mode(voted.map((f) => f.votes.length)) ?? 3
    const skepticsTxt = `${skeptics} independent AI skeptic${skeptics === 1 ? '' : 's'}`
    madeBy = !report.findings.length
      ? `${reviewers} read every series and flagged nothing, so the AI skeptics had nothing to attack.`
      : !voted.length
        ? `${reviewers} read every series. No skeptic review was recorded for the flagged findings.`
        : `${reviewers} read every series; ${plural(voted.length, 'finding')} ${voted.length === 1 ? 'was' : 'were'} cross-examined by ${skepticsTxt}.`
    stats = [
      { v: nSys, k: nSys === 1 ? 'system reviewed' : 'systems reviewed', cap: 'each read by its own AI specialist' },
      findingStat,
      { v: checks, k: 'items checked', cap: 'specific things looked for, listed per system' },
      { v: votes, k: 'skeptic votes', cap: 'independent attempts to disprove the findings' },
    ]
  }

  const ex = manifest.exam ?? {}
  const age = parseInt(String(ex.PatientAge ?? ''), 10)
  const sex = ex.PatientSex === 'M' ? 'male' : ex.PatientSex === 'F' ? 'female' : ''
  const scanner = [String(ex.Manufacturer ?? '').split(/\s+/)[0], ex.ManufacturerModelName].filter(Boolean).join(' ')
  const metaBits = [
    scanner,
    Number.isFinite(age) ? `${age}-year-old${sex ? ` ${sex}` : ''}` : sex,
    report.generated && !isMock ? `Read generated ${formatGenerated(report.generated)}` : '',
  ].filter(Boolean)
  const eyebrow = ['AI second read', prettyStudy(ex.StudyDescription), formatDicomDate(ex.StudyDate)].filter(Boolean).join(' · ')

  const ctx: ReadCtxValue = useMemo(
    () => ({ printing, volumes: manifest.volumes ?? [], exam, expanded, toggleFinding, openSlice }),
    [printing, manifest, exam, expanded, toggleFinding, openSlice],
  )

  const getSummary = useCallback(() => {
    const vm = report.verdict ? verdictMeta(report.verdict) : null
    const out: string[] = []
    out.push(`AI SECOND READ of my cardiac CT${formatDicomDate(ex.StudyDate) ? ` (${formatDicomDate(ex.StudyDate)})` : ''}`)
    if (isMock) out.push('*** MOCK DATA: placeholder text, the real report is still pending ***')
    out.push(`Verdict: ${vm ? vm.label : 'not stated'}${report.headline ? `. ${report.headline}` : ''}`)
    if (report.impression.length) {
      out.push('', 'Impression:')
      for (const it of report.impression) out.push(`  ${it.n}. ${it.text} [${SEVERITY_LABEL[it.severity]}]`)
    }
    const notable = report.findings.filter((f) => !f.isArtifact && !f.isRefuted && f.severity >= 1)
    if (notable.length) {
      out.push('', 'Findings worth knowing about:')
      for (const f of notable) {
        out.push(`  - ${f.title} (${f.systemTitle}; ${SEVERITY_LABEL[f.severity]})`)
        if (f.plainEnglish) out.push(`    ${f.plainEnglish}`)
        if (f.recommendation) out.push(`    Recommendation: ${f.recommendation}`)
      }
    }
    if (report.calcium && report.calcium.agatston !== null) {
      out.push('', `Coronary calcium (AI estimate): ${report.calcium.agatston} Agatston units.${report.calcium.summary ? ` ${report.calcium.summary}` : ''}`)
    }
    if (report.dismissed.length) {
      out.push('', 'Flagged, then thrown out by the AI skeptic panel (not real findings):')
      for (const d of report.dismissed) out.push(`  - ${d.item} (${d.systemTitle})`)
    }
    if (madeBy) out.push('', `How it was made: ${madeBy.replace(/\.$/, '')}.`)
    out.push('', report.disclaimer || 'Not a medical device. The official radiologist report is what counts.')
    out.push('Written by AI models; it can miss things and can flag things that are not there.')
    return out.join('\n')
  }, [report, isMock, ex, madeBy])

  const controls = { filters, counts, onFilters: setFilters, allOpen, onExpand: expandAll, onCollapse: collapseAll, onPrint: doPrint, getSummary }

  return (
    <ReadCtx.Provider value={ctx}>
      <LightboxProvider>
        <div ref={rootRef} id="rd-top" className={`rd-root page-pad ${printing ? 'printing' : ''} ${isMock ? 'is-mock' : ''}`}>
          <div className="rd-print-only rd-print-brand">Heart CT Explorer · AI second read · not a medical device</div>
          {isMock && <MockBanner file={file} />}

          <header className="rd-mast">
            <div className="grow">
              <div className="eyebrow rd-mast-eyebrow">{eyebrow}</div>
              <h1>Anything concerning?</h1>
              <p className="rd-mast-sub">
                A doctor-style read of every image in your scan: each body system reviewed the way a radiologist would,
                then cross-examined by AI skeptics.
              </p>
              {metaBits.length > 0 && <div className="rd-mast-meta">{metaBits.map((b) => <span key={b}>{b}</span>)}</div>}
            </div>
            <button type="button" className="btn rd-mast-print rd-noprint" onClick={doPrint} title="Print, or choose “Save as PDF” in the print dialog">
              <IcPrinter size={16} /> Print / save as PDF
            </button>
          </header>

          <VerdictBanner report={report} madeBy={madeBy} stats={stats} />

          <div className={`rd-body ${wide ? 'wide' : ''}`}>
            {wide && <Rail toc={toc} active={active} onGo={goTo} isMock={isMock} {...controls} />}

            <div className="rd-main">
              <section id="rd-impression" className="rd-row-imp" aria-label="Impression">
                <Impression items={report.impression} />
                {(report.calcium || report.dismissed.length > 0) && (
                  <div className="rd-imp-side">
                    {report.calcium && <CalciumCard calcium={report.calcium} />}
                    {report.dismissed.length > 0 && <DismissedCard items={report.dismissed} onGo={goTo} />}
                  </div>
                )}
              </section>

              <section id="rd-glance" className="rd-block" aria-labelledby="rd-glance-h">
                <div className="rd-block-head">
                  <div className="eyebrow">At a glance</div>
                  <h2 id="rd-glance-h">{nSys ? `${nSys} body systems, one card each` : 'Body systems'}</h2>
                </div>
                <div className="rd-glance-row">
                  <GlanceGrid systems={report.systems} onGo={goTo} />
                  <FindingsMap exam={exam} findings={visibleAll} onPick={pickFinding} />
                </div>
              </section>

              {!wide && <Toolbar {...controls} />}

              <div className="rd-systems">
                {report.systems.map((s, i) => (
                  <SystemSection
                    key={s.anchor}
                    sys={s}
                    index={i}
                    total={nSys}
                    visible={s.findings.filter(passes)}
                    hidden={hiddenInfo(s.findings)}
                    onShowAll={showEverything}
                  />
                ))}
              </div>

              <section id="rd-about" className="rd-block rd-about" aria-labelledby="rd-about-h">
                <div className="rd-block-head">
                  <div className="eyebrow">About this read</div>
                  <h2 id="rd-about-h">How this report was made</h2>
                </div>
                <div className="rd-about-grid">
                  <div className="card rd-about-card">
                    <h3>Method</h3>
                    {report.method ? <Prose text={report.method} /> : <p className="muted">Not provided.</p>}
                    <div className="rd-label">{pn?.findingsExamined ? 'Skeptic cross-examination' : 'Skeptic review of the flagged findings'}</div>
                    <VerificationFunnel findings={report.findings} panel={pn} />
                    {pn && (pn.agents || pn.toolCalls || pn.calciumAdjudicators || pn.imagesRendered) ? (
                      <>
                        <div className="rd-label">The panel in numbers</div>
                        <div className="rd-series rd-panel-facts">
                          {!!pn.imagesRendered && <span className="rd-series-chip" title="Images rendered and inspected by the specialist reviewers"><b className="mono">{fmtInt(pn.imagesRendered)}</b> images inspected</span>}
                          {!!pn.calciumAdjudicators && <span className="rd-series-chip" title="Independent reviewers who adjudicated the coronary calcium score"><b className="mono">{fmtInt(pn.calciumAdjudicators)}</b> calcium adjudicators</span>}
                          {!!pn.agents && <span className="rd-series-chip" title="AI agents involved in total: the specialists, the skeptics and the calcium adjudicators"><b className="mono">{fmtInt(pn.agents)}</b> AI agents</span>}
                          {!!pn.toolCalls && <span className="rd-series-chip" title="Image renders, measurements and other actions the agents ran"><b className="mono">{fmtInt(pn.toolCalls)}</b> tool calls</span>}
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className="card rd-about-card">
                    <h3>Technique</h3>
                    {report.technique ? <Prose text={report.technique} /> : <p className="muted">Not provided.</p>}
                    {(manifest.volumes?.length ?? 0) > 0 && (
                      <>
                        <div className="rd-label">Image series in this exam</div>
                        <div className="rd-series">
                          {manifest.volumes.map((v) => <span key={v.key} className="rd-series-chip" title={v.blurb}>{v.label}</span>)}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="card rd-about-card">
                    <h3>Coverage</h3>
                    {report.coverage ? <Prose text={report.coverage} /> : <p className="muted">Not provided.</p>}
                  </div>
                  <div className="card rd-about-card">
                    <h3>Limitations</h3>
                    {report.limitations.length ? (
                      <ul className="rd-limits">{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                    ) : <p className="muted">None listed.</p>}
                  </div>
                </div>
                <p className="disclaimer rd-final-disc">
                  {report.disclaimer || 'Not a medical device. The official radiologist report is what counts.'}{' '}
                  This read was written by AI models and can be wrong in both directions: it may miss things, and it may flag things that are not there.
                </p>
                <div className="rd-foot">
                  <span>Source: <code>{file}</code></span>
                  {report.generated && <span>Generated: {isMock ? 'mock placeholder' : formatGenerated(report.generated)}</span>}
                  <span className="rd-noprint"><Actions {...controls} compact /></span>
                </div>
              </section>
            </div>
          </div>

          {showTop && !wide && (
            <button type="button" className="rd-totop rd-noprint" onClick={() => goTo('rd-top')} aria-label="Back to top">
              <IcArrowUp size={20} />
            </button>
          )}
        </div>
      </LightboxProvider>
    </ReadCtx.Provider>
  )
}
