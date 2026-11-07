// The Lab: a scroll of experiments. Each section is its own lazily-loaded component.
// (Shell owned by the integrator; sections are built in src/pages/lab/*.)
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Boundary } from './lab/core/Boundary'
import './lab/lab.css'

const Heartbeat = lazy(() => import('./lab/Heartbeat'))
const ARHeart = lazy(() => import('./lab/ARHeart'))
const PrintShop = lazy(() => import('./lab/PrintShop'))
const BodyNumbers = lazy(() => import('./lab/BodyNumbers'))

const SECTIONS = [
  { id: 'heartbeat', n: '01', title: 'My heartbeat, synced to my real ECG', nav: 'Heartbeat', teaser: 'My real ECG from the scan, driving a beating 3D heart.' },
  { id: 'ar', n: '02', title: 'A life-size heart in your room', nav: 'Heart in your room', teaser: 'Turn it here, or stand it on your desk in AR.' },
  { id: 'print', n: '03', title: '3D-print my heart', nav: '3D print', teaser: 'A watertight, life-size print file, with tips.' },
  { id: 'numbers', n: '04', title: 'My body, by the numbers', nav: 'By the numbers', teaser: 'Fat, liver, bones, lungs and dose, from the same scan.' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const waiting = <div className="card muted lab-wait"><div className="spinner" /> Loading…</div>

function Section(props: { id: SectionId; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.id === props.id)!
  return (
    <section id={s.id} className="lab-sec" aria-labelledby={`lab-h-${s.id}`}>
      <div className="eyebrow" style={{ color: 'var(--heart-2)' }}>Experiment {s.n}</div>
      <h2 id={`lab-h-${s.id}`} style={{ fontSize: 28, marginTop: 4 }}>{s.title}</h2>
      <Boundary
        fallback={(e) => (
          <div className="card lab-fail">
            <b>This experiment couldn't load.</b>
            <span className="muted">The rest of the Lab still works. {e.message ? `(${e.message})` : ''}</span>
            <button className="btn small" onClick={() => window.location.reload()}>Reload the page</button>
          </div>
        )}
      >
        <Suspense fallback={waiting}>{props.children}</Suspense>
      </Boundary>
    </section>
  )
}

export default function Lab() {
  // Experiments 02-04 mount once the heartbeat has its data. Until then the heartbeat is a short
  // placeholder, so everything below it would count as "in view" and the AR viewer and the 9 MB
  // print file would start downloading at once, competing with the heartbeat's own 3D model (and a
  // deep link such as #/lab?ar=1 would scroll before the page has its final layout).
  const [rest, setRest] = useState(false)
  const showRest = useCallback(() => setRest(true), [])
  useEffect(() => {
    const t = window.setTimeout(showRest, 8000)      // never hold them back for long
    return () => window.clearTimeout(t)
  }, [showRest])

  const go = (id: SectionId) =>
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })

  return (
    <div className="page-pad">
      <header style={{ margin: '8px 0 32px' }}>
        <div className="eyebrow">The Lab ✦ experiments with my scan</div>
        <h1>Surprises inside the data</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          Things a hospital viewer would never show you: my real ECG from the scan driving a beating 3D heart,
          a life-size heart you can drop into your room, a 3D-printable copy, and my body by the numbers.
        </p>
        <nav className="lab-nav" aria-label="Experiments on this page">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => go(s.id)}>
              <span className="n">{s.n}</span>
              <span className="t">{s.nav}</span>
              <span className="d">{s.teaser}</span>
            </button>
          ))}
        </nav>
      </header>
      <Section id="heartbeat"><Heartbeat onSettled={showRest} /></Section>
      <Section id="ar">{rest ? <ARHeart /> : waiting}</Section>
      <Section id="print">{rest ? <PrintShop /> : waiting}</Section>
      <Section id="numbers">{rest ? <BodyNumbers /> : waiting}</Section>
    </div>
  )
}
