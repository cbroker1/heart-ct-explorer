import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { dataUrl, formatBytes, type Manifest } from '../../lib/data'
import { HeartIcon } from '../../components/ui'
import { EcgMonitor } from './EcgMonitor'
import { OvwErrorBoundary } from './ErrorBoundary'
import { AUTO_SPIN, heartPartsFrom, INITIAL_ANGLE, PART_INFO } from './heartParts'
import { hasWebGL2, useInView, usePageVisible } from './hooks'
import { ArrowRight, IconCube, IconLayers } from './icons'
import type { ExamJson, SpinState } from './types'
import { useManifestFacts } from './useOverviewData'

// three.js + R3F live in their own chunk so the hero text paints immediately.
const HeroHeart = lazy(() => import('./HeroHeart'))

export function Hero(props: { manifest: Manifest; exam: ExamJson | null; reducedMotion: boolean }) {
  const { manifest, exam, reducedMotion } = props
  const facts = useManifestFacts(manifest)
  const bpm = exam?.ecg?.hrAvg ?? null
  const parts = useMemo(() => heartPartsFrom(manifest.meshes?.nodes ?? []), [manifest])
  const glbUrl = dataUrl(manifest.meshes.heartFile ?? manifest.meshes.file)
  const webgl = useMemo(() => hasWebGL2(), [])

  const [stageRef, stageInView] = useInView<HTMLDivElement>({ rootMargin: '120px' })
  const pageVisible = usePageVisible()
  const running = stageInView && pageVisible
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  const [loadError, setLoadError] = useState<string | null>(null)
  const onLoadError = useCallback((msg: string) => setLoadError(msg), [])
  const failure = !webgl
    ? 'The 3D heart needs WebGL2, which this browser does not offer. Everything else on this page works.'
    : loadError
      ? 'The 3D model could not be loaded right now. The rest of the site still works.'
      : null
  const [dragged, setDragged] = useState(false)

  // Starts with a little extra spin that settles to the slow turntable speed.
  const spin = useRef<SpinState>({
    angle: reducedMotion ? INITIAL_ANGLE : INITIAL_ANGLE - 0.6,
    vel: reducedMotion ? 0 : AUTO_SPIN * 4.5,
    dragging: false,
    lastX: 0,
    lastT: 0,
  })
  const press = useRef<{ id: number; x0: number } | null>(null)
  const invalidateRef = useRef<(() => void) | null>(null)

  // ---- point at a structure to name it (mouse hover, or tap on touch screens)
  const [pick, setPick] = useState<string | null>(null)
  const hoverCapable = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches, [])
  const labelRef = useRef<HTMLDivElement>(null)
  const labelPos = useRef({ x: 0, y: 0 })
  const pickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pickTimer.current), [])
  const onPick = useCallback((name: string | null, pointerType: string) => {
    window.clearTimeout(pickTimer.current)
    if (spin.current.dragging) return
    setPick(name)
    // touch has no "hover out", so tap labels fade on their own
    if (name && pointerType !== 'mouse') pickTimer.current = window.setTimeout(() => setPick(null), 3800)
  }, [])
  const placeLabel = (clientX: number, clientY: number) => {
    const st = stageRef.current
    if (!st) return
    const r = st.getBoundingClientRect()
    // The label is centred on x and at most 240px wide: keep 8px clear of the stage edges (full-bleed on phones).
    labelPos.current = { x: Math.max(128, Math.min(r.width - 128, clientX - r.left)), y: clientY - r.top }
    const lb = labelRef.current
    if (lb) { lb.style.left = `${labelPos.current.x}px`; lb.style.top = `${labelPos.current.y}px` }
  }

  // Drag to spin (horizontal only: vertical swipes keep scrolling the page on phones). The pointer is
  // only captured once a real drag starts, so plain taps/clicks still reach the 3D picking.
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    press.current = { id: e.pointerId, x0: e.clientX }
    const s = spin.current
    s.lastX = e.clientX
    s.lastT = e.timeStamp
    placeLabel(e.clientX, e.clientY)
    if (e.pointerType !== 'mouse') setPick(null)
  }
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && !spin.current.dragging) placeLabel(e.clientX, e.clientY)
    const s = spin.current
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (!s.dragging) {
      if (Math.abs(e.clientX - p.x0) < 5) return
      s.dragging = true
      s.vel = 0
      setPick(null)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    const dx = e.clientX - s.lastX
    const dt = Math.max(8, e.timeStamp - s.lastT) / 1000
    const k = 0.0105
    s.angle += dx * k
    s.vel = 0.7 * s.vel + 0.3 * ((dx * k) / dt)
    s.lastX = e.clientX
    s.lastT = e.timeStamp
    if (!dragged) setDragged(true)
    invalidateRef.current?.()
  }
  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    const s = spin.current
    if (!s.dragging) return
    s.dragging = false
    s.vel = Math.max(-5, Math.min(5, s.vel))
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    invalidateRef.current?.()
  }
  const pickedNode = pick ? manifest.meshes.nodes.find((n) => n.name === pick) : null

  return (
    <section className="ovw-hero" aria-labelledby="ovw-title">
      <div className="ovw-hero-bg" aria-hidden="true" />
      <div className="ovw-hero-inner">
        <div className="ovw-hero-left">
          <div className="ovw-hero-copy">
            <div className="ovw-kicker">
              <span className="ovw-live-dot" aria-hidden="true" />
              <span>Cardiac CT</span>
              {facts.dayMonthYear && <><span className="ovw-kdot" aria-hidden="true">·</span><span>{facts.dayMonthYear}</span></>}
              {facts.scanner && <span className="ovw-kscanner"><span className="ovw-kdot" aria-hidden="true">·</span><span>{facts.scanner}</span></span>}
            </div>
            <h1 id="ovw-title" className="ovw-title">
              My heart, <span className="ovw-grad">in&nbsp;3D</span>
            </h1>
            <p className="ovw-sub">
              A real cardiac CT{facts.age !== null || facts.monthYear ? ' (' : ''}
              {[facts.age !== null ? `${facts.age} y/o` : null, facts.monthYear].filter(Boolean).join(', ')}
              {facts.age !== null || facts.monthYear ? ')' : ''} turned into an explorable 3D model, a slice viewer,
              a DIY calcium score and an AI second opinion, all running in your browser.
            </p>
          </div>
          <div className="ovw-ctas">
            <a className="btn primary ovw-cta" href="#/anatomy">
              <IconCube size={17} /> Explore the 3D anatomy <ArrowRight size={15} />
            </a>
            <a className="btn cyan ovw-cta" href="#/slices">
              <IconLayers size={17} /> Browse {facts.totalImages.toLocaleString('en-US')} slices
            </a>
          </div>
          <ul className="ovw-hero-facts" aria-label="About this exam">
            <li><b>{facts.structureCount}</b> structures segmented by AI</li>
            <li><b>{facts.seriesCount}</b> CT series</li>
            <li>Rendered entirely <b>in your browser</b></li>
          </ul>
        </div>

        <div
          className={`ovw-stage${ready ? ' is-ready' : ''}${failure ? ' is-failed' : ''}`}
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPick(null) }}
          role="img"
          aria-label={reducedMotion
            ? `3D model of my heart built from the CT: ${parts.length} AI-segmented structures. Drag sideways to turn it.`
            : `Rotating 3D model of my heart built from the CT: ${parts.length} AI-segmented structures${bpm ? `, beating at ${bpm} beats per minute` : ''}. Drag sideways to spin it.`}
        >
          <div className="ovw-stage-view">
            <div className="ovw-stage-glow" aria-hidden="true" />
            <HudRings />
            <div className="ovw-canvas-wrap">
              {webgl && (
                <OvwErrorBoundary onError={onLoadError}>
                  <Suspense fallback={null}>
                    <HeroHeart
                      url={glbUrl}
                      parts={parts}
                      bpm={bpm}
                      running={running}
                      reducedMotion={reducedMotion}
                      spin={spin}
                      beatTarget={stageRef}
                      invalidateRef={invalidateRef}
                      onReady={onReady}
                      onPick={onPick}
                      picked={pick}
                    />
                  </Suspense>
                </OvwErrorBoundary>
              )}
            </div>
            {failure && (
              <div className="ovw-stage-fallback">
                <HeartIcon size={120} className="ovw-fallback-heart" />
                <p className="muted">{failure}</p>
              </div>
            )}
            {!failure && !ready && (
              <div className="ovw-stage-loading" aria-hidden="true">
                <div className="ovw-loading-ring" />
                <div className="ovw-loading-txt">Loading 3D heart · {formatBytes(manifest.meshes.heartBytes ?? manifest.meshes.bytes)}</div>
              </div>
            )}

            <div className="ovw-hud ovw-hud-tl" aria-hidden="true">
              <span className="ovw-hud-k">Live model</span>
              <span>{parts.length} heart &amp; vessel parts · AI segmentation</span>
            </div>
            <div className={`ovw-hud ovw-hud-drag${dragged ? ' is-hidden' : ''}`} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7 4 11l4 4" /><path d="M16 7l4 4-4 4" /><path d="M4 11h16" /></svg>
              {hoverCapable ? 'drag to spin · point to name' : 'drag to spin · tap to name'}
            </div>
            <div className="ovw-legend" aria-hidden="true">
              <span><i style={{ background: '#ff4d5e' }} />oxygen-rich side</span>
              <span><i style={{ background: '#5f80ff' }} />oxygen-poor side</span>
            </div>
            <div
              ref={labelRef}
              className={`ovw-pick${pick ? ' is-on' : ''}${labelPos.current.y < 120 ? ' is-below' : ''}`}
              style={{ left: labelPos.current.x, top: labelPos.current.y }}
              aria-hidden="true"
            >
              {pickedNode && (
                <>
                  <span className="ovw-pick-name"><i style={{ background: pickedNode.color }} />{pickedNode.display}</span>
                  {PART_INFO[pickedNode.name] && <span className="ovw-pick-info">{PART_INFO[pickedNode.name]}</span>}
                </>
              )}
            </div>
          </div>

          <div className="ovw-stage-foot">
            <div className="ovw-monitor">
              <div className="ovw-monitor-trace">
                <EcgMonitor bpm={bpm} running={running} reducedMotion={reducedMotion} />
              </div>
              <div className="ovw-monitor-read">
                <div className="ovw-monitor-bpm">
                  <span className="ovw-heart-mini" aria-hidden="true"><HeartIcon size={14} /></span>
                  <b>{bpm ?? '–'}</b><small>bpm</small>
                </div>
                <div className="ovw-monitor-cap">
                  {exam?.ecg ? <>my average in the scanner · {exam.ecg.hrMin}–{exam.ecg.hrMax}</> : 'heart rate during the scan'}
                </div>
                <div className="ovw-monitor-note">trace is illustrative</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Faint rotating "scope" rings behind the heart. */
const HudRings = memo(function HudRings() {
  const ticks = Array.from({ length: 72 }, (_, i) => i)
  return (
    <svg className="ovw-rings" viewBox="-100 -100 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="ovw-ring-fade" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
          <stop offset="0.55" stopColor="#38d6ff" stopOpacity="0.0" />
          <stop offset="0.8" stopColor="#38d6ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#38d6ff" stopOpacity="0.0" />
        </radialGradient>
      </defs>
      <g className="ovw-rings-a">
        <circle r="92" fill="none" stroke="url(#ovw-ring-fade)" strokeWidth="0.35" />
        {ticks.map((i) => {
          const a = (i / ticks.length) * Math.PI * 2
          const long = i % 6 === 0
          const r0 = long ? 86.5 : 88.5
          return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * 91} y2={Math.sin(a) * 91} stroke="#8be7ff" strokeOpacity={long ? 0.4 : 0.18} strokeWidth={long ? 0.5 : 0.3} />
        })}
      </g>
      <g className="ovw-rings-b">
        <circle r="78" fill="none" stroke="#ff8a95" strokeOpacity="0.16" strokeWidth="0.3" strokeDasharray="1.2 2.6" />
        <path d="M 0 -70 A 70 70 0 0 1 60.6 -35" fill="none" stroke="#ff4d5e" strokeOpacity="0.5" strokeWidth="0.6" strokeLinecap="round" />
        <path d="M 0 70 A 70 70 0 0 1 -60.6 35" fill="none" stroke="#38d6ff" strokeOpacity="0.45" strokeWidth="0.6" strokeLinecap="round" />
      </g>
    </svg>
  )
})
