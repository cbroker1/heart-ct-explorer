// Lab · Experiment 01: my heartbeat, synced to my real ECG.
// The scanner's ECG printout (digitized by pipeline/06_ecg.py) plays back in real time, driving a
// beating 3D model of my heart (heart nodes of the anatomy GLB) and a scrolling oscilloscope.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useApp } from '../../lib/store'
import type { Manifest } from '../../lib/data'
import { formatBytes } from '../../lib/data'
import { Segmented, Toggle } from '../../components/ui'
import { Cardio, loadEcg, type EcgData } from './heartbeat/ecg'
import { Player, type FrameFn } from './heartbeat/player'
import { HeartAudio } from './heartbeat/audio'
import { Oscilloscope } from './heartbeat/Oscilloscope'
import { Timeline } from './heartbeat/Timeline'
import { Hud } from './heartbeat/Hud'
import { BeatDiagram, HrChart, RhythmCard, ShotsTable, StripProof } from './heartbeat/Explainers'
import type { SceneInfo } from './heartbeat/HeartScene'
import { hasWebGL2 } from './core/hooks'
import './heartbeat/heartbeat.css'

const HeartScene = lazy(() => import('./heartbeat/HeartScene'))

type Speed = '0.25' | '0.5' | '1'

/** where each slab sits, top of the heart first (the scanner stepped downwards) */
const SLAB_WHERE = ['top of the heart', 'upper middle', 'lower middle', 'bottom of the heart']

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** `onSettled` fires once the ECG has loaded (or failed), i.e. once this section has its real height. */
export default function Heartbeat({ onSettled }: { onSettled?: () => void }) {
  const manifest = useApp((s) => s.manifest)
  const [ecg, setEcg] = useState<EcgData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    loadEcg().then((d) => alive && setEcg(d)).catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => { alive = false }
  }, [attempt])
  useEffect(() => { if (ecg || err) onSettled?.() }, [ecg, err, onSettled])
  if (err) {
    return (
      <div className="card" style={{ borderColor: 'rgba(255,92,92,.4)' }}>
        <h3 style={{ color: 'var(--danger)' }}>Couldn't load the ECG</h3>
        <p className="mono muted" style={{ fontSize: 12 }}>{err}</p>
        <button className="btn small" onClick={() => { setErr(null); setAttempt((a) => a + 1) }}>Try again</button>
      </div>
    )
  }
  if (!ecg || !manifest) return <div className="card muted hb-loading"><div className="spinner" /> Loading my ECG…</div>
  return <HeartbeatLab ecg={ecg} manifest={manifest} />
}

function HeartbeatLab({ ecg, manifest }: { ecg: EcgData; manifest: Manifest }) {
  const reduced = useMemo(prefersReducedMotion, [])
  const model = useMemo(() => new Cardio(ecg, manifest.worldCenterLPS[2]), [ecg, manifest])
  const player = useMemo(() => {
    const p = new Player(model)
    p.playing = !reduced
    // Reduced motion: no autoplay, so start on a frame worth looking at: just after the first X-ray,
    // with a full screen of trace behind the playhead and that shot's band on it.
    if (reduced && model.x.length) p.seek(model.x[0].xray[1] + 0.06)
    return p
  }, [model, reduced])
  const bus = useMemo(() => new Set<FrameFn>(), [])
  const audio = useMemo(() => new HeartAudio(), [])
  useEffect(() => () => audio.dispose(), [audio])

  const rootRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(true)
  const [visible, setVisible] = useState(true)
  const [playing, setPlaying] = useState(player.playing)
  const [speed, setSpeed] = useState<Speed>('1')
  const [loop, setLoop] = useState(true)
  const [sound, setSound] = useState(false)
  const [soundErr, setSoundErr] = useState(false)
  const [slowmo, setSlowmo] = useState(true)
  const [beat, setBeat] = useState(-1)
  const [toast, setToast] = useState<{ i: number; key: number } | null>(null)
  const [info, setInfo] = useState<SceneInfo | null>(null)
  const [sceneErr, setSceneErr] = useState<string | null>(null)
  const [webgl] = useState(hasWebGL2)
  const soundRef = useRef(false)
  soundRef.current = sound
  const slowChip = useRef<HTMLSpanElement>(null)
  /** X-ray shot under the playhead at the last frame (-1 none, -2 = re-check after a seek) */
  const lastShot = useRef(-1)

  // pause all work while the section is off-screen
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting
      setVisible(e.isIntersecting)
      player.resetClock()
    }, { threshold: 0.02 })
    io.observe(el)
    return () => io.disconnect()
  }, [player])

  // heart-sound times (S1 just after the QRS, S2 at the end of ejection)
  const sounds = useMemo(() => {
    const s1 = model.R.map((r) => r + 0.035)
    const s2 = model.R.map((r) => r + model.state(r + 0.001).ts + 0.01)
    return { s1, s2 }
  }, [model])

  // the one frame loop
  useEffect(() => {
    let raf = 0
    let lastBeat = -2
    let toastKey = 0
    let wasSlow = false
    let wasPlaying = player.playing
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!visibleRef.current || document.hidden) { player.resetClock(); return }
      const { prev, t, wrapped } = player.tick(now)
      const k = model.beatIndex(t)
      if (k !== lastBeat) { lastBeat = k; setBeat(k) }
      const xi = model.exposureAt(t)
      if (xi !== lastShot.current) {
        if (xi >= 0) setToast({ i: xi, key: ++toastKey })
        lastShot.current = xi
      }
      if (wasPlaying !== player.playing) { wasPlaying = player.playing; setPlaying(player.playing) }
      const slow = player.playing && player.slowmo && model.slowFactor(t) < 0.9
      if (slow !== wasSlow && slowChip.current) { slowChip.current.dataset.on = slow ? '1' : '0'; wasSlow = slow }
      if (soundRef.current && t !== prev) {
        for (const [a, b] of player.crossed(prev, t, wrapped)) {
          for (let i = 0; i < sounds.s1.length; i++) {
            if (sounds.s1[i] > a && sounds.s1[i] <= b) audio.lub()
            if (sounds.s2[i] > a && sounds.s2[i] <= b) audio.dub()
          }
          for (const e of model.x) {
            if (e.xray[0] > a && e.xray[0] <= b) audio.xray((e.xray[1] - e.xray[0]) / Math.max(0.05, player.speed * (player.slowmo ? 0.2 : 1)))
          }
        }
      }
      for (const f of bus) f(t)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [player, model, bus, audio, sounds])

  // the X-ray toast stays up for a few seconds of real time
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(id)
  }, [toast])

  // ---- controls
  const play = useCallback((on: boolean) => {
    if (on && !player.loop && player.t >= player.duration - 0.01) player.seek(0)
    player.playing = on
    player.resetClock()
    setPlaying(on)
  }, [player])
  const seek = useCallback((t: number) => {
    player.seek(t)
    // a toast from before the jump no longer matches the playhead; the next frame re-checks
    setToast(null)
    lastShot.current = -2
    for (const f of bus) f(player.t)
  }, [player, bus])
  const heroRef = useRef<HTMLDivElement>(null)
  const jumpToShot = useCallback((i: number, scroll = false) => {
    const e = model.x[i]
    if (!e) return
    // ~1.6 s of run-up, but start after the previous shot's slow-motion so it doesn't replay first
    const prevEnd = i > 0 ? model.x[i - 1].xray[1] + 0.3 : -Infinity
    seek(Math.max(e.xray[0] - 1.6, prevEnd))
    play(true)
    if (scroll) heroRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [model, seek, play, reduced])
  const onSpeed = (v: Speed) => { setSpeed(v); player.speed = Number(v) }
  const onLoop = (v: boolean) => { setLoop(v); player.loop = v }
  const onSlow = (v: boolean) => { setSlowmo(v); player.slowmo = v }
  const onSound = async (v: boolean) => {
    if (v) {
      const ok = await audio.enable()
      setSoundErr(!ok)
      setSound(ok)
    } else {
      setSound(false)
      void audio.disable()
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return     // buttons and toggles inside handle their own keys
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); play(!player.playing) }
    else if (e.key === 'ArrowRight') seek(player.t + 1)
    else if (e.key === 'ArrowLeft') seek(player.t - 1)
  }

  // dev/test hook (used by the screenshot script)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __heartbeat?: unknown }
    w.__heartbeat = { player, model, seek, play }
    return () => { delete w.__heartbeat }
  }, [player, model, seek, play])

  const ex = ecg.exposures
  const beamMs = ex.reduce((s, e) => s + e.durationMs, 0)
  const t = toast ? ex[toast.i] : null
  const cov = toast && info ? info.coverage[toast.i] : null
  const glbBytes = manifest.meshes.heartBytes ?? manifest.meshes.bytes

  return (
    <div className="hb" ref={rootRef}>
      <p className="hb-lede">
        For {ecg.duration.toFixed(0)} seconds the scanner watched my ECG to decide exactly when to fire its X-rays.
        This is that ECG, digitized from the scanner's own printout and played back in real time, driving a 3D model
        of my heart built from the same scan.
      </p>

      <div className="hb-hero" ref={heroRef} tabIndex={0} onKeyDown={onKey} aria-label="Heartbeat player. Space toggles play.">
        <div className="hb-stage">
          <div className="hb-view">
          {webgl && !sceneErr ? (
            <Suspense fallback={<div className="hb-stage-msg"><div className="spinner" /><span>Loading the 3D heart…</span></div>}>
              <HeartScene
                model={model}
                player={player}
                manifest={manifest}
                active={visible}
                autoRotate={!reduced}
                onReady={setInfo}
                onError={setSceneErr}
              />
              {!info && (
                <div className="hb-stage-msg">
                  <div className="spinner" />
                  <span>Loading my 3D heart · {formatBytes(glbBytes)}</span>
                </div>
              )}
            </Suspense>
          ) : (
            <div className="hb-stage-msg hb-stage-err">
              <span style={{ fontSize: 28 }}>🫀</span>
              <b>{sceneErr ? "The 3D heart couldn't load." : "This browser can't show the 3D heart (WebGL2 is off)."}</b>
              <span>The ECG below still plays.</span>
              {sceneErr && <span className="mono faint hb-err-detail">{sceneErr}</span>}
            </div>
          )}
          {!reduced && toast && <div key={`flash-${toast.key}`} className="hb-flash" aria-hidden />}

          <div className="hb-tags">
            <span className={`chip hb-live ${playing ? 'on' : ''}`}><span className="dot" />{playing ? 'Replaying' : 'Paused'}</span>
            <span className="chip">ECG channel {ecg.header.channel}</span>
            <span className="chip">{speed}×</span>
            <span ref={slowChip} className="chip info hb-slow" data-on="0">slow-motion</span>
          </div>

          <div className="hb-legend3d" aria-hidden>
            <span><i style={{ background: '#ff5d6c' }} />left heart (oxygen-rich)</span>
            <span><i style={{ background: '#5f80ff' }} />right heart</span>
            <span><i className="glow" />electrical wave</span>
            <span><i style={{ background: '#5dffb0' }} />X-ray beam ring</span>
          </div>

          {toast && t && (
            <div key={`toast-${toast.key}`} className="hb-toast" role="status">
              <div className="hb-toast-title">📸 X-ray {t.n} of {ex.length}</div>
              <div>
                The scanner fired here, at <b>{Math.round(t.phase.xrayCenter * 100)}%</b> of this heartbeat, when the heart is stillest.
              </div>
              <div className="hb-toast-sub">
                {t.durationMs} ms of X-ray · slab {t.n} of {ex.length} ({SLAB_WHERE[Math.min(SLAB_WHERE.length - 1, Math.round((t.n - 1) * (SLAB_WHERE.length - 1) / Math.max(1, ex.length - 1)))]})
                {cov && cov.length ? `: ${cov.slice(0, 3).join(', ')}` : ''}
              </div>
            </div>
          )}
          </div>
          <Hud player={player} model={model} bus={bus} beat={beat} />
        </div>

        <Oscilloscope player={player} model={model} bus={bus} />
        <Timeline player={player} model={model} bus={bus} onSeek={seek} />

        <div className="hb-controls">
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary hb-play" onClick={() => play(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button className="btn" onClick={() => { seek(0); play(true) }} title="Back to the start">↺ Restart</button>
            <button className="btn cyan" onClick={() => jumpToShot(0)} title="Skip to just before the first X-ray">⚡ Jump to the X-rays</button>
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            <Segmented<Speed>
              value={speed}
              onChange={onSpeed}
              options={[
                { value: '0.25', label: '0.25×', title: 'Quarter speed' },
                { value: '0.5', label: '0.5×', title: 'Half speed' },
                { value: '1', label: '1×', title: 'Real time' },
              ]}
            />
            <Toggle label="Loop" checked={loop} onChange={onLoop} />
            <Toggle label={soundErr ? 'Lub-dub (unavailable)' : 'Lub-dub sound'} checked={sound} onChange={(v) => void onSound(v)} />
            <Toggle label="Slow-mo X-rays" checked={slowmo} onChange={onSlow} />
          </div>
        </div>
      </div>

      <div className="hb-facts">
        <div className="stat"><div className="v">{ecg.rhythm.beats}</div><div className="k">heartbeats recorded</div></div>
        <div className="stat"><div className="v">{ecg.rhythm.hrPrintedRange[0]}–{ecg.rhythm.hrPrintedRange[1]}<small>bpm</small></div><div className="k">heart rate, beat by beat</div></div>
        <div className="stat"><div className="v">{ex.length}</div><div className="k">X-ray shots, every 2nd beat</div></div>
        <div className="stat"><div className="v">{(beamMs / 1000).toFixed(2)}<small>s</small></div><div className="k">total beam-on time</div></div>
      </div>

      <div className="grid grid-2 hb-cards">
        <div className="card">
          <div className="eyebrow">How prospective ECG triggering works</div>
          <p className="hb-explain">
            The scanner watched this ECG live. After each R wave (the tall spike) it predicted when the next beat would
            arrive from the previous ones, and switched the X-ray on for just ~0.16 s centred at {ecg.header.scanPhase.split(' ')[0]} of
            the beat: mid-to-late diastole, when the heart is relaxed and almost still. Then the table moved about 3.5 cm during the
            next beat and it fired again: {ex.length} shots, every second heartbeat, covering the whole heart in{' '}
            {(ex[ex.length - 1].xray[1] - ex[0].xray[0]).toFixed(1)} s while keeping the dose low.
          </p>
          <BeatDiagram model={model} />
          <p className="hb-note muted">
            One real beat from the recording (shot {ecg.exposures[2]?.n ?? 1}). The percentages count from the scanner's own R trigger.
            Green band: X-ray on. Outlined box: the slice of data used for the images ("Recon phase: {ecg.header.reconPhase}").
            Amber: how the ventricles' size changes, from a textbook model.
          </p>
        </div>
        <div className="card hb-chart-card">
          <div className="eyebrow">Beat by beat</div>
          <h3 style={{ marginTop: 6 }}>My heart rate climbed from {Math.round(ecg.rhythm.hrFirst8Avg)} to {Math.round(ecg.rhythm.hrLast8Avg)} bpm</h3>
          <HrChart data={ecg} beat={beat} />
          <p className="hb-note muted">
            The scanner prints the rate of every beat, and also summarised the X-ray period: average {ecg.header.hrXray.avg}, min {ecg.header.hrXray.min},
            max {ecg.header.hrXray.max} bpm. It has to predict each beat, so a faster heart makes the timing harder;
            here its aim was within {Math.max(...ex.map((e) => Math.abs(e.predicted.errorMs)))} ms of 75% of the last beat's length.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">The four shots</div>
        <p className="muted" style={{ marginTop: 6 }}>
          Step and shoot: each shot imaged a {ex[0].tablePosition ? Math.abs(ex[0].tablePosition[1] - ex[0].tablePosition[0]).toFixed(1) : '34.5'} mm thick slab,
          top of the heart first. Press a shot to replay it.
        </p>
        <ShotsTable data={ecg} coverage={info?.coverage ?? null} onJump={(i) => jumpToShot(i, true)} />
      </div>

      <div className="grid grid-2 hb-cards">
        <div className="card">
          <div className="eyebrow">Rhythm check · what a cardiologist would glance at</div>
          <RhythmCard data={ecg} />
        </div>
        <div className="card">
          <div className="eyebrow">What's real and what's modelled</div>
          <ul className="hb-real">
            <li><span className="chip good">real</span> The ECG trace, every beat time, every heart rate number, the four X-ray windows and their table positions: all measured from the scanner's printout.</li>
            <li><span className="chip good">real</span> The heart's shape: segmented by AI from this CT scan.</li>
            <li><span className="chip info">model</span> The motion. The CT is a single still frame (taken at 76% of a beat), so the squeeze, the twist and the electrical waves follow a textbook model timed to my real ECG.</li>
            <li><span className="chip info">model</span> The lub-dub sounds are synthesised at the moments the valves close.</li>
          </ul>
        </div>
      </div>

      <details className="card hb-proof">
        <summary>
          <span className="eyebrow">From pixels to signal</span>
          <span className="hb-proof-title">See the scanner's original printout, with my digitized trace on top</span>
        </summary>
        <StripProof data={ecg} />
      </details>
    </div>
  )
}
