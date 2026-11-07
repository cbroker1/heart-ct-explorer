/** "How this was made": the pipeline from the hospital's DICOM export to this website. */
import type { ReactNode } from 'react'
import { formatBytes, type Manifest } from '../../lib/data'
import { useInView } from './hooks'
import { ArrowUpRight, IconBrain, IconDisc, IconGithub, IconGlobe, IconMesh, IconScreen, IconShield } from './icons'
import { useManifestFacts } from './useOverviewData'

export const REPO_URL = 'https://github.com/cbroker1/heart-ct-explorer'

interface Step { icon: ReactNode; title: string; body: ReactNode; tag: string }

export function Timeline(props: { manifest: Manifest }) {
  const { manifest } = props
  const facts = useManifestFacts(manifest)
  const [ref, inView] = useInView<HTMLOListElement>({ once: true, threshold: 0.15 })
  const meshCount = manifest.meshes?.nodes?.length ?? 0
  const steps: Step[] = [
    {
      icon: <IconDisc size={20} />,
      title: 'DICOM export',
      tag: 'hospital download',
      body: <>The hospital's export of the exam: {facts.seriesCount} CT series, {facts.totalImages.toLocaleString('en-US')} images, plus the two scout views.</>,
    },
    {
      icon: <IconShield size={20} />,
      title: 'De-identification',
      tag: 'Python · pydicom',
      body: <>Names, IDs and birth date stripped. Only age, sex, scan date and scanner settings are kept.</>,
    },
    {
      icon: <IconBrain size={20} />,
      title: 'AI segmentation',
      tag: 'TotalSegmentator v2 + v1',
      body: <>Open-source models label every voxel: {facts.structureCount} structures, with the v1 cardiac model splitting the heart into chambers.</>,
    },
    {
      icon: <IconMesh size={20} />,
      title: 'Marching-cubes meshes',
      tag: 'scikit-image · meshopt',
      body: <>Each structure becomes a smooth surface, simplified and packed into one {formatBytes(manifest.meshes.bytes)} 3D file ({meshCount} meshes).</>,
    },
    {
      icon: <IconScreen size={20} />,
      title: 'Custom WebGL viewers',
      tag: 'React · three.js',
      body: <>A slice viewer, a ray-marched volume renderer and the 3D anatomy, written for this scan.</>,
    },
    {
      icon: <IconGlobe size={20} />,
      title: 'GitHub Pages',
      tag: 'static site',
      body: <>Published as a plain static website: every pixel is computed right here, in your browser.</>,
    },
  ]
  return (
    <section className="ovw-section" aria-labelledby="ovw-made">
      <div className="ovw-section-head ovw-made-head">
        <div>
          <div className="ovw-eyebrow">Behind the scenes</div>
          <h2 id="ovw-made" className="ovw-h2">How this was made</h2>
        </div>
        <a className="btn ovw-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <IconGithub size={17} /> cbroker1/heart-ct-explorer <ArrowUpRight size={14} />
        </a>
      </div>
      <ol className={`ovw-timeline${inView ? ' is-in' : ''}`} ref={ref}>
        {steps.map((s, i) => (
          <li key={s.title} className="ovw-step" style={{ ['--i' as string]: i }}>
            <div className="ovw-step-node" aria-hidden="true">{s.icon}</div>
            <div className="ovw-step-body">
              <div className="ovw-step-num">{String(i + 1).padStart(2, '0')}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className="ovw-step-tag">{s.tag}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
