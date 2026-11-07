// DIY calcium score page (#/calcium): explain Agatston scoring AND show every step on this scan.
// Components live in ./calcium/*; all patient numbers come from data/calcium.json (+ exam.json).
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/store'
import { ErrorBox, LoaderOverlay } from '../components/ui'
import './calcium/calcium.css'
import { useCalciumData, type CalciumVM } from './calcium/useCalciumData'
import { useNearViewport, usePrefersReducedMotion, useStoredNumber } from './calcium/hooks'
import Hero from './calcium/Hero'
import Explainer from './calcium/Explainer'
import Pipeline from './calcium/Pipeline'
import ThresholdExplorer from './calcium/ThresholdExplorer'
import Gallery from './calcium/Gallery'
import CandidateModal from './calcium/CandidateModal'
import Compare from './calcium/Compare'
import Method from './calcium/Method'
import ReviewPanel from './calcium/Panel'

const Mini3D = lazy(() => import('./calcium/Mini3D'))

const SECTIONS = [
  { id: 'cal-result', label: 'Result' },
  { id: 'cal-what', label: 'What is it?' },
  { id: 'cal-how', label: 'How I got there' },
  { id: 'cal-panel', label: 'AI review' },
  { id: 'cal-threshold', label: 'Threshold' },
  { id: 'cal-candidates', label: 'Candidates' },
  { id: 'cal-compare', label: 'Compare' },
  { id: 'cal-method', label: 'Method' },
]
const STORE_KEY = 'heart-ct-explorer.calcium.officialAgatston'

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e: unknown) { console.warn('[calcium] 3D view failed:', e) }
  render() { return this.state.err ? this.props.fallback : this.props.children }
}

function Section(props: { id: string; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={props.id} className="cal-section" aria-labelledby={`${props.id}-h`}>
      <div className="cal-sec-head">
        <div className="eyebrow">{props.eyebrow}</div>
        <h2 id={`${props.id}-h`}>{props.title}</h2>
        {props.intro && <p className="cal-intro">{props.intro}</p>}
      </div>
      {props.children}
    </section>
  )
}

function SectionNav() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const reduced = usePrefersReducedMotion()
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    // keep the active chip visible in the horizontally scrolling bar (phones)
    const nav = navRef.current
    const btn = nav?.querySelector<HTMLButtonElement>('button.on')
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return
    const left = btn.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2
    nav.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' })
  }, [active, reduced])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActive(vis[0].target.id)
    }, { rootMargin: '-30% 0px -60% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }
  return (
    <nav className="cal-nav" aria-label="Sections on this page" ref={navRef}>
      {SECTIONS.map((s) => (
        <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => go(s.id)} aria-current={active === s.id ? 'true' : undefined}>
          {s.label}
        </button>
      ))}
    </nav>
  )
}

function readCandParam(): number | null {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const n = Number(q.get('cand'))
  return Number.isInteger(n) && n > 0 ? n : null
}
function writeCandParam(id: number | null) {
  const [path, qs] = window.location.hash.replace(/^#/, '').split('?')
  if (path !== '/calcium') return
  const q = new URLSearchParams(qs ?? '')
  if (id === null) q.delete('cand')
  else q.set('cand', String(id))
  const s = q.toString()
  try { window.history.replaceState(window.history.state, '', `#${path}${s ? `?${s}` : ''}`) } catch { /* ignore */ }
}

function Body({ vm }: { vm: CalciumVM }) {
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(() => {
    const id = readCandParam()
    return id !== null && vm.candidates.some((c) => c.id === id) ? id : null
  })
  const [official, setOfficial] = useStoredNumber(STORE_KEY)
  const setSelectedLesion = useApp((s) => s.setSelectedLesion)
  const [near3d, setNear3d] = useState(false)
  const [ref3d, near] = useNearViewport<HTMLDivElement>('500px')
  useEffect(() => { if (near) setNear3d(true) }, [near])
  // Deep link (#/calcium?cand=N, or Back from the slice viewer): park the page at the gallery behind the sheet,
  // so closing it lands next to the candidate rather than at the top of the page.
  useEffect(() => {
    if (openId === null) return
    const id = requestAnimationFrame(() => document.getElementById('cal-candidates')?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = useCallback((id: number) => { setOpenId(id); setSelectedLesion(id); writeCandParam(id) }, [setSelectedLesion])
  const close = useCallback(() => { setOpenId(null); writeCandParam(null) }, [])
  const { report } = vm
  const reviewed = report.reviewed
  const nRev = vm.reviewers.length
  const panelTitle = !reviewed || !nRev
    ? 'The AI review panel'
    : vm.votes?.unanimousAll && vm.reviewers.every((r) => r.estimate === 0)
      ? `${nRev} independent reviewers, one verdict: zero`
      : `What the ${nRev} independent AI reviewers decided`

  return (
    <div className="page-pad cal-page">
      {import.meta.env.DEV && vm.isMock && <div className="cal-mock">DEV MOCK DATA ({vm.isMock}): adjudication fields are fabricated for UI testing only.</div>}
      <header className="cal-header">
        <div className="eyebrow cal-kicker">DIY calcium score · just for fun (sorry, radiologists)</div>
        <h1>Any calcium in my coronary arteries?</h1>
        <p className="cal-lede">
          The hospital scored this scan for coronary calcium. For fun, I redid it myself from the raw pixels with the same 1990 recipe,
          then {reviewed ? 'had independent AI reviewers adjudicate the borderline spots' : 'queued the borderline spots for independent AI reviewers'}.
          Here's the answer, and every step of how I got there.
        </p>
      </header>
      <SectionNav />

      <Section id="cal-result" eyebrow="01 · The result" title="My DIY Agatston score">
        <Hero vm={vm} official={official} />
      </Section>

      <Section id="cal-what" eyebrow="02 · What is a calcium score?" title="Calcified plaque in the heart's own arteries"
        intro="An idea from 1990 that is still one of the strongest predictors of future heart attacks in people without symptoms.">
        <Explainer vm={vm} />
      </Section>

      <Section id="cal-how" eyebrow="03 · How I got there" title={`From ${vm.nBlobs} bright blobs to ${vm.counted.length} lesion${vm.counted.length === 1 ? '' : 's'}`}
        intro="Every step of the funnel, with the actual counts from this scan.">
        <Pipeline vm={vm} />
      </Section>

      <Section id="cal-panel" eyebrow="04 · Second opinions" title={panelTitle}
        intro={reviewed && nRev
          ? `Each AI reviewer worked separately, with its own method, then voted on every candidate. Here is what each concluded, the one bright speck that needed a second look, and what they found outside the heart.`
          : undefined}>
        <ReviewPanel vm={vm} onOpen={open} />
      </Section>

      <Section id="cal-threshold" eyebrow="05 · Play with the threshold" title="Why 130 HU, and why a threshold isn't enough"
        intro={`I re-ran the blob search at ${report.thresholdSweep?.length ?? 0} different thresholds. Drag across the chart to see how much "calcium" pure noise can fake.`}>
        <ThresholdExplorer vm={vm} />
      </Section>

      <Section id="cal-candidates" eyebrow="06 · Every candidate" title={`All ${report.candidates.length} suspects, one by one`}
        intro="Each dot in the 3D heart is one candidate, coloured by verdict. Hover a card to find it; click for the full review sheet and a jump into the slice viewer.">
        <div className="cal-cands-layout">
          <div className="cal-3d-col" ref={ref3d}>
            <div className="cal-3d-sticky">
              {near3d ? (
                <Boundary fallback={<div className="cal-3d cal-3d-fallback"><p><b>The 3D view couldn't load.</b> The candidate list still works.</p></div>}>
                  <Suspense fallback={<div className="cal-3d cal-3d-fallback"><div className="spinner" /></div>}>
                    <Mini3D vm={vm} hoverId={hoverId} onHover={setHoverId} onOpen={open} />
                  </Suspense>
                </Boundary>
              ) : (
                <div className="cal-3d cal-3d-fallback"><div className="spinner" /></div>
              )}
            </div>
          </div>
          <div className="cal-gal-col">
            <Gallery vm={vm} hoverId={hoverId} onHover={setHoverId} onOpen={open} />
          </div>
        </div>
      </Section>

      <Section id="cal-compare" eyebrow="07 · Reality check" title="Compare with your official report">
        <Compare vm={vm} official={official} setOfficial={setOfficial} />
      </Section>

      <Section id="cal-method" eyebrow="08 · Method & limitations" title="How seriously to take this">
        <Method vm={vm} />
      </Section>

      {openId !== null && <CandidateModal vm={vm} id={openId} onClose={close} onNav={open} />}
    </div>
  )
}

export default function Calcium() {
  const manifest = useApp((s) => s.manifest)
  if (!manifest) return <LoaderOverlay label="Loading exam…" />
  return <CalciumInner manifest={manifest} />
}

function CalciumInner({ manifest }: { manifest: NonNullable<ReturnType<typeof useApp.getState>['manifest']> }) {
  const { vm, error } = useCalciumData(manifest)
  if (error) return <ErrorBox error={`Could not load the calcium analysis: ${error}`} />
  if (!vm) return <LoaderOverlay label="Loading calcium analysis…" />
  return <Body vm={vm} />
}
