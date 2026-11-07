// Landing page (#/): hero with a beating 3D heart, key numbers, scan coverage, links to every page,
// and how the project was made. Components live in ./overview/.
import { useApp } from '../lib/store'
import { HeartIcon } from '../components/ui'
import { Hero } from './overview/Hero'
import { useReducedMotion } from './overview/hooks'
import { ScanCoverage } from './overview/ScanCoverage'
import { SectionCards } from './overview/SectionCards'
import { StatsStrip } from './overview/StatsStrip'
import { REPO_URL, Timeline } from './overview/Timeline'
import { useOverviewData } from './overview/useOverviewData'
import './overview/overview.css'

export default function Overview() {
  const manifest = useApp((s) => s.manifest)
  if (!manifest) return null
  return <OverviewPage manifest={manifest} />
}

function OverviewPage({ manifest }: { manifest: NonNullable<ReturnType<typeof useApp.getState>['manifest']> }) {
  const { exam, calcium, read, examError } = useOverviewData(manifest)
  const reduced = useReducedMotion()
  return (
    <div className="ovw">
      <Hero manifest={manifest} exam={exam} reducedMotion={reduced} />
      <div className="ovw-wrap">
        <StatsStrip manifest={manifest} exam={exam} calcium={calcium} calciumListed={!!manifest.files?.calcium} reduced={reduced} />
        {examError && <p className="ovw-error">Some exam details could not be loaded ({examError}).</p>}
        <ScanCoverage manifest={manifest} exam={exam} />
        <SectionCards manifest={manifest} calcium={calcium} read={read} />
        <Timeline manifest={manifest} />
        <footer className="ovw-footer">
          <div className="disclaimer ovw-disclaimer">
            <b>Not a medical device.</b> For curiosity and education; the official radiologist report is what counts.
          </div>
          <div className="ovw-footer-row">
            <span className="ovw-footer-brand"><HeartIcon size={16} /> Heart CT Explorer</span>
            <span className="muted">One real, de-identified cardiac CT, explored in the browser.</span>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
          </div>
        </footer>
      </div>
    </div>
  )
}
