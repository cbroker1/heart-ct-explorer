// Lab · "3D-print my heart": inline STL turntable, stats, download and practical printing tips.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type * as THREE from 'three'
import { dataUrl, formatBytes } from '../../lib/data'
import { useApp } from '../../lib/store'
import './core/lab-core.css'
import { fetchBytesShared, hasWebGL2, useExamInfo, useInView, usePrefersReducedMotion } from './core/hooks'
import { IconCheck, IconCut, IconDownload, IconDrop, IconLayers, IconRotate, IconRuler, IconSupport, IconAlert } from './core/icons'
import type { StlInfo } from './core/types'
import { Boundary } from './core/Boundary'
import { FINISHES, type Finish, type StlStats } from './core/finishes'

// three + R3F only load when the preview is about to be shown
const StlPreviewLazy = lazy(() => import('./core/StlPreview').then((m) => ({ default: m.StlPreview })))

const PLA_DENSITY = 1.24 // g/cm³
const PRETTY: Record<string, string> = { heart: 'Heart + great vessels', ribcage: 'Rib cage, sternum & spine', lungs_airways: 'Lungs & airways' }

export default function PrintShop() {
  const manifest = useApp((s) => s.manifest)
  const exam = useExamInfo()
  const reduced = usePrefersReducedMotion()
  const [stageRef, near] = useInView<HTMLDivElement>('500px')
  const [visRef, visible] = useInView<HTMLDivElement>('0px', false)
  const [geom, setGeom] = useState<{ geometry: THREE.BufferGeometry; stats: StlStats } | null>(null)
  const [prog, setProg] = useState<{ loaded: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [finish, setFinish] = useState<Finish>(FINISHES[0])
  const [spin, setSpin] = useState(!reduced)
  const [attempt, setAttempt] = useState(0)
  const webgl = hasWebGL2()

  const stlRel = manifest?.files?.stl_heart ?? 'mesh/print_heart.stl'
  const info: StlInfo | undefined = exam.data?.stl?.find((s) => s.name === 'heart')
  const others = (exam.data?.stl ?? []).filter((s) => s.name !== 'heart')

  useEffect(() => { if (reduced) setSpin(false) }, [reduced])

  // fetch + parse the STL once the section is close to the viewport
  useEffect(() => {
    if (!near || !webgl || geom || err) return
    let alive = true
    const { promise, release } = fetchBytesShared(stlRel, info?.bytes ?? 9_000_000, (loaded, total) => {
      if (alive) setProg({ loaded, total })
    })
    ;(async () => {
      try {
        const bytes = await promise
        if (!alive) return
        const { prepareStl } = await import('./core/StlPreview')
        await new Promise((r) => setTimeout(r, 0))            // let the "smoothing" label paint first
        if (!alive) return
        const out = prepareStl(bytes.buffer as ArrayBuffer)
        if (alive) setGeom(out)
        else out.geometry.dispose()
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message ?? e))
      }
    })()
    return () => { alive = false; release() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, webgl, stlRel, attempt])
  useEffect(() => () => { geom?.geometry.dispose() }, [geom])

  const size = info?.sizeMM ?? geom?.stats.size
  const tris = info?.triangles ?? geom?.stats.triangles
  const vol = geom?.stats.volumeCm3

  return (
    <div>
      <p className="lc-lede">
        A watertight, print-ready copy of <b>my heart and its great vessels</b>, straight from the scan. The file is in
        millimetres, so printing it at 100% gives you a <b>life-size</b> heart to hold.
      </p>
      <div className="lc-print">
        <div ref={(el) => { stageRef.current = el; visRef.current = el }} className="lc-glass lc-print-stage">
          {!webgl && (
            <div className="lc-loading"><div className="box">3D preview needs WebGL2, which this browser doesn't offer. The download still works.</div></div>
          )}
          {webgl && !geom && !err && (
            <div className="lc-loading">
              <div className="box">
                <div className="spinner" />
                <div style={{ marginTop: 12, fontWeight: 650, color: 'var(--text)' }}>
                  {prog && prog.loaded >= prog.total ? 'Smoothing 180,000 triangles…' : 'Loading the print file…'}
                </div>
                <div className="lc-bar"><div style={{ width: `${prog ? Math.min(100, (100 * prog.loaded) / Math.max(1, prog.total)) : 2}%` }} /></div>
                <div className="lc-mono" style={{ fontSize: 11.5 }}>
                  {prog ? `${(prog.loaded / 1048576).toFixed(1)} / ${(prog.total / 1048576).toFixed(1)} MB` : 'waiting to scroll into view'}
                </div>
              </div>
            </div>
          )}
          {err && (
            <div className="lc-loading">
              <div className="box">
                <div className="lc-err" style={{ marginBottom: 10 }}>The preview couldn't load ({err}).</div>
                <button className="btn small" onClick={() => { setErr(null); setProg(null); setAttempt((a) => a + 1) }}>Try again</button>
              </div>
            </div>
          )}
          {geom && (
            <Boundary fallback={(e, retry) => (
              <div className="lc-loading"><div className="box"><div className="lc-err" style={{ marginBottom: 10 }}>3D preview failed: {e.message}</div>
                <button className="btn small" onClick={retry}>Try again</button></div></div>
            )}>
              <Suspense fallback={null}>
                <StlPreviewLazy geometry={geom.geometry} finish={finish} spin={spin} active={visible} height={geom.stats.size[1]} />
              </Suspense>
            </Boundary>
          )}
          <div className="lc-print-hud">
            <span className="lc-pill"><span className="dot" style={{ background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)' }} />PRINT PREVIEW · 1:1</span>
            {size && <span className="lc-pill"><b>{size[0].toFixed(0)} × {size[1].toFixed(0)} × {size[2].toFixed(0)} mm</b></span>}
          </div>
          {geom && (
            <div className="lc-print-foot">
              <div className="lc-swatches" role="radiogroup" aria-label="Filament">
                {FINISHES.map((f) => (
                  <button key={f.key} role="radio" aria-checked={finish.key === f.key} aria-label={f.label} title={f.label}
                    className={`lc-swatch${finish.key === f.key ? ' on' : ''}`} onClick={() => setFinish(f)}>
                    <i style={{ background: f.color }} /><span className="lbl">{f.label}</span>
                  </button>
                ))}
                <button className={`lc-tool${spin ? ' on' : ''}`} onClick={() => setSpin((s) => !s)} title="Turntable on/off" aria-label="Spin" aria-pressed={spin}><IconRotate /><span className="lbl">Spin</span></button>
              </div>
            </div>
          )}
        </div>

        <aside className="lc-glass lc-print-panel">
          <div>
            <div className="lc-k" style={{ color: 'var(--heart-2)' }}>print_heart.stl</div>
            <h3 style={{ margin: '4px 0 0', fontSize: 18 }}>Ready to slice: my heart at 1:1</h3>
          </div>
          <div className="lc-specs">
            <Spec v={size ? `${(size[0] / 10).toFixed(1)}×${(size[1] / 10).toFixed(1)}×${(size[2] / 10).toFixed(1)}` : '…'} u="cm" k="Width × height × depth" />
            <Spec v={tris ? tris.toLocaleString('en-US') : '…'} k="Triangles" />
            <Spec
              v={info ? (info.watertight ? 'Watertight' : 'Has holes') : '…'}
              k={!info ? 'Closed surface?' : info.watertight ? 'Closed surface: slicers can fill it' : 'Needs a repair pass'}
              ok={!!info?.watertight}
              icon={info?.watertight ? <IconCheck width={16} height={16} style={{ verticalAlign: '-3px', marginRight: 4 }} /> : null}
            />
            <Spec v={info ? formatBytes(info.bytes) : '…'} k="Binary STL download" />
            <Spec v={vol ? vol.toFixed(0) : '…'} u="cm³" k="Solid volume" />
            <Spec v={vol ? (vol * PLA_DENSITY).toFixed(0) : '…'} u="g" k="PLA if printed 100% solid" />
          </div>
          <a className="lc-dl" href={dataUrl(stlRel)} download="my-heart-life-size.stl">
            <IconDownload />
            <span>Download my heart (.stl)<small>{info ? formatBytes(info.bytes) : '9 MB'} · millimetres · print at 100% for life size</small></span>
          </a>
          {others.length > 0 && (
            <div>
              <div className="lc-k" style={{ marginBottom: 6 }}>Bonus prints from the same scan</div>
              <div className="lc-dl-alt">
                {others.map((s) => (
                  <a key={s.name} className="btn small" href={dataUrl(`mesh/${s.file}`)} download={`my-${s.name.replace('_', '-')}.stl`}
                    title={s.watertight ? 'Watertight' : 'Not watertight: run a mesh repair (e.g. in your slicer) before printing'}>
                    <IconDownload width={14} height={14} /> {PRETTY[s.name] ?? s.name}
                    <span className="faint" style={{ fontWeight: 500 }}>{(s.sizeMM[0] / 10).toFixed(0)} cm wide{s.watertight ? '' : ' · needs repair'}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="disclaimer" style={{ marginTop: 'auto' }}>
            A model for curiosity and teaching, built from AI outlines of a non-contrast scan. Not for surgical planning.
          </div>
        </aside>
      </div>

      <div className="lc-tips">
        <Tip icon={<IconRuler />} title="Print at 100% = life size">
          The STL is in <b>millimetres</b>, so don't rescale on import. At about {size ? `${(Math.max(...size) / 10).toFixed(0)} cm` : '14 cm'} on
          its longest side it fits any bed of 18 × 18 cm or more.
        </Tip>
        <Tip icon={<IconRotate />} title="Stand it up">
          The file's "up" is my head (+Y); slicers use +Z, so it imports lying on its back. Rotate <b>90° about X</b> to stand it on
          its base, or print it lying down for fewer supports.
        </Tip>
        <Tip icon={<IconSupport />} title="Use tree supports">
          The aorta, pulmonary artery and veins overhang in every direction. <b>Tree/organic supports</b> touching the build plate only
          come off cleanly and leave fewer scars.
        </Tip>
        <Tip icon={<IconLayers />} title="FDM settings">
          <b>0.2 mm layers, 3 walls, 10-15% infill</b> keep it light and quick; 0.12 mm layers make the surface smoother.
          {vol ? <> Fully solid it would take about {(vol * PLA_DENSITY).toFixed(0)} g of PLA; infill makes it much lighter.</> : null}
        </Tip>
        <Tip icon={<IconDrop />} title="Resin? Hollow it">
          Resin shows the finest detail, but a solid heart this big wastes resin and can crack. <b>Hollow to 2-3 mm walls</b>, add two drain
          holes, and check it fits your plate (many are only ~13 × 8 cm).
        </Tip>
        <Tip icon={<IconCut />} title="Too big? Split or scale">
          Use the slicer's <b>cut tool</b> to split it into two halves and glue them, or scale to <b>50%</b> for a desk-sized heart
          (about {size ? (Math.max(...size) / 20).toFixed(0) : 7} cm).
        </Tip>
      </div>
      {others.some((s) => !s.watertight) && (
        <p className="faint" style={{ fontSize: 12, marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <IconAlert width={14} height={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
          The bonus rib-cage and lung files are open meshes (the scan cuts them off at the top and bottom), so run a repair (e.g. the slicer's "fix model") first.
          {others.some((s) => Math.max(...s.sizeMM) > 250) ? ' At life size they are also bigger than most print beds, so scale them down.' : ''}
        </p>
      )}
    </div>
  )
}

function Spec(props: { v: string; u?: string; k: string; ok?: boolean; icon?: ReactNode }) {
  return (
    <div className={`lc-spec${props.ok ? ' ok' : ''}`}>
      <div className="v">{props.icon}{props.v}{props.u && <small>{props.u}</small>}</div>
      <div className="k">{props.k}</div>
    </div>
  )
}

function Tip(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="lc-tip">
      <h4>{props.icon}{props.title}</h4>
      <p>{props.children}</p>
    </div>
  )
}
