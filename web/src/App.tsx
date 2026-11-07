import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { loadManifest } from './lib/data'
import { useApp } from './lib/store'
import { ErrorBox, HeartIcon, LoaderOverlay, useHashRoute } from './components/ui'

// Each page is code-split so the landing page stays light.
const Overview = lazy(() => import('./pages/Overview'))
const Slices = lazy(() => import('./pages/Slices'))
const Anatomy = lazy(() => import('./pages/Anatomy'))
const Volume = lazy(() => import('./pages/Volume'))
const Calcium = lazy(() => import('./pages/Calcium'))
const Read = lazy(() => import('./pages/Read'))
const Lab = lazy(() => import('./pages/Lab'))

export interface Route { path: string; label: string; title: string; component: ComponentType; fullBleed?: boolean }

export const ROUTES: Route[] = [
  { path: '/', label: 'Overview', title: 'Overview', component: Overview },
  { path: '/slices', label: 'Slices', title: 'Slice Explorer', component: Slices, fullBleed: true },
  { path: '/anatomy', label: '3D Anatomy', title: '3D Anatomy', component: Anatomy, fullBleed: true },
  { path: '/volume', label: 'Volume', title: 'Volume Rendering', component: Volume, fullBleed: true },
  { path: '/calcium', label: 'Calcium Score', title: 'DIY Calcium Score', component: Calcium },
  { path: '/read', label: 'AI Read', title: 'AI Second Read', component: Read },
  { path: '/lab', label: 'Lab ✦', title: 'The Lab', component: Lab },
]

export default function App() {
  const { path } = useHashRoute()
  const manifest = useApp((s) => s.manifest)
  const manifestError = useApp((s) => s.manifestError)
  const setManifest = useApp((s) => s.setManifest)
  const setManifestError = useApp((s) => s.setManifestError)

  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setManifestError(String(e?.message ?? e)))
  }, [setManifest, setManifestError])

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0]
  useEffect(() => { document.title = `${route.title} · Heart CT Explorer` }, [route])
  const Page = route.component

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" style={{ color: 'var(--text)', textDecoration: 'none' }}>
          <HeartIcon className="beat" />
          <span>HEART<span style={{ color: 'var(--heart)' }}>//</span>CT <small>explorer</small></span>
        </a>
        <nav className="nav">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#${r.path}`} className={r.path === route.path ? 'active' : ''}>{r.label}</a>
          ))}
        </nav>
      </header>
      <main className="main">
        {manifestError ? (
          <ErrorBox error={`Could not load data/manifest.json — ${manifestError}`} />
        ) : !manifest ? (
          <LoaderOverlay label="Loading exam…" />
        ) : (
          <Suspense fallback={<LoaderOverlay label="Loading view…" />}>
            {route.fullBleed ? <Page /> : <div className="page-scroll"><Page /></div>}
          </Suspense>
        )}
      </main>
    </div>
  )
}
