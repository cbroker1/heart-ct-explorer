/** Small, honest visuals for "My body, by the numbers": range gauge, chambers, spine levels, lobes, radiation. */
import { useMemo, type CSSProperties, type ReactElement, type SVGProps } from 'react'
import { useCountUp, useInView } from './hooks'
import { PicBanana, PicPlane, PicSun, PicXray } from './icons'
import type { ChamberDetail, Equivalent, Gauge as GaugeT, LevelDetail, LobeDetail, SpecItem } from './types'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const fmtTick = (v: number) => (Math.abs(v) < 2 && v % 1 !== 0 ? v.toFixed(1) : `${Math.round(v)}`)

/** Value on a reference scale: coloured zones (each labelled), a marker, and boundary ticks. */
export function Gauge(props: { gauge: GaugeT; value: number; display: string; unit: string; label: string }) {
  const { gauge, value, display, unit, label } = props
  const [ref, seen] = useInView<HTMLDivElement>('0px')
  const span = gauge.max - gauge.min || 1
  const pos = clamp01((value - gauge.min) / span)
  const zone = gauge.zones.find((z) => value >= z.from && value < z.to) ?? gauge.zones[gauge.zones.length - 1]
  const ticks = gauge.ticks ?? []
  const aria = `${label}: ${display} ${unit}. ${zone ? `In the "${zone.label}" band.` : ''} Scale ${gauge.min} to ${gauge.max}${unit ? ' ' + unit : ''}; bands: ${gauge.zones.map((z) => `${z.label} ${z.from}-${z.to}`).join(', ')}.`
  return (
    <div ref={ref} className="lc-gauge" role="img" aria-label={aria}>
      <div className="bar">
        {gauge.zones.map((z) => (
          <div key={z.label + z.from} className={`zone ${z.tone}`} style={{ flexGrow: (z.to - z.from) / span }} title={`${z.label}: ${z.from} to ${z.to} ${unit}`} />
        ))}
      </div>
      <div className="mark" style={{ left: `${(seen ? pos : 0) * 100}%` }}>
        <span style={edgeAlign(pos)}>{display}{value < gauge.min ? ' ◂' : value > gauge.max ? ' ▸' : ''}</span>
      </div>
      <div className="ticks">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${clamp01((t - gauge.min) / span) * 100}%` }}>{fmtTick(t)}</span>
        ))}
      </div>
      <div className="zl">
        {gauge.zones.map((z) => {
          const frac = (z.to - z.from) / span
          return (
            <span key={z.label + z.from} style={{ flexGrow: frac, flexBasis: 0 }}>
              {frac * 100 >= z.label.length * 1.35 ? z.label : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function edgeAlign(pos: number): CSSProperties {
  // keep the value label inside the card near the ends of the scale
  if (pos < 0.08) return { transform: 'translateX(-14%)' }
  if (pos > 0.92) return { transform: 'translateX(-86%)' }
  return {}
}

/** Four chambers in anatomical layout (patient's right on the left), orb area ∝ volume. */
export function Chambers(props: { chambers: ChamberDetail[] }) {
  const max = Math.max(...props.chambers.map((c) => c.ml))
  const order = ['RA', 'LA', 'RV', 'LV']
  const list = order.map((k) => props.chambers.find((c) => c.key === k)).filter(Boolean) as ChamberDetail[]
  return (
    <div>
      <div className="lc-chambers">
        {list.map((c) => {
          const d = 22 + 30 * Math.sqrt(c.ml / max)
          return (
            <div key={c.key} className="lc-ch" title={`${c.label}: ${c.ml} mL (AI estimate)`} style={{ ['--c' as string]: c.color }}>
              <span className="orb" style={{ width: d, height: d }} aria-hidden />
              <div style={{ minWidth: 0 }}>
                <b>{Math.round(c.ml)}<small>mL</small></b>
                <div className="t">{c.label}</div>
                <div className="r">{c.role}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="lc-ch-note"><span>◂ my right side</span><span>my left side ▸</span></div>
    </div>
  )
}

/** Spine levels top-to-bottom like the spine itself; one bar per vertebral body, threshold rules labelled. */
export function Levels(props: { levels: LevelDetail[]; max?: number; thresholds?: { hu: number; label: string }[] }) {
  const [ref, seen] = useInView<HTMLDivElement>('0px')
  const max = props.max ?? 320
  const th = props.thresholds ?? []
  return (
    <div ref={ref}>
      <div className="lc-levels" role="table" aria-label="Trabecular bone density per vertebra">
        {props.levels.map((l) => (
          <div key={l.level} role="row" className={`lc-lv${l.partial ? ' partial' : ''}`} title={`${l.level}: mean ${l.meanHU} HU (median ${l.medianHU}, ${l.n.toLocaleString('en-US')} voxels)${l.partial ? ' · only partly inside the scan, not averaged' : ''}`}>
            <span className="nm" role="rowheader">{l.level}</span>
            <div className="tr" role="cell">
              <div className="fill" style={{ width: `${seen ? clamp01(l.meanHU / max) * 100 : 0}%` }} />
              {th.map((t) => (
                <span key={t.hu} className={`thr${t.hu >= 150 ? ' g' : ''}`} style={{ left: `${clamp01(t.hu / max) * 100}%` }} />
              ))}
            </div>
            <span className="val" role="cell">{Math.round(l.meanHU)} HU{l.partial ? '*' : ''}</span>
          </div>
        ))}
      </div>
      <div className="lc-lv-legend">
        {th.map((t) => (
          <span key={t.hu}><i style={{ borderColor: t.hu >= 150 ? 'rgba(62,224,143,.8)' : 'rgba(255,181,71,.8)' }} />{t.hu} HU · {t.label}</span>
        ))}
        {props.levels.some((l) => l.partial) && <span>* only partly inside the scan (not averaged)</span>}
      </div>
    </div>
  )
}

/** One tall segmented bar per lung (lobes as blocks, 2px gaps), plus the scanner AI's own total as a marker. */
export function Lobes(props: { lobes: LobeDetail[]; clearRead?: { rightL?: number | null; leftL?: number | null } }) {
  const sides: { side: 'R' | 'L'; label: string; color: string; cr?: number | null }[] = [
    { side: 'R', label: 'Right lung', color: '#7fd8c4', cr: props.clearRead?.rightL },
    { side: 'L', label: 'Left lung', color: '#7cc9f2', cr: props.clearRead?.leftL },
  ]
  const totals = sides.map((s) => props.lobes.filter((l) => l.side === s.side).reduce((a, l) => a + l.ml, 0))
  const scaleMax = Math.max(...totals, ...sides.map((s) => (s.cr ?? 0) * 1000)) * 1.04
  const short = (l: LobeDetail) => l.label.replace(/^(Right|Left) /, '').replace(' lobe', '')
  return (
    <div className="lc-lobes">
      {sides.map((s, i) => {
        const lobes = props.lobes.filter((l) => l.side === s.side)
        return (
          <div key={s.side} className="lc-lobe-row">
            <div className="lab"><span>{s.label}</span><b>{(totals[i] / 1000).toFixed(2)} L</b></div>
            <div className="lc-lobe-track">
              <div className="lc-stack" style={{ width: `${(totals[i] / scaleMax) * 100}%` }} role="img"
                aria-label={`${s.label}: ${lobes.map((l) => `${l.label} ${Math.round(l.ml)} mL`).join(', ')}`}>
                {lobes.map((l) => {
                  const share = l.ml / totals[i]
                  return (
                    <div key={l.key} style={{ flexGrow: l.ml, background: s.color }} title={`${l.label}: ${Math.round(l.ml)} mL (AI estimate)`}>
                      {share > 0.22 ? `${short(l)} ${Math.round(l.ml)}` : ''}
                    </div>
                  )
                })}
              </div>
              {s.cr ? <span className="lc-cr" style={{ left: `${((s.cr * 1000) / scaleMax) * 100}%` }} title={`ClearRead CT: ${s.cr} L`} /> : null}
            </div>
          </div>
        )
      })}
      <div className="lc-cr-note"><i /> ClearRead CT (the hospital's own lung software) total for each lung · labels in mL</div>
    </div>
  )
}

const PICS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  sun: PicSun, xray: PicXray, plane: PicPlane, banana: PicBanana,
}

function Pictos(props: { icon: string; count: number; cap: number }) {
  const Pic = PICS[props.icon] ?? PicSun
  const whole = Math.min(props.cap, Math.floor(props.count))
  const frac = props.count - Math.floor(props.count)
  return (
    <div className="lc-icons" aria-hidden>
      {Array.from({ length: whole }, (_, i) => <Pic key={i} />)}
      {whole < props.cap && frac >= 0.25 && <Pic className="part" style={{ clipPath: `inset(0 ${Math.round((1 - frac) * 100)}% 0 0)` }} />}
    </div>
  )
}

function EqTile(props: { eq: Equivalent; start: boolean }) {
  const { eq, start } = props
  const v = useCountUp(eq.value, start, 1300)
  const shown = eq.value >= 100 ? Math.round(v / 10) * 10 : eq.value % 1 ? v.toFixed(1) : Math.round(v)
  const pictoCount = eq.icon === 'banana' ? 0 : eq.value
  return (
    <div className="lc-eq" title={eq.per}>
      <div className="big">≈ {typeof shown === 'number' ? shown.toLocaleString('en-US') : shown}</div>
      <div className="lbl">{eq.label}</div>
      {eq.icon === 'banana'
        ? <div className="lc-icons" aria-hidden>{Array.from({ length: 14 }, (_, i) => <PicBanana key={i} />)}<span className="faint" style={{ fontSize: 11, alignSelf: 'center' }}>…</span></div>
        : <Pictos icon={eq.icon} count={pictoCount} cap={eq.icon === 'sun' ? 0 : 24} />}
      <div className="per">{eq.per}</div>
    </div>
  )
}

/** The scan's dose as days of a year of natural background radiation, plus everyday equivalents. */
export function RadiationViz(props: { mSv: number; equivalents: Equivalent[] }) {
  const [ref, seen] = useInView<HTMLDivElement>('0px')
  const days = props.equivalents.find((e) => e.key === 'background_days')?.value ?? 0
  const lit = Math.round(days)
  const cells = useMemo(() => Array.from({ length: 365 }, (_, i) => i), [])
  const others = props.equivalents.filter((e) => e.key !== 'background_days')
  return (
    <div ref={ref} className="lc-rad">
      <div className="lc-rad-total"><b>{props.mSv.toFixed(2)}</b><span>mSv for the whole scan · about <b className="lc-rad-days">{lit} days</b> of natural background radiation</span></div>
      <div>
        <div className="lc-year" role="img" aria-label={`One year of natural background radiation as 365 squares; this scan equals about ${lit} of them.`}>
          {cells.map((i) => (
            <i key={i} className={seen && i < lit ? 'on' : ''} style={seen && i < lit ? { transitionDelay: `${i * 18}ms` } : undefined}
              title={i < lit ? `Day ${i + 1}: covered by this scan` : undefined} />
          ))}
        </div>
        <div className="lc-year-cap">
          <span>One square = one day of the natural radiation everyone absorbs (US average 3.1 mSv a year). Lit: <b style={{ color: 'var(--heart-2)' }}>{lit} of 365</b>.</span>
        </div>
      </div>
      <div className="lc-eqs">
        {others.map((e) => <EqTile key={e.key} eq={e} start={seen} />)}
      </div>
    </div>
  )
}

/** Small definition list (e.g. the scanner's dose report). */
export function Specs(props: { items: SpecItem[] }) {
  return (
    <dl className="lc-specs-dl">
      {props.items.map((it) => (
        <div key={it.k}>
          <dt>{it.k}</dt>
          <dd><b>{typeof it.v === 'number' ? it.v.toLocaleString('en-US') : it.v}</b>{it.unit && <small> {it.unit}</small>}{it.hint && <span>{it.hint}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
