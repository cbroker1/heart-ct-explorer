/** The key-numbers strip: every value comes from exam.json, calcium.json or the manifest. */
import type { ReactNode } from 'react'
import type { Manifest } from '../../lib/data'
import type { CalciumReport } from '../../lib/reports'
import { useCountUp, useInView } from './hooks'
import { InfoTip } from './InfoTip'
import { ArrowRight } from './icons'
import type { ExamJson } from './types'

/** Standard adult chest DLP-to-effective-dose conversion factor (mSv per mGy·cm). */
const K_CHEST = 0.014
/** Average US natural background radiation, mSv per year. */
const US_BACKGROUND_MSV_YR = 3.1

interface TileProps {
  k: string
  value: number | null
  decimals?: number
  unit?: string
  caption: ReactNode
  tip: ReactNode
  tipLabel: string
  accent: 'heart' | 'cyan' | 'green' | 'amber' | 'violet' | 'text'
  foot?: ReactNode
  start: boolean
  reduced: boolean
  index: number
  format?: (v: number) => string
}

function Tile(p: TileProps) {
  const v = useCountUp(p.value, p.start, p.reduced, 1100 + p.index * 120)
  const txt = v === null ? '–' : p.format ? p.format(v) : v.toFixed(p.decimals ?? 0)
  return (
    <div className={`ovw-stat ovw-acc-${p.accent}`} style={{ ['--i' as string]: p.index }}>
      <div className="ovw-stat-top">
        <span className="ovw-stat-k">{p.k}</span>
        <InfoTip label={`More about the ${p.tipLabel}`}>{p.tip}</InfoTip>
      </div>
      <div className="ovw-stat-v">
        <span className={`ovw-stat-num${v === null ? ' is-loading' : ''}`}>{txt}</span>
        {p.unit && <span className="ovw-stat-unit">{p.unit}</span>}
      </div>
      <div className="ovw-stat-cap">{p.caption}</div>
      {p.foot && <div className="ovw-stat-foot">{p.foot}</div>}
    </div>
  )
}

export function StatsStrip(props: { manifest: Manifest; exam: ExamJson | null; calcium: CalciumReport | null; calciumListed: boolean; reduced: boolean }) {
  const { manifest, exam, calcium, calciumListed, reduced } = props
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, threshold: 0.15 })

  // ---- calcium
  const agatston = calcium ? calcium.totals.agatston : null
  const underReview = calcium ? calcium.candidates.filter((c) => c.finalClass === 'review').length : 0
  const provisional = calcium ? !calcium.reviewed : false
  // "26% of White men and 16% of Black men": straight from calcium.json's literature context.
  const prevalence = (() => {
    const prev = calcium?.percentileContext?.prevalenceNonzero
    if (!prev) return null
    const parts = Object.entries(prev).map(([g, x]) => `${Math.round(x * 100)}% of ${g.replace(/\s+aged.*$/i, '')}`)
    return parts.length ? parts.join(' and ') : null
  })()

  // ---- dose
  const dlp = exam?.dose?.dlpTotal_mGycm ?? null
  const mSv = dlp !== null ? dlp * K_CHEST : null
  const days = mSv !== null ? (mSv / US_BACKGROUND_MSV_YR) * 365 : null

  // ---- aorta caliper -> deep link to the slice viewer at the measurement
  const meas = exam?.radiologistMeasurement
  const aortaLink = meas
    ? `#/slices?series=${encodeURIComponent(meas.series)}&lps=${meas.pointsLPS[0].map((_, a) => ((meas.pointsLPS[0][a] + meas.pointsLPS[1][a]) / 2).toFixed(1)).join(',')}&plane=axial&window=mediastinum`
    : null

  // ---- images
  const totalImages = manifest.volumes.reduce((s, v) => s + v.dims[2], 0)

  const ecg = exam?.ecg
  const phase = (s?: string) => (s ? (/(\d+(?:\.\d+)?)\s*%/.exec(s)?.[1] ?? null) : null)
  const cr = exam?.clearRead

  return (
    <div className="ovw-stats" ref={ref}>
      <Tile
        index={0}
        start={inView}
        reduced={reduced}
        k="Calcium score (DIY)"
        accent="amber"
        value={agatston}
        format={(v) => (Math.round(v * 10) / 10).toString()}
        unit="Agatston"
        caption={
          !calcium
            ? (calciumListed ? 'Loading my own calcium scoring…' : 'Calcium scoring has not been run yet.')
            : (
              <>
                {provisional ? <span className="ovw-flag warn">Provisional</span> : <span className="ovw-flag good">Reviewed</span>}{' '}
                {agatston === 0
                  ? <>No calcified plaque counted in the heart's arteries by my own code{provisional && underReview > 0 ? <>; {underReview} spot{underReview === 1 ? '' : 's'} still under review</> : null}.</>
                  : <>Calcified plaque in the heart's arteries, scored by my own code{provisional ? ', pending review' : ''}.</>}
              </>
            )
        }
        tip={
          <>
            <b>Agatston score</b>: for every calcified spot in a coronary artery (pixels of at least {calcium?.method?.thresholdHU ?? 130} HU),
            area in mm² × a density weight from 1 to 4, summed over all slices. 0 means no calcified plaque was found.
            <br /><br />
            This number comes from this project's own pipeline, <b>not</b> the hospital's software
            {provisional ? ', and stays provisional until every candidate spot has been reviewed' : ''}.
            {prevalence && calcium?.percentileContext && (
              <>
                <br /><br />For context: in a large study of adults aged 30–45, {prevalence} had any coronary calcium at all
                {calcium.percentileContext.url ? <> (<a href={calcium.percentileContext.url} target="_blank" rel="noopener noreferrer">source</a>)</> : null}.
              </>
            )}
          </>
        }
        tipLabel="calcium score"
        foot={<a href="#/calcium" className="ovw-stat-link">Lesion by lesion <ArrowRight size={13} /></a>}
      />
      <Tile
        index={1}
        start={inView}
        reduced={reduced}
        k="Lung nodules (AI)"
        accent="green"
        value={cr ? cr.findings : null}
        unit={cr ? (cr.findings === 1 ? 'nodule' : 'nodules') : undefined}
        caption={cr ? (cr.findings === 0 ? 'The ClearRead AI searched both lungs for nodules and flagged none.' : 'Spots flagged by the ClearRead AI for a radiologist to check.') : 'Loading…'}
        tip={
          cr ? (
            <>
              {cr.note}
              <br /><br />
              ClearRead erases blood vessels from the images so small nodules can't hide behind them. It also measured
              the imaged lung: {cr.lungVolumeRightL.toFixed(1)} L right, {cr.lungVolumeLeftL.toFixed(1)} L left.
            </>
          ) : 'Loading…'
        }
        tipLabel="lung nodules"
        foot={<a href="#/slices?series=cr_vessel_suppress&window=lung" className="ovw-stat-link">Vessel-free lungs <ArrowRight size={13} /></a>}
      />
      <Tile
        index={2}
        start={inView}
        reduced={reduced}
        k="Heart rate"
        accent="heart"
        value={ecg ? ecg.hrAvg : null}
        unit="bpm"
        caption={ecg ? <>Average while the scan ran, between {ecg.hrMin} and {ecg.hrMax} beats per minute.</> : 'Loading…'}
        tip={
          ecg ? (
            <>
              The scanner watched my ECG and only switched the X-rays on around {phase(ecg.scanPhase) ?? ecg.scanPhase}% of the way through a
              heartbeat, when the heart is relatively still{exam?.dose?.mode && /(\d+)\s*steps/.test(exam.dose.mode) ? `, moving the table in ${/(\d+)\s*steps/.exec(exam.dose.mode)![1]} steps` : ''}.
              The images were reconstructed at the calmest moment it found
              ({phase(ecg.reconPhase) ? `${phase(ecg.reconPhase)}%` : ecg.reconPhase}, in diastole, while the heart relaxes and fills).
            </>
          ) : 'Loading…'
        }
        tipLabel="heart rate"
        foot={<a href="#/lab" className="ovw-stat-link">Beating heart lab <ArrowRight size={13} /></a>}
      />
      <Tile
        index={3}
        start={inView}
        reduced={reduced}
        k="Radiation dose"
        accent="cyan"
        value={mSv}
        decimals={2}
        unit="mSv"
        caption={days !== null ? <>About <b>{Math.round(days)}&nbsp;days</b> of natural background radiation (US average).</> : 'Loading…'}
        tip={
          dlp !== null && mSv !== null && days !== null ? (
            <div className="ovw-math">
              <div className="ovw-math-title">Show me the math</div>
              <div>Effective dose ≈ DLP × k</div>
              <div>= {dlp.toFixed(2)} mGy·cm × {K_CHEST} mSv/(mGy·cm)</div>
              <div>= <b>{mSv.toFixed(2)} mSv</b></div>
              <div className="ovw-math-gap">US natural background ≈ {US_BACKGROUND_MSV_YR} mSv per year</div>
              <div>{mSv.toFixed(2)} ÷ {US_BACKGROUND_MSV_YR} × 365 ≈ <b>{Math.round(days)} days</b></div>
              <p className="ovw-math-note">
                DLP (dose-length product) is from the scanner's dose report; k = {K_CHEST} is the standard conversion factor for an adult chest.
                It's a population estimate, not a personal dose.
                {exam?.dose ? ` Scanner also reported CTDIvol ${exam.dose.ctdivol_mGy} mGy and size-specific dose ${exam.dose.ssde_mGy} mGy.` : ''}
              </p>
            </div>
          ) : 'Loading…'
        }
        tipLabel="radiation dose"
      />
      <Tile
        index={4}
        start={inView}
        reduced={reduced}
        k="Ascending aorta"
        accent="violet"
        value={meas ? meas.lengthMM : null}
        decimals={1}
        unit="mm"
        caption={meas ? 'Width of the main artery as it leaves the heart: the radiologist\'s caliper.' : 'Loading…'}
        tip={
          meas ? (
            <>
              A caliper the radiologist drew on this exam: the diameter of the ascending aorta, measured on the axial
              soft-tissue series (image {meas.instance}). The AI Read page puts it in context.
            </>
          ) : 'Loading…'
        }
        tipLabel="ascending aorta"
        foot={aortaLink ? <a href={aortaLink} className="ovw-stat-link">Caliper slice <ArrowRight size={13} /></a> : undefined}
      />
      <Tile
        index={5}
        start={inView}
        reduced={reduced}
        k="Images"
        accent="text"
        value={totalImages}
        format={(v) => Math.round(v).toLocaleString('en-US')}
        unit="slices"
        caption={<>Cross-sections across {manifest.volumes.length} CT series, every one explorable here.</>}
        tip={
          <div className="ovw-series-list">
            {manifest.volumes.map((v) => (
              <div key={v.key}><span>{v.label}</span><b>{v.dims[2]}</b></div>
            ))}
          </div>
        }
        tipLabel="images in the exam"
        foot={<a href="#/slices" className="ovw-stat-link">Slice viewer <ArrowRight size={13} /></a>}
      />
    </div>
  )
}
