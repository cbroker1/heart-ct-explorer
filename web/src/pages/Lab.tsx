// The Lab: a scroll of experiments. Each section is its own lazily-loaded component.
// (Shell owned by the integrator; sections are built in src/pages/lab/*.)
import { lazy, Suspense } from 'react'

const Heartbeat = lazy(() => import('./lab/Heartbeat'))
const ARHeart = lazy(() => import('./lab/ARHeart'))
const PrintShop = lazy(() => import('./lab/PrintShop'))
const BodyNumbers = lazy(() => import('./lab/BodyNumbers'))

function Section(props: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={props.id} style={{ margin: '0 0 64px' }}>
      <div className="eyebrow" style={{ color: 'var(--heart-2)' }}>{props.eyebrow}</div>
      <h2 style={{ fontSize: 28, marginTop: 4 }}>{props.title}</h2>
      <Suspense fallback={<div className="card muted">Loading…</div>}>{props.children}</Suspense>
    </section>
  )
}

export default function Lab() {
  return (
    <div className="page-pad">
      <header style={{ margin: '8px 0 40px' }}>
        <div className="eyebrow">The Lab ✦ experiments with my scan</div>
        <h1>Surprises inside the data</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          Things a hospital viewer would never show you: my real ECG from the scan driving a beating 3D heart,
          a life-size heart you can drop into your room, a 3D-printable copy, and my body by the numbers.
        </p>
      </header>
      <Section id="heartbeat" eyebrow="Experiment 01" title="My heartbeat, synced to my real ECG"><Heartbeat /></Section>
      <Section id="ar" eyebrow="Experiment 02" title="A life-size heart in your room"><ARHeart /></Section>
      <Section id="print" eyebrow="Experiment 03" title="3D-print my heart"><PrintShop /></Section>
      <Section id="numbers" eyebrow="Experiment 04" title="My body, by the numbers"><BodyNumbers /></Section>
    </div>
  )
}
