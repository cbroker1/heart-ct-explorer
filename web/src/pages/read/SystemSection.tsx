/** One body system: summary, findings, pertinent negatives, measurements and images. */
import { useState } from 'react'
import { plural, statusMeta, type NChecked, type NFinding, type NImage, type NMeasurement, type NSystem } from './model'
import { useRead } from './ctx'
import { useLightbox, Thumb } from './Lightbox'
import { FindingCard } from './FindingCard'
import { StatusChip } from './bits'
import { IcCheck, IcChevron, IcDot, IcImage, IcList, IcMinus, IcRuler, IcShield, SystemIcon } from './icons'

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

function MeasurementTable({ items }: { items: NMeasurement[] }) {
  const hasRef = items.some((m) => m.reference)
  const hasMethod = items.some((m) => m.method)
  return (
    <div className="rd-measure card">
      <div className="rd-collapse-head static">
        <span className="rd-block-ic"><IcRuler size={16} /></span>
        <span className="grow">
          <b>Measurements</b>
          <small>{plural(items.length, 'measurement')} · AI estimates on a low-dose, non-contrast scan</small>
        </span>
      </div>
      <table className="data rd-table rd-measure-table">
        <thead>
          <tr><th>Measurement</th><th>Value</th>{hasRef && <th title="Typical or normal values, for comparison">Reference</th>}{hasMethod && <th>How measured</th>}</tr>
        </thead>
        <tbody>
          {items.map((m, i) => (
            <tr key={i}>
              <td data-label="Measurement">{m.name}</td>
              <td data-label="Value" className="rd-mval mono">{m.value || '–'}</td>
              {hasRef && <td data-label="Reference" className="muted">{m.reference || '–'}</td>}
              {hasMethod && <td data-label="How measured" className="rd-mmethod">{m.method || '–'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
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
