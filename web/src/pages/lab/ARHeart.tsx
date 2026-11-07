// Lab · "A life-size heart in your room": <model-viewer> with the heart-only GLB in metres, so phones
// place it at real size (AR Quick Look on iPhone, Scene Viewer / WebXR on Android).
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { dataUrl, formatBytes } from '../../lib/data'
import { HeartIcon } from '../../components/ui'
import './core/lab-core.css'
import { useBiomarkers, useInView, usePrefersReducedMotion } from './core/hooks'
import { loadModelViewer, orbitFacing, type MVMaterial, type ModelViewerElement } from './core/modelViewer'
import { encodeQr, qrPath } from './core/qr'
import { IconCubeAR, IconDownload, IconEye, IconPhone, IconReset, IconRotate, IconTag } from './core/icons'
import type { ArModel } from './core/types'

const GLB = 'mesh/heart_ar.glb'
const DEFAULT_ORBIT = '12deg 78deg 92%'
const DEFAULT_TARGET = 'auto auto auto'

type View = 'all' | 'right' | 'left' | 'inside'
const VIEWS: { key: View; label: string; title: string }[] = [
  { key: 'all', label: 'Whole heart', title: 'Everything at once' },
  { key: 'right', label: 'Right side', title: 'The oxygen-poor side: body → right atrium → right ventricle → lungs' },
  { key: 'left', label: 'Left side', title: 'The oxygen-rich side: lungs → left atrium → left ventricle → body' },
  { key: 'inside', label: 'See inside', title: 'Fade the heart muscle to reveal the blood inside the left ventricle' },
]
const RIGHT = new Set(['heart_atrium_right', 'heart_ventricle_right', 'pulmonary_artery', 'superior_vena_cava', 'inferior_vena_cava'])
const LEFT = new Set(['heart_atrium_left', 'atrial_appendage_left', 'heart_ventricle_left', 'heart_myocardium', 'aorta', 'pulmonary_vein'])

// Fallback facts if biomarkers.json is missing (values from pipeline/07_lab_assets.py).
const FALLBACK: Pick<ArModel, 'sizeMM' | 'bytes' | 'triangles' | 'nodes' | 'hotspots'> = {
  sizeMM: [129.1, 136.6, 140.3], bytes: 2772428, triangles: 114994, nodes: [], hotspots: [],
}
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function useIsTouch() {
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)')
    if (!mq) return
    const on = () => setTouch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return touch
}

function shareUrl(): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/lab?ar=1`
}

function QrCard() {
  const url = useMemo(shareUrl, [])
  const qr = useMemo(() => {
    try { return qrPath(encodeQr(url, 'M'), 3) } catch { return null }
  }, [url])
  const local = /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url)
  const [copied, setCopied] = useState(false)
  if (!qr) return null
  return (
    <div className="lc-qr">
      <svg viewBox={qr.viewBox} role="img" aria-label="QR code linking to this page">
        <rect width="100%" height="100%" fill="#fff" />
        <path d={qr.d} fill="#07090d" shapeRendering="crispEdges" />
      </svg>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
          <IconPhone width={16} height={16} /> Scan with your phone
        </div>
        <p>Opens this page right here; then tap <b style={{ color: 'var(--text)' }}>View in your space</b>.</p>
        {local && <p style={{ color: 'var(--amber)' }}>This is a local address that a phone can't open; on the published site the code points to the public page.</p>}
        <button
          className="lc-link"
          style={{ justifySelf: 'start' }}
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
          }}
        >{copied ? 'Link copied ✓' : 'Copy link'}</button>
      </div>
    </div>
  )
}

export default function ARHeart() {
  const bio = useBiomarkers()
  const model: Pick<ArModel, 'sizeMM' | 'bytes' | 'triangles' | 'nodes' | 'hotspots'> = bio.data?.arModel ?? FALLBACK
  const reduced = usePrefersReducedMotion()
  const isTouch = useIsTouch()
  const [stageRef, inView] = useInView<HTMLDivElement>('400px')
  const mvRef = useRef<ModelViewerElement | null>(null)
  const materials = useRef<Map<string, { m: MVMaterial; rgba: [number, number, number, number] }>>(new Map())

  const [phase, setPhase] = useState<'idle' | 'script' | 'model' | 'ready' | 'error'>('idle')
  const [err, setErr] = useState<{ msg: string; script: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [wheelHint, setWheelHint] = useState(false)
  const [progress, setProgress] = useState(0)
  const [autoRotate, setAutoRotate] = useState(!reduced)
  const [labels, setLabels] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches))
  const [view, setView] = useState<View>('all')
  const [focus, setFocus] = useState<string | null>(null)
  const [canAR, setCanAR] = useState(false)
  const [dims, setDims] = useState<[number, number, number] | null>(null)
  const [arStatus, setArStatus] = useState<string | null>(null)

  useEffect(() => { if (reduced) setAutoRotate(false) }, [reduced])

  // 1) load the web component only when the section approaches the viewport
  useEffect(() => {
    if (!inView || phase !== 'idle') return
    setPhase('script')
    loadModelViewer()
      .then(() => setPhase('model'))
      .catch((e) => { setErr({ msg: String(e?.message ?? e), script: true }); setPhase('error') })
  }, [inView, phase])
  const retry = () => {
    const script = !!err?.script
    setErr(null)
    setProgress(0)
    materials.current = new Map()
    // model-viewer remembers a failed URL and fails again at once, so a retry asks for a fresh one
    if (!script) setAttempt((a) => a + 1)
    setPhase(script ? 'idle' : 'model')
  }

  // The Lab is a scrolling page: a plain mouse wheel over the model scrolls the page instead of being
  // swallowed as zoom. Ctrl/⌘ + wheel (and trackpad pinch, which arrives as Ctrl + wheel) still zooms.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let hide = 0
    let shownAt = -1e9
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.stopPropagation()          // model-viewer never sees it, and nothing calls preventDefault
      const now = performance.now()
      if (now - shownAt > 5000) {  // a brief hint, not a nag while scrolling past
        shownAt = now
        setWheelHint(true)
        window.clearTimeout(hide)
        hide = window.setTimeout(() => setWheelHint(false), 1600)
      }
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => { el.removeEventListener('wheel', onWheel, { capture: true }); window.clearTimeout(hide) }
  }, [stageRef])

  // 2) deep link #/lab?ar=1 (from the QR code): bring this section into view
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    if (q.get('ar') === '1') {
      const t = window.setTimeout(() => stageRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 350)
      return () => window.clearTimeout(t)
    }
  }, [stageRef, reduced])

  // 3) model-viewer events
  const attach = useCallback((el: ModelViewerElement | null) => {
    mvRef.current = el
  }, [])
  useEffect(() => {
    const el = mvRef.current
    if (!el || phase === 'idle' || phase === 'script' || phase === 'error') return
    const onProgress = (e: Event) => setProgress((e as CustomEvent<{ totalProgress: number }>).detail?.totalProgress ?? 0)
    const onLoad = () => {
      if (materials.current.size === 0) {
        const map = new Map<string, { m: MVMaterial; rgba: [number, number, number, number] }>()
        for (const m of el.model?.materials ?? []) {
          const c = m.pbrMetallicRoughness.baseColorFactor
          map.set(m.name, { m, rgba: [c[0], c[1], c[2], 1] })
        }
        materials.current = map
      }
      try {
        const d = el.getDimensions()
        setDims([d.x * 1000, d.y * 1000, d.z * 1000])
      } catch { /* older API */ }
      setCanAR(!!el.canActivateAR)
      // WebXR support is detected asynchronously: look again once it has had time to settle
      window.setTimeout(() => setCanAR(!!el.canActivateAR), 1500)
      setPhase('ready')
    }
    const onError = () => { setErr({ msg: 'The 3D model could not be loaded.', script: false }); setPhase('error') }
    const onAr = (e: Event) => setArStatus((e as CustomEvent<{ status: string }>).detail?.status ?? null)
    el.addEventListener('progress', onProgress)
    el.addEventListener('load', onLoad)
    el.addEventListener('error', onError)
    el.addEventListener('ar-status', onAr)
    if (el.loaded) onLoad()
    return () => {
      el.removeEventListener('progress', onProgress)
      el.removeEventListener('load', onLoad)
      el.removeEventListener('error', onError)
      el.removeEventListener('ar-status', onAr)
    }
  }, [phase])

  // 4) view filters through the scene-graph material API
  useEffect(() => {
    if (phase !== 'ready') return
    for (const [name, { m, rgba }] of materials.current) {
      let a = 1
      if (view === 'right' && !RIGHT.has(name)) a = 0.1
      if (view === 'left' && !LEFT.has(name)) a = 0.1
      if (view === 'inside' && name === 'heart_myocardium') a = 0.16
      if (view === 'inside' && name === 'heart_ventricle_right') a = 0.55
      try {
        m.setAlphaMode(a < 1 ? 'BLEND' : 'OPAQUE')
        m.pbrMetallicRoughness.setBaseColorFactor([rgba[0], rgba[1], rgba[2], a])
      } catch { /* material API unavailable */ }
    }
  }, [view, phase])

  // 5) camera focus on a labelled structure
  useEffect(() => {
    const el = mvRef.current
    if (!el || phase !== 'ready') return
    const hs = model.hotspots.find((h) => h.name === focus)
    if (hs) {
      el.cameraTarget = `${hs.position[0]}m ${hs.position[1]}m ${hs.position[2]}m`
      el.cameraOrbit = orbitFacing(hs.normal, '0.24m')
    } else {
      el.cameraTarget = DEFAULT_TARGET
      el.cameraOrbit = DEFAULT_ORBIT
    }
  }, [focus, phase, model.hotspots])

  const pickFocus = (name: string) => {
    setAutoRotate(false)
    setFocus((f) => (f === name ? null : name))
  }
  const reset = () => {
    setFocus(null)
    setView('all')
    const el = mvRef.current
    if (el) { el.cameraTarget = DEFAULT_TARGET; el.cameraOrbit = DEFAULT_ORBIT; el.resetTurntableRotation?.(0) }
  }

  const size = dims ?? model.sizeMM
  const cm = (mm: number) => (mm / 10).toFixed(1)
  const nodeColor = (name: string) => model.nodes.find((n) => n.name === name)?.color ?? '#ff4d5e'
  const legend = model.nodes.filter((n) => n.name !== 'heart_ventricle_left')

  return (
    <div>
      <p className="lc-lede">
        This 3D model was built from <b>my own scan</b>: every chamber, the heart muscle and the big vessels, exactly as the AI
        traced them, stored in real-world metres. Drag to turn it; on a phone it can stand on your desk at <b>true size</b>.
      </p>
      <div className="lc-ar">
        <div ref={stageRef} className="lc-glass lc-ar-stage">
          {(phase === 'idle' || phase === 'script') && <Poster progress={0} label="Preparing the 3D viewer…" />}
          {phase === 'error' && (
            <div className="lc-fallback">
              <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
                <HeartIcon size={54} />
                <div className="lc-err" style={{ fontWeight: 650 }}>{err?.msg}</div>
                <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }}>
                  <button className="btn small" onClick={retry}>Try again</button>
                  {/* only the viewer failed: the model file itself may still download fine */}
                  {err?.script && <a className="btn small" href={dataUrl(GLB)} download="my-heart-life-size.glb"><IconDownload width={14} height={14} /> Download the .glb instead</a>}
                </div>
              </div>
            </div>
          )}
          <div className={`lc-wheel-hint${wheelHint && phase === 'ready' ? ' on' : ''}`} aria-hidden>
            {IS_MAC ? '⌘' : 'Ctrl'} + scroll to zoom
          </div>
          {phase !== 'idle' && phase !== 'script' && phase !== 'error' && (
            <model-viewer
              ref={attach as unknown as Ref<HTMLElement>}
              src={attempt ? `${dataUrl(GLB)}?retry=${attempt}` : dataUrl(GLB)}
              alt="3D model of my heart and its great vessels, at real size"
              ar
              ar-modes="webxr scene-viewer quick-look"
              ar-scale="fixed"
              ar-placement="floor"
              camera-controls
              {...(autoRotate ? { 'auto-rotate': true } : {})}
              auto-rotate-delay={0}
              rotation-per-second="16deg"
              interaction-prompt="none"
              touch-action="pan-y"
              camera-orbit={DEFAULT_ORBIT}
              min-camera-orbit="auto auto 0.18m"
              max-camera-orbit="auto auto 0.9m"
              shadow-intensity="1"
              shadow-softness="0.85"
              exposure={1.05}
              tone-mapping="neutral"
              environment-image="neutral"
              interpolation-decay="140"
              loading="eager"
            >
              <div slot="poster" className="lc-poster" style={{ pointerEvents: 'none' }}>
                <PosterInner progress={progress} label={`Loading 3D heart · ${formatBytes(model.bytes)}`} />
              </div>
              <div slot="progress-bar" />
              <button slot="ar-button" className="lc-ar-btn">
                <IconCubeAR /> View in your space
              </button>
              {labels && model.hotspots.map((h, i) => (
                <button
                  key={h.name}
                  slot={`hotspot-${i}`}
                  className={`lc-hotspot${focus === h.name ? ' on' : ''}`}
                  data-position={`${h.position[0]}m ${h.position[1]}m ${h.position[2]}m`}
                  data-normal={`${h.normal[0]}m ${h.normal[1]}m ${h.normal[2]}m`}
                  data-visibility-attribute="visible"
                  style={{ ['--lc-c' as string]: nodeColor(h.name) }}
                  onClick={() => pickFocus(h.name)}
                  title={`Zoom to the ${h.label.toLowerCase()}`}
                >
                  {h.label}
                </button>
              ))}
            </model-viewer>
          )}

          <div className="lc-ar-hud lc-ar-top">
            <span className="lc-pill"><span className="dot" />LIFE-SIZE · <b>{cm(size[0])} × {cm(size[1])} × {cm(size[2])} cm</b></span>
            {arStatus === 'failed' && <span className="lc-pill" style={{ color: 'var(--amber)' }}>AR couldn't start on this device</span>}
          </div>
          {phase === 'ready' && (
            <div className="lc-ar-hud lc-ar-bottom">
              <div className="lc-seg-mini" role="group" aria-label="What to show">
                {VIEWS.map((v) => (
                  <button key={v.key} className={view === v.key ? 'on' : ''} aria-pressed={view === v.key} title={v.title} onClick={() => setView(v.key)}>{v.label}</button>
                ))}
              </div>
              <button className={`lc-tool${autoRotate ? ' on' : ''}`} onClick={() => setAutoRotate((a) => !a)} title="Slowly turn the model" aria-label="Spin" aria-pressed={autoRotate}>
                <IconRotate /><span className="lbl">Spin</span>
              </button>
              <button className={`lc-tool${labels ? ' on' : ''}`} onClick={() => setLabels((l) => !l)} title="Show labels on the model" aria-label="Labels" aria-pressed={labels}>
                <IconTag /><span className="lbl">Labels</span>
              </button>
              <button className="lc-tool" onClick={reset} title="Back to the starting view" aria-label="Reset view"><IconReset /><span className="lbl">Reset</span></button>
            </div>
          )}
        </div>

        <aside className="lc-glass lc-side">
          <div>
            <div className="lc-k" style={{ color: 'var(--heart-2)' }}>Real dimensions</div>
            <h3 style={{ marginTop: 4 }}>It fits in a {Math.ceil(Math.max(...size) / 10)} cm box</h3>
          </div>
          <div className="lc-dims" title="Bounding box of the model: the heart plus the stubs of its big vessels inside the scan">
            {([['Width', size[0]], ['Height', size[1]], ['Depth', size[2]]] as const).map(([k, v]) => (
              <div className="lc-dim" key={k}>
                <span>{k}</span>
                <div className="lc-track"><div style={{ width: `${Math.min(100, (v / 160) * 100)}%` }} /></div>
                <b>{cm(v)} cm</b>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11 }}>Box the model fits in, great-vessel stubs included · ruler ticks every 1 cm</div>
          </div>

          <ol className="lc-steps">
            {isTouch ? (
              <>
                <li><span>Tap <b>View in your space</b>{canAR ? ' on the model' : ''}.</span></li>
                <li><span>Point the camera at the floor or a table and move the phone slowly until it finds the surface.</span></li>
                <li><span>The heart appears at <b>real size, about 12-14 cm</b>. Walk around it; it stays life-size.</span></li>
              </>
            ) : (
              <>
                <li><span>On a phone, open this page (scan the code below).</span></li>
                <li><span>Tap <b>View in your space</b>. iPhone uses AR Quick Look, Android uses Scene Viewer.</span></li>
                <li><span>It appears at <b>real size, about 12-14 cm</b>. Walk around it; it stays life-size.</span></li>
              </>
            )}
          </ol>
          {isTouch && phase === 'ready' && !canAR && (
            <div className="disclaimer" style={{ borderLeftColor: 'var(--cyan)', background: 'rgba(56,214,255,0.06)' }}>
              No "View in your space" button? Then this browser can't start AR: try Safari on iPhone or Chrome on Android.
            </div>
          )}
          {!isTouch && <QrCard />}

        </aside>
      </div>

      <div className="lc-ar-foot">
        {legend.length > 0 && (
          <div className="lc-legend" role="group" aria-label="Fly to a part of the model">
            <span className="lc-k" style={{ alignSelf: 'center', marginRight: 4 }}>Fly to</span>
            {legend.map((n) => {
              const hs = model.hotspots.find((h) => h.name === n.name)
              return (
                <button
                  key={n.name}
                  className={focus === n.name ? 'on' : ''}
                  disabled={!hs || phase !== 'ready'}
                  aria-pressed={focus === n.name}
                  onClick={() => hs && pickFocus(n.name)}
                  title={`${n.display}: ${n.volumeML} mL (AI estimate)${hs ? '' : ' · colour key only, no camera stop for this part'}`}
                >
                  <i style={{ background: n.color }} />{n.name === 'heart_myocardium' ? 'Left ventricle' : n.display}
                </button>
              )
            })}
          </div>
        )}
        <div className="lc-ar-dl">
          <a className="btn small" href={dataUrl(GLB)} download="my-heart-life-size.glb">
            <IconDownload width={14} height={14} /> Download .glb
          </a>
          <span className="faint" style={{ fontSize: 11.5 }}>
            {formatBytes(model.bytes)} · {model.triangles.toLocaleString('en-US')} triangles · metres
          </span>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8 }}>
        <IconEye width={14} height={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <span>Shapes come from an AI outline of a scan without contrast dye, frozen mid-heartbeat: lifelike, not surgical-grade.
          Blue = the oxygen-poor right side, red = the oxygen-rich left side, as in textbooks (real blood isn't blue).</span>
      </div>
    </div>
  )
}

function PosterInner(props: { progress: number; label: string }) {
  return (
    <div className="lc-poster-in">
      <HeartIcon className="lc-poster-heart" size={92} />
      <div>{props.label}</div>
      <div className="lc-bar"><div style={{ width: `${Math.round(Math.max(0.04, props.progress) * 100)}%` }} /></div>
    </div>
  )
}

function Poster(props: { progress: number; label: string }) {
  return (
    <div className="lc-poster">
      <PosterInner {...props} />
    </div>
  )
}
