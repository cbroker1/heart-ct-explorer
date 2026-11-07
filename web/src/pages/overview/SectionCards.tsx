/** Cards linking to every page, each with a small illustration and a live fact from the data. */
import type { ReactNode } from 'react'
import type { Manifest } from '../../lib/data'
import type { CalciumReport, ReadReport } from '../../lib/reports'
import { useInView } from './hooks'
import { ArrowRight, ArtAnatomy, ArtCalcium, ArtLab, ArtRead, ArtSlices, ArtVolume } from './icons'
import { useManifestFacts } from './useOverviewData'

interface CardDef {
  href: string
  title: string
  blurb: string
  art: ReactNode
  tone: 'cyan' | 'heart' | 'violet' | 'amber' | 'green' | 'lab'
  fact?: ReactNode
}

const VERDICT: Record<ReadReport['verdict'], { cls: string; label: string }> = {
  reassuring: { cls: 'good', label: 'Reassuring' },
  'minor-notes': { cls: 'info', label: 'Minor notes' },
  'follow-up-suggested': { cls: 'warn', label: 'Follow-up suggested' },
  urgent: { cls: 'bad', label: 'Prompt attention' },
}

export function SectionCards(props: { manifest: Manifest; calcium: CalciumReport | null; read: ReadReport | null }) {
  const { manifest, calcium, read } = props
  const facts = useManifestFacts(manifest)
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })
  const r = manifest.render?.dims
  const cards: CardDef[] = [
    {
      href: '#/slices',
      title: 'Slices',
      blurb: 'Scroll through every image like a radiologist: axial, coronal and sagittal, with window presets.',
      art: <ArtSlices />,
      tone: 'cyan',
      fact: <>{facts.totalImages.toLocaleString('en-US')} images · {facts.seriesCount} series</>,
    },
    {
      href: '#/anatomy',
      title: 'Anatomy 3D',
      blurb: 'The AI-segmented anatomy as a 3D model you can spin, peel apart and explore.',
      art: <ArtAnatomy />,
      tone: 'heart',
      fact: <>{facts.structureCount} structures</>,
    },
    {
      href: '#/volume',
      title: 'Volume',
      blurb: 'Ray-marched volume rendering: the raw scan as a glowing, see-through 3D cloud.',
      art: <ArtVolume />,
      tone: 'violet',
      fact: r ? <>{r[0]}×{r[1]}×{r[2]} voxels</> : undefined,
    },
    {
      href: '#/calcium',
      title: 'Calcium Score',
      blurb: 'My own DIY Agatston calcium score, built and checked lesion by lesion, with the math shown.',
      art: <ArtCalcium />,
      tone: 'amber',
      fact: calcium ? <>Score {Math.round(calcium.totals.agatston * 10) / 10}{calcium.reviewed ? '' : ' · provisional'}</> : undefined,
    },
    {
      href: '#/read',
      title: 'AI Read',
      blurb: 'An AI second opinion on the whole scan, system by system, cross-checked and in plain English.',
      art: <ArtRead />,
      tone: 'green',
      fact: read ? <span className={`chip ${VERDICT[read.verdict]?.cls ?? 'info'}`}>{VERDICT[read.verdict]?.label ?? read.verdict}</span> : undefined,
    },
    {
      href: '#/lab',
      title: 'Lab',
      blurb: 'Experiments and surprises: a beating heart, a heart in your room, a 3D print, body by numbers.',
      art: <ArtLab />,
      tone: 'lab',
      fact: <>Just for fun</>,
    },
  ]
  return (
    <section className="ovw-section" aria-labelledby="ovw-explore">
      <div className="ovw-section-head">
        <div className="ovw-eyebrow">Explore</div>
        <h2 id="ovw-explore" className="ovw-h2">Six ways into the same scan</h2>
      </div>
      <div className={`ovw-cards${inView ? ' is-in' : ''}`} ref={ref}>
        {cards.map((c, i) => (
          <a key={c.href} href={c.href} className={`ovw-card ovw-tone-${c.tone}`} style={{ ['--i' as string]: i }}>
            <div className="ovw-card-glow" aria-hidden="true" />
            <div className="ovw-card-art-wrap">{c.art}</div>
            <div className="ovw-card-body">
              <h3>{c.title}</h3>
              <p>{c.blurb}</p>
            </div>
            <div className="ovw-card-foot">
              <span className="ovw-card-fact">{c.fact}</span>
              <span className="ovw-card-go">Open <ArrowRight size={14} /></span>
            </div>
          </a>
        ))}
      </div>
      {read && (
        <p className="ovw-read-teaser">
          <b>AI second read:</b> {read.headline} <a href="#/read">Read it</a>
        </p>
      )}
    </section>
  )
}
