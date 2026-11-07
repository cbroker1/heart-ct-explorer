/** One body system: summary, findings, pertinent negatives, measurements and images. */
import { useRef, useState } from 'react'
import { plural, statusMeta, type NChecked, type NDismissed, type NFinding, type NImage, type NMeasurement, type NSystem } from './model'
import { useRead } from './ctx'
import { useLightbox, Thumb } from './Lightbox'
import { FindingCard } from './FindingCard'
import { StatusChip } from './bits'
import { IcCheck, IcChevron, IcDot, IcGavel, IcImage, IcList, IcMinus, IcRuler, IcShield, SystemIcon } from './icons'

export interface HiddenInfo { artifacts: number; refuted: number; severity: number }

function describeHidden(h: HiddenInfo): string {
  const parts = [
    h.artifacts ? plural(h.artifacts, 'imaging-artifact note') : '',
    h.refuted ? plural(h.refuted, 'refuted finding') : '',
    h.severity ? `${plural(h.severity, 'finding')} outside your severity filter` : '',
  ].filter(Boolean)
  return `Hidden: ${parts.join(' · ')}.`
}

export function SystemSection(props: {
  sys: NSystem
  index: number
  total: number
  visible: NFinding[]
  hidden: HiddenInfo
  onShowAll: () => void
}) {
  const { sys, index, total, visible, hidden, onShowAll } = props
  const st = statusMeta(sys.status)
  const nHidden = sys.findings.length - visible.length

  return (
    <section id={sys.anchor} className={`rd-sys rd-tone-${st.tone}`} aria-labelledby={`${sys.anchor}-h`}>
      <header className="rd-sys-head">
        <span className="rd-sys-icon"><SystemIcon k={sys.key} size={24} /></span>
        <div className="grow">
          <div className="eyebrow">System {index + 1} of {total}</div>
          <h2 id={`${sys.anchor}-h`}>{sys.title}</h2>
        </div>
        <StatusChip status={sys.status} />
      </header>
      {sys.summary && <p className="rd-sys-summary">{sys.summary}</p>}

      <div className="rd-sub">
        <span>Findings</span>
        <span className="rd-sub-count mono">{sys.findings.length}</span>
      </div>
      {sys.findings.length === 0 ? (
        <div className="rd-nofind">
          <span className="rd-nofind-ic"><IcShield size={18} /></span>
          <div>
            <b>Nothing flagged in this system.</b>
            <span className="muted"> {sys.checked.length ? `${plural(sys.checked.length, 'specific item')} checked; see the list below.` : 'The reviewer recorded no findings here.'}</span>
          </div>
        </div>
      ) : (
        <div className="rd-findings">
          {visible.map((f) => <FindingCard key={f.id} f={f} />)}
          {nHidden > 0 && (
            <div className="rd-hidden-note rd-noprint">
              <span>{describeHidden(hidden)}</span>
              <button type="button" className="btn small" onClick={onShowAll}>Show {nHidden === 1 ? 'it' : 'them'}</button>
            </div>
          )}
        </div>
      )}

      {sys.dismissed.length > 0 && <DismissedNote items={sys.dismissed} />}

      {(sys.checked.length > 0 || sys.measurements.length > 0) && (
        <div className="rd-sys-grid">
          {sys.checked.length > 0 && <CheckedList items={sys.checked} />}
          {sys.measurements.length > 0 && <MeasurementTable items={sys.measurements} />}
        </div>
      )}

      {sys.images.length > 0 && <Gallery images={sys.images} title={sys.title} />}
    </section>
  )
}

/** What this system's specialist flagged but the skeptic panel threw out: shown to make the rigor visible. */
function DismissedNote({ items }: { items: NDismissed[] }) {
  return (
    <div className="rd-tossed-note">
      <span className="rd-tossed-ic"><IcGavel size={16} /></span>
      <div className="grow">
        <div className="rd-tossed-h">Thrown out by the skeptics</div>
        <ul className="rd-tossed-list">
          {items.map((d, i) => (
            <li key={i}>
              <span className="rd-tossed-item">{d.item}</span>
              {d.result && <span className="rd-tossed-res"> · {d.result}</span>}
            </li>
          ))}
        </ul>
        <p className="rd-tossed-why">
          This system&rsquo;s AI specialist flagged {items.length === 1 ? 'it' : 'them'}, but the skeptic panel re-checked the images and
          showed {items.length === 1 ? 'it was' : 'they were'} not real, so {items.length === 1 ? 'it was' : 'they were'} dropped from the findings.
        </p>
      </div>
    </div>
  )
}

function CheckedList({ items }: { items: NChecked[] }) {
  const { printing } = useRead()
  const [openState, setOpen] = useState(false)
  const open = openState || printing
  const ok = items.filter((i) => i.kind === 'ok').length
  const na = items.filter((i) => i.kind === 'na').length
  const note = items.length - ok - na
  return (
    <div className={`rd-checked card ${open ? 'open' : ''}`}>
      <button type="button" className="rd-collapse-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="rd-block-ic"><IcList size={16} /></span>
        <span className="grow">
          <b>What was checked</b>
          <small>
            {plural(items.length, 'item')}
            {ok > 0 && <span className="rd-tone-green rd-tone-text"> · {ok} clear</span>}
            {note > 0 && <span className="rd-tone-cyan rd-tone-text"> · {note} with a note</span>}
            {na > 0 && <span className="faint"> · {na} not assessable</span>}
          </small>
        </span>
        <IcChevron size={18} className="rd-chev rd-noprint" />
      </button>
      {open && (
        <table className="data rd-table rd-checked-table">
          <thead><tr><th>Checked</th><th>Result</th></tr></thead>
          <tbody>
            {items.map((c, i) => (
              <tr key={i} className={`k-${c.kind}`}>
                <td data-label="Checked">{c.item}</td>
                <td data-label="Result">
                  <span className="rd-result">
                    <span className="rd-result-ic">{c.kind === 'ok' ? <IcCheck size={14} /> : c.kind === 'na' ? <IcMinus size={14} /> : <IcDot size={14} />}</span>
                    {c.result || <span className="faint">(no result recorded)</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!open && <p className="rd-checked-hint rd-noprint">The &ldquo;pertinent negatives&rdquo;: specific things a radiologist looks for, and what was found.</p>}
    </div>
  )
}

/** Rows shown before "Show all"; the reviewers list the headline measurements first. */
const MEASURE_PREVIEW = 4

/**
 * Lab-report style: measurement (with how it was measured underneath) | value | reference.
 * Values are long, so every cell wraps; on phones each row becomes a stacked card.
 */
function MeasurementTable({ items }: { items: NMeasurement[] }) {
  const { printing } = useRead()
  const [all, setAll] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const collapsible = items.length > MEASURE_PREVIEW + 1
  const showAll = all || printing || !collapsible
  const rows = showAll ? items : items.slice(0, MEASURE_PREVIEW)
  const hasRef = items.some((m) => m.reference)
  const toggle = () => {
    setAll((a) => !a)
    // Collapsing a long table can leave the reader far below it: bring its header back into view.
    if (all) {
      requestAnimationFrame(() => {
        const el = rootRef.current
        const scroller = el?.closest('.page-scroll')
        if (el && scroller && el.getBoundingClientRect().top < scroller.getBoundingClientRect().top) el.scrollIntoView({ block: 'start' })
      })
    }
  }
  return (
    <div ref={rootRef} className="rd-measure card">
      <div className="rd-collapse-head static">
        <span className="rd-block-ic"><IcRuler size={16} /></span>
        <span className="grow">
          <b>Measurements</b>
          <small>{plural(items.length, 'measurement')} · AI estimates on a low-dose, non-contrast scan</small>
        </span>
      </div>
      <table className={`data rd-table rd-measure-table ${hasRef ? 'has-ref' : ''}`}>
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Value</th>
            {hasRef && <th title="Typical or normal values, for comparison">Reference</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={i}>
              <td className="rd-mname-cell">
                <span className="rd-mname">{m.name}</span>
                {m.method && <span className="rd-mmethod"><span className="rd-mlabel">How measured: </span>{m.method}</span>}
              </td>
              <td className="rd-mval-cell">
                <span className="rd-mval mono">
                  {m.value ? m.value.split(/\s+\|\s+/).map((part, j) => <span key={j} className="rd-mval-line">{part}</span>) : '–'}
                </span>
              </td>
              {hasRef && (
                <td className="rd-mref-cell">
                  {m.reference
                    ? <span className="rd-mref"><span className="rd-mlabel">Reference: </span>{m.reference}</span>
                    : <span className="faint rd-mref-none">–</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {collapsible && !printing && (
        <button type="button" className="rd-more rd-noprint" aria-expanded={showAll} onClick={toggle}>
          {showAll ? 'Show fewer' : `Show all ${items.length} measurements`}
          <IcChevron size={16} className="rd-chev" />
        </button>
      )}
    </div>
  )
}

function Gallery({ images, title }: { images: NImage[]; title: string }) {
  const { printing } = useRead()
  const lightbox = useLightbox()
  return (
    <div className="rd-gallery-wrap">
      <div className="rd-sub"><span><IcImage size={14} /> Key images</span><span className="rd-sub-count mono">{images.length}</span></div>
      <div className="rd-gallery">
        {images.map((im, i) => (
          <figure key={im.url + i} className="rd-fig">
            <Thumb image={im} eager={printing} onOpen={() => lightbox(images, i, title)} />
            {im.caption && <figcaption>{im.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </div>
  )
}
