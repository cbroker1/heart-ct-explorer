/**
 * Slice Explorer (#/slices): a multiplanar CT viewer drawn with raw WebGL2 in one canvas.
 * See src/pages/slices/ for the renderer, geometry, controller and chrome.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadJSON, type Vec3 } from '../lib/data'
import type { CalciumReport } from '../lib/reports'
import { useApp } from '../lib/store'
import { LoaderOverlay } from '../components/ui'
import { Hint, StatusBar, Toolbar, ViewChrome } from './slices/Chrome'
import { cpuVolume, SliceController, type ExamCaliperJSON } from './slices/controller'
import { applyDeepLink, parseDeepLink } from './slices/deeplink'
import { dist, volumeByKey } from './slices/geom'
import { useSlots } from './slices/model'
import { viewOnBlankSlice } from './slices/probe'
import { Sidebar } from './slices/Sidebar'
import { useLoad, useSlc } from './slices/state'
import './slices/slices.css'

export default function Slices() {
  const manifest = useApp((s) => s.manifest)!
  const hostRef = useRef<HTMLDivElement>(null)
  const [ctrl, setCtrl] = useState<SliceController | null>(null)
  const [calcium, setCalcium] = useState<CalciumReport | null>(null)
  const [caliper, setCaliper] = useState<ExamCaliperJSON | null>(null)
  /** point of the last deep link, until it has been matched against the calcium candidates */
  const [linkPoint, setLinkPoint] = useState<Vec3 | null>(null)

  // Session defaults + deep links (before the controller starts loading anything).
  useLayoutEffect(() => {
    const link = parseDeepLink(window.location.hash, manifest)
    // the store defaults to the whole-chest soft-tissue series; fall back if this manifest lacks it
    if (!volumeByKey(manifest, useApp.getState().sliceSeries)) useApp.getState().setSliceSeries(manifest.volumes[0].key)
    const slc = useSlc.getState()
    if (!slc.layoutChosen && !link?.layout && window.matchMedia('(max-width: 820px)').matches) slc.set({ layout: 'single' })
    const apply = (d: ReturnType<typeof parseDeepLink>) => {
      if (!d) return
      applyDeepLink(d)
      if (d.lps) setLinkPoint(d.lps)
    }
    apply(link)
    const onHash = () => apply(parseDeepLink(window.location.hash, manifest))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [manifest])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const c = new SliceController(host, manifest)
    setCtrl(c)
    return () => {
      c.dispose()
      setCtrl(null)
    }
  }, [manifest])

  useEffect(() => {
    let alive = true
    loadJSON<CalciumReport>(manifest.files.calcium ?? 'calcium.json').then((r) => { if (alive) setCalcium(r) }).catch(() => {})
    loadJSON<{ radiologistMeasurement?: ExamCaliperJSON }>(manifest.files.exam ?? 'exam.json')
      .then((e) => { if (alive) setCaliper(e.radiologistMeasurement ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [manifest])

  useEffect(() => { ctrl?.setReports(calcium, caliper) }, [ctrl, calcium, caliper])

  // A link that lands on a calcium candidate's centre (e.g. "candidate #22" from the AI Read page) selects
  // it, so its ring is highlighted and numbered just as if it had been clicked.
  useEffect(() => {
    if (!calcium || !linkPoint) return
    let best: number | null = null
    let bestD = 1.5 // mm
    for (const c of calcium.candidates) {
      const d = dist(c.centerLPS, linkPoint)
      if (d <= bestD) { bestD = d; best = c.id }
    }
    if (best !== null) useApp.getState().setSelectedLesion(best)
    setLinkPoint(null)
  }, [calcium, linkPoint])

  return (
    <div className="viewer slc">
      <div className="stage slc-stage">
        <Toolbar ctrl={ctrl} />
        <div className="slc-views">
          <div className="slc-canvas-host" ref={hostRef} />
          <ViewsChrome ctrl={ctrl} />
          <StageStatus ctrl={ctrl} />
        </div>
        <StatusBar manifest={manifest} calcium={calcium} />
      </div>
      <Sidebar manifest={manifest} calcium={calcium} caliper={caliper} />
    </div>
  )
}

function ViewsChrome(props: { ctrl: SliceController | null }) {
  const manifest = useApp((s) => s.manifest)!
  const slots = useSlots(manifest)
  const layout = useSlc((s) => s.layout)
  const glError = useLoad((s) => s.glError)
  if (glError) return null
  return (
    <>
      {slots.map((sl) => (
        <ViewChrome key={`${layout}-${sl.i}`} sl={sl} ctrl={props.ctrl} multi={slots.length > 1} canEnlarge={layout === '3up' && sl.i > 0} />
      ))}
      {slots[0] && !viewOnBlankSlice(slots[0], cpuVolume(slots[0].key)) && <Hint rect={slots[0].rect} />}
    </>
  )
}

/** Loader / error / no-WebGL2 states for the stage. */
function StageStatus(props: { ctrl: SliceController | null }) {
  const manifest = useApp((s) => s.manifest)!
  const req = useApp((s) => s.sliceSeries)
  const layout = useSlc((s) => s.layout)
  const partner = useSlc((s) => s.partner)
  const entries = useLoad((s) => s.entries)
  const glError = useLoad((s) => s.glError)
  if (glError) {
    return (
      <div className="slc-blocker">
        <div className="card">
          <h3>3D graphics unavailable</h3>
          <p className="muted">{glError}</p>
          <p className="muted" style={{ marginBottom: 0 }}>Try a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.</p>
        </div>
      </div>
    )
  }
  const need = layout === 'compare' && partner !== req ? [req, partner] : [req]
  const failed = need.find((k) => entries[k]?.phase === 'error')
  if (failed) {
    const v = volumeByKey(manifest, failed)
    return (
      <div className="slc-blocker">
        <div className="card">
          <h3 style={{ color: 'var(--danger)' }}>Could not load {v?.label ?? failed}</h3>
          {/^This series is \d+ voxels/.test(entries[failed]?.error ?? '') ? (
            <p className="muted">{entries[failed]?.error} Pick another series in the list.</p>
          ) : (
            <>
              <p className="muted">Check your internet connection, then try again.</p>
              <p className="mono faint" style={{ fontSize: 12 }}>{entries[failed]?.error}</p>
            </>
          )}
          <button className="btn cyan" onClick={() => props.ctrl?.retry(failed)}>Try again</button>
        </div>
      </div>
    )
  }
  const pending = need.filter((k) => entries[k]?.phase !== 'ready')
  if (!pending.length) return null
  let loaded = 0
  let total = 0
  let uploading = false
  for (const k of pending) {
    const e = entries[k]
    const v = volumeByKey(manifest, k)
    if (!v) continue
    if (e?.phase === 'upload') {
      uploading = true
      loaded += e.total ? (e.loaded / e.total) * v.rawBytes : 0
      total += v.rawBytes
    } else {
      loaded += e?.loaded ?? 0
      total += e?.total || v.bytes
    }
  }
  const names = pending.map((k) => volumeByKey(manifest, k)?.label ?? k).join(' + ')
  return <LoaderOverlay label={uploading ? `Sending ${names} to the GPU…` : `Loading ${names}…`} loaded={loaded} total={total} />
}
