/** "What was scanned": the two scout images (topograms) with the imaged slab glowing on top. */
import { dataUrl, type Manifest } from '../../lib/data'
import { useInView } from './hooks'
import { ArrowRight } from './icons'
import type { ExamJson, TopogramMeta } from './types'
import { slabCm, useManifestFacts } from './useOverviewData'

function Topogram(props: { meta: TopogramMeta; view: 'ap' | 'lateral'; label: string; inView: boolean; frameAspect: number }) {
  const { meta, view, label, inView, frameAspect } = props
  const [rows, cols] = meta.shape
  const range = meta.scanRangeRows
  // scanRangeRows use the pixel-centre convention; +0.5 converts to image-edge coordinates.
  const top = range ? ((range[0] + 0.5) / rows) * 100 : null
  const bottom = range ? ((range[1] + 0.5) / rows) * 100 : null
  const mm = range ? (range[1] - range[0]) * meta.pixelSpacing[0] : null
  const sides = view === 'ap' ? ['R', 'L'] : ['A', 'P']
  const sideTitles = view === 'ap' ? ["patient's right", "patient's left"] : ['front (anterior)', 'back (posterior)']
  return (
    <figure className={`ovw-topo${inView ? ' is-in' : ''}`}>
      {/* Both scouts share one frame shape so the captions line up; each image keeps its own aspect inside. */}
      <div className="ovw-topo-frame" style={{ aspectRatio: String(frameAspect) }}>
       <div className="ovw-topo-img" style={{ aspectRatio: `${cols} / ${rows}` }}>
        <img src={dataUrl(meta.png)} alt={`${label}: a low-dose scout X-ray of my chest`} loading="lazy" decoding="async" width={cols} height={rows} />
        {top !== null && bottom !== null && (
          <>
            <div className="ovw-topo-dim" style={{ top: 0, height: `${top}%` }} />
            <div className="ovw-topo-dim" style={{ top: `${bottom}%`, bottom: 0 }} />
            <div className="ovw-topo-band" style={{ top: `${top}%`, height: `${bottom - top}%` }}>
              <span className="ovw-topo-sweep" />
              <span className="ovw-topo-dimline" aria-hidden="true" />
              <span className="ovw-topo-tag">
                this {mm !== null ? slabCm(mm) : '–'}&nbsp;cm slab
              </span>
            </div>
          </>
        )}
        <span className="ovw-topo-side l" title={sideTitles[0]}>{sides[0]}</span>
        <span className="ovw-topo-side r" title={sideTitles[1]}>{sides[1]}</span>
       </div>
      </div>
      <figcaption>
        <span>
          <b>{label}</b>
          <span className="muted"> · {view === 'ap' ? 'as if facing me' : 'seen from my left side'}</span>
        </span>
        <a className="ovw-topo-link" href={view === 'ap' ? '#/slices?series=cor_st&plane=coronal' : '#/slices?series=sag_st&plane=sagittal'}>
          {view === 'ap' ? 'Coronal slices' : 'Sagittal slices'} <ArrowRight size={13} />
        </a>
      </figcaption>
    </figure>
  )
}

export function ScanCoverage(props: { manifest: Manifest; exam: ExamJson | null }) {
  const { manifest, exam } = props
  const facts = useManifestFacts(manifest)
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, threshold: 0.2 })
  const ap = exam?.topograms?.ap
  const lat = exam?.topograms?.lateral
  const slab = facts.slabMM !== null ? slabCm(facts.slabMM) : null
  const steps = exam?.dose?.mode ? /(\d+)\s*steps/.exec(exam.dose.mode)?.[1] : null
  const calciumVol = manifest.volumes.find((v) => v.key === 'calcium')
  const aspects = [ap, lat].filter((t): t is TopogramMeta => !!t).map((t) => t.shape[1] / t.shape[0])
  const frameAspect = aspects.length ? Math.min(...aspects) : 512 / 224
  return (
    <section className="ovw-section" aria-labelledby="ovw-scanned">
      <div className="ovw-scan card" ref={ref}>
        <div className="ovw-scan-head">
          <div className="ovw-eyebrow">Coverage</div>
          <h2 id="ovw-scanned" className="ovw-h2">What was scanned</h2>
        </div>
        <div className="ovw-scan-text">
          <p>
            Before the CT itself, the scanner takes two quick, very low-dose <b>scout images</b> (topograms): one from
            the front, one from the side. The technologist uses them to set exactly where to scan.
          </p>
          <p>
            Only the glowing band was imaged in 3D: a <b>{slab ?? '–'}&nbsp;cm slab</b> around my heart
            {facts.vertebraRange ? <>, roughly from the T{facts.vertebraRange[0]} to the T{facts.vertebraRange[1]} vertebra</> : null}.
            It holds the whole heart plus parts of the lungs, spine, ribs, liver and stomach. Everything else on this site
            comes from inside that band.
          </p>
        </div>
        <div className="ovw-scan-figs">
          {ap ? <Topogram meta={ap} view="ap" label="Front view" inView={inView} frameAspect={frameAspect} /> : <div className="ovw-topo-skel" />}
          {lat ? <Topogram meta={lat} view="lateral" label="Side view" inView={inView} frameAspect={frameAspect} /> : <div className="ovw-topo-skel" />}
        </div>
        <ul className="ovw-scan-facts">
          {steps && <li><b>{steps}</b> table steps, X-rays timed to my heartbeat</li>}
          {calciumVol && (
            <li>
              <b>{calciumVol.dims[2]}</b> heart slices, {calciumVol.sliceThickness}&nbsp;mm thick, for the calcium score
            </li>
          )}
          <li><b>{facts.totalImages.toLocaleString('en-US')}</b> images in total, across {facts.seriesCount} series</li>
        </ul>
      </div>
    </section>
  )
}
