import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dataUrl } from '../../lib/data'
import { useApp } from '../../lib/store'
import { navigate, Segmented } from '../../components/ui'
import { VerdictChip, Votes } from './Gallery'
import {
  candidateBreakdown, chamberLabel, densityWeight, fmtNum, fmtScore, pct, sheetUrl, sliceViewerLink, verdict,
} from './model'
import type { CalciumVM } from './useCalciumData'

const SHEET_W = 1500, SHEET_H = 340, PANEL = 300

function Panels({ id, peak, nz, fov, thr }: { id: number; peak: number; nz: number; fov: number | null; thr: number }) {
  const url = dataUrl(sheetUrl(id))
  const [layout, setLayout] = useState<'panels' | 'raw' | 'loading' | 'error'>('loading')
  useEffect(() => {
    let alive = true
    setLayout('loading')
    const im = new Image()
    im.onload = () => alive && setLayout(im.naturalWidth === SHEET_W && im.naturalHeight === SHEET_H ? 'panels' : 'raw')
    im.onerror = () => alive && setLayout('error')
    im.src = url
    return () => { alive = false }
  }, [url])
  const cl = (k: number) => Math.min(Math.max(k, 0), Math.max(0, nz - 1))
  const caps = [
    { t: 'Context', s: fov ? `whole ${Math.round(fov)} mm field of view` : 'whole field of view' },
    { t: 'Peak slice', s: 'plain, no overlay' },
    { t: `Slice ${cl(peak - 1)}`, s: 'one below' },
    { t: `Slice ${peak}`, s: 'peak slice' },
    { t: `Slice ${cl(peak + 1)}`, s: 'one above' },
  ]
  const [view, setView] = useState<'panels' | 'original'>('panels')
  if (layout === 'error') return <div className="cal-sheet-missing muted">Review sheet not available.</div>
  if (layout === 'raw') return <img className="cal-sheet-raw" src={url} alt={`Review sheet for candidate ${id}`} />
  const toggle = (
    <div className="cal-sheet-toggle">
      <Segmented<'panels' | 'original'> value={view} onChange={setView}
        options={[{ value: 'panels', label: 'Panels' }, { value: 'original', label: 'Original sheet' }]} />
    </div>
  )
  if (view === 'original') {
    return (
      <div>
        {toggle}
        <div className="cal-sheet-scroll"><img className="cal-sheet-raw" src={url} alt={`Review sheet for candidate ${id}`} /></div>
      </div>
    )
  }
  return (
    <div className={`cal-panels ${layout === 'loading' ? 'loading' : ''}`}>
      {toggle}
      {caps.map((c, i) => (
        <figure key={i} className="cal-panel">
          <div className="cal-panel-img" role="img" aria-label={`${c.t}: ${c.s}`}
            style={{
              backgroundImage: layout === 'panels' ? `url("${url}")` : undefined,
              backgroundSize: `${(SHEET_W / PANEL) * 100}% ${(SHEET_H / PANEL) * 100}%`,
              backgroundPosition: `${(i / (SHEET_W / PANEL - 1)) * 100}% 100%`,
            }} />
          <figcaption><b>{c.t}</b> <span>{c.s}</span></figcaption>
        </figure>
      ))}
      <div className="cal-panel-key muted">
        <span><i style={{ background: '#ffd91a' }} /> this candidate (≥{thr} HU)</span>
        <span><i style={{ background: '#e85a5a' }} /> other pixels ≥{thr} HU</span>
        <span><i style={{ background: 'transparent', border: '2px solid #00ffff' }} /> zoomed area</span>
      </div>
    </div>
  )
}

export default function CandidateModal({ vm, id, onClose, onNav }: {
  vm: CalciumVM; id: number; onClose: () => void; onNav: (id: number) => void
}) {
  const c = vm.candidates.find((x) => x.id === id)
  const idx = vm.candidates.findIndex((x) => x.id === id)
  const prev = idx > 0 ? vm.candidates[idx - 1] : null
  const next = idx >= 0 && idx < vm.candidates.length - 1 ? vm.candidates[idx + 1] : null
  const box = useRef<HTMLDivElement>(null)
  const setCursor = useApp((s) => s.setCursor)
  const setSelectedLesion = useApp((s) => s.setSelectedLesion)
  const setSliceSeries = useApp((s) => s.setSliceSeries)

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => { prevFocus?.focus?.() }
  }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft' && prev) onNav(prev.id)
      else if (e.key === 'ArrowRight' && next) onNav(next.id)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose, onNav, prev, next])

  if (!c) return null
  const m = vm.method
  const v = verdict(c.finalClass)
  const bd = candidateBreakdown(c, m)
  const lps = c.centerLPS
  const fov = vm.vol ? vm.vol.dims[0] * vm.vol.spacing[0] : null
  const openSlices = () => {
    setSliceSeries('calcium')
    setSelectedLesion(c.id)
    setCursor(lps)
    onClose()
    navigate(sliceViewerLink(lps))
  }
  const facts: [string, string, string][] = [
    ['Peak', `${fmtNum(c.peakHU, 0)} HU`, `Brightest pixel (density weight ×${densityWeight(c.peakHU, m.bands)})`],
    ['Mean', `${fmtNum(c.meanHU, 0)} HU`, 'Average over all its pixels'],
    ['Area', `${fmtNum(c.areaSum_mm2, 2)} mm²`, `Summed over its slices; largest single slice ${fmtNum(c.maxArea_mm2, 2)} mm²`],
    ['Volume', `${fmtNum(c.volume_mm3, 1)} mm³`, 'Voxel count × voxel volume'],
    ['Slices', c.slices.join(', '), `${c.nSlices} × ${m.thickness} mm slice${c.nSlices === 1 ? '' : 's'}`],
    ['Depth in heart', `${fmtNum(c.depthInHeart_mm.min, 1)} mm`, `Closest point to the heart surface (mean ${fmtNum(c.depthInHeart_mm.mean, 1)} mm). Coronaries run on the surface, near 0.`],
    ['To aorta', `${fmtNum(c.distToAorta_mm, 1)} mm`, 'Shortest distance to the aorta segmentation'],
    ['Inside', `heart ${pct(c.fracInHeart)} · sac ${pct(c.fracInPericardium)}`, `Share of its voxels inside the heart / pericardial sac (aorta ${pct(c.fracInAorta)}, liver ${pct(c.fracInLiver)})`],
    ['Where', chamberLabel(c.chamber, vm.manifest), 'Which structure the AI segmentation puts it in'],
  ]

  return createPortal(
    <div className="cal-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cal-modal panel" role="dialog" aria-modal="true" aria-labelledby="cal-modal-title" tabIndex={-1} ref={box}
        style={{ ['--v' as string]: v.color }}>
        <header className="cal-modal-head">
          <div className="row wrap" style={{ gap: 10 }}>
            <h2 id="cal-modal-title" className="mono">Candidate #{c.id}</h2>
            <VerdictChip cls={c.finalClass} />
            {c.artery && <span className="chip">{c.artery}</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" disabled={!prev} onClick={() => prev && onNav(prev.id)} aria-label="Previous candidate">←</button>
            <span className="muted mono" style={{ fontSize: 12 }}>{idx + 1}/{vm.candidates.length}</span>
            <button className="btn small" disabled={!next} onClick={() => next && onNav(next.id)} aria-label="Next candidate">→</button>
            <button className="btn small ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>
        <div className="cal-modal-scroll">
          <Panels id={c.id} peak={c.peakSlice} nz={vm.vol?.dims[2] ?? 1e9} fov={fov} thr={m.threshold} />
          <div className="cal-modal-grid">
            <div>
              <h3>Measurements</h3>
              <dl className="cal-facts">
                {facts.map(([k, val, hint]) => (
                  <div key={k} title={hint}>
                    <dt>{k}</dt>
                    <dd><span className="mono">{val}</span><small>{hint}</small></dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3>Verdict</h3>
              <p className="cal-modal-v">{v.blurb}</p>
              <div className="cal-modal-rule">
                <div className="eyebrow">Automatic rules</div>
                {c.ruleReasons.length ? (
                  <ul>{c.ruleReasons.map((r) => <li key={r}>{r}</li>)}</ul>
                ) : (
                  <p className="muted">No rule fired, so it was flagged for review ({verdict(c.ruleClass).label.toLowerCase()}).</p>
                )}
              </div>
              {(c.reviewNote || c.reviewVotes?.length) && (
                <div className="cal-modal-rule">
                  <div className="eyebrow">AI reviewers</div>
                  {c.reviewNote && <p>{c.reviewNote}</p>}
                  <Votes c={c} />
                  {c.reviewVotes?.some((x) => x.note) && (
                    <ul className="cal-vote-notes">
                      {c.reviewVotes.filter((x) => x.note).map((x, i) => <li key={i}><b>{x.reviewer}:</b> {x.note}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div className="cal-modal-rule">
                <div className="eyebrow">{v.counted ? 'Its contribution to the score' : 'If it were coronary plaque'}</div>
                <p className="mono cal-arith">
                  ({bd.rows.map((r) => `${fmtNum(r.area, 2)}×${r.weight}`).join(' + ')}) × {m.overlap} = <b>{fmtScore(+bd.score.toFixed(1))}</b>
                </p>
                <p className="muted" style={{ fontSize: 12 }}>area (mm²) × density weight on each slice, summed, × the overlap correction. {v.counted ? 'Counted.' : 'Not counted, so it adds 0.'}</p>
              </div>
              <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn cyan" onClick={openSlices}>Open in slice viewer →</button>
                <a className="btn ghost" href={dataUrl(sheetUrl(c.id))} target="_blank" rel="noreferrer">Original review sheet ↗</a>
              </div>
              <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
                centre LPS {lps.map((q) => q.toFixed(1)).join(', ')} mm · peak on slice {c.peakSlice}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
