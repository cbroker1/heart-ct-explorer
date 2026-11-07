/** One finding: plain-English first, radiology details + skeptic review on demand. */
import { categoryMeta, lensMeta, pct, seriesLabel, SEV_TONE, SEVERITY_LABEL, verifMeta, type NFinding } from './model'
import { useRead } from './ctx'
import { useLightbox, Thumb } from './Lightbox'
import { Locator } from './Topogram'
import { ConfidenceBar, Prose, SevChip, ToneChip, VerifChip } from './bits'
import { IcArrowRight, IcCheck, IcChevron, IcGavel, IcImage, IcSlices, IcTarget, IcX } from './icons'

export function FindingCard({ f }: { f: NFinding }) {
  const { printing, expanded, toggleFinding, exam, volumes, openSlice } = useRead()
  const lightbox = useLightbox()
  const open = printing || expanded.has(f.id)
  const tone = SEV_TONE[f.severity]
  const cat = categoryMeta(f.category)
  const upheld = f.votes.filter((v) => !v.refuted).length
  const detailsId = `rd-fd-${f.id}`
  const sLabel = f.link ? seriesLabel(f.link.series, volumes) : null

  return (
    <article id={`rd-f-${f.id}`} className={`rd-finding rd-tone-${tone} ${open ? 'open' : ''} ${f.isRefuted ? 'refuted' : ''} ${f.isArtifact ? 'artifact' : ''}`}>
      <div className="rd-finding-main">
        <div className="rd-finding-chips">
          <span className="rd-fnum mono" title="Finding number (matches the pins on the scout X-ray map)">#{f.n}</span>
          <SevChip s={f.severity} />
          <ToneChip tone="neutral" dot={false} title={cat.blurb} className="rd-cat">{cat.label}</ToneChip>
          {f.status && <VerifChip status={f.status} upheld={upheld} total={f.votes.length} />}
        </div>
        <h3 className="rd-finding-title">{f.title}</h3>
        {f.plainEnglish
          ? <p className="rd-plain">{f.plainEnglish}</p>
          : f.description && <p className="rd-plain">{f.description}</p>}

        <div className="rd-finding-bar">
          <button
            type="button"
            className="rd-details-btn rd-noprint"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => toggleFinding(f.id)}
          >
            <IcChevron size={16} className="rd-chev" />
            {open ? 'Hide details' : 'Details'}
          </button>
          {f.location && <span className="rd-meta" title="Location"><IcTarget size={14} />{f.location}</span>}
          {f.confidence !== null && (
            <span className="rd-meta rd-meta-conf" title="How sure the AI reviewer was about this finding">
              <span className="rd-minibar"><i style={{ width: pct(f.confidence) }} /></span>
              {pct(f.confidence)} confident
            </span>
          )}
          {f.images.length > 0 && <span className="rd-meta rd-noprint"><IcImage size={14} />{f.images.length}</span>}
        </div>
      </div>

      <div id={detailsId} className="rd-finding-details" hidden={!open}>
        <div className="rd-fd-grid">
          <div className="rd-fd-text">
            {f.description && f.plainEnglish && (
              <div className="rd-fd-block">
                <div className="rd-label">What the reviewer wrote</div>
                <Prose text={f.description} className="rd-desc" />
              </div>
            )}
            <dl className="rd-dl">
              {f.location && (<><dt>Location</dt><dd>{f.location}</dd></>)}
              {f.measurements && (<><dt>Measurements</dt><dd className="rd-measure-text">{f.measurements}</dd></>)}
              <dt>Category</dt>
              <dd>{cat.label}{cat.blurb && <span className="muted"> · {cat.blurb}</span>}</dd>
              <dt>Severity</dt>
              <dd><span className={`rd-tone-${tone} rd-tone-text`}>{SEVERITY_LABEL[f.severity]}</span><span className="muted"> · level {f.severity} of 3</span></dd>
            </dl>
            {f.confidence !== null && (
              <ConfidenceBar value={f.confidence} label="AI confidence" caption="How sure the reviewing AI was that this finding is real and correctly described." />
            )}
            {f.recommendation && (
              <div className={`rd-reco rd-tone-${tone}`}>
                <div className="rd-label">Recommendation</div>
                <p>{f.recommendation}</p>
              </div>
            )}
          </div>

          {(f.link || f.images.length > 0) && (
            <div className="rd-fd-visual">
              {f.link?.lps && exam && exam.topograms.length > 0 && (
                <div className="rd-fd-block">
                  <div className="rd-label">Where it is, on your scout X-rays</div>
                  <Locator exam={exam} lps={f.link.lps} tone={tone} />
                </div>
              )}
              {f.link && (
                <button type="button" className="rd-slice-cta rd-noprint" onClick={() => openSlice(f.link!)}>
                  <span className="rd-slice-ic"><IcSlices size={20} /></span>
                  <span className="grow">
                    <b>Show in slice viewer</b>
                    <small>
                      {[sLabel, f.link.plane, f.link.window && `${f.link.window} window`].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <IcArrowRight size={18} />
                </button>
              )}
              {f.images.length > 0 && (
                <div className="rd-fd-block">
                  <div className="rd-label">Key images <span className="faint">({f.images.length})</span></div>
                  <div className="rd-fd-thumbs">
                    {f.images.map((im, i) => (
                      <Thumb
                        key={im.url + i}
                        image={im}
                        eager={printing}
                        label={`Enlarge image ${i + 1} of ${f.images.length}: ${im.caption || f.title}`}
                        onOpen={() => lightbox(f.images, i, f.title)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <SkepticPanel f={f} upheld={upheld} />
      </div>
    </article>
  )
}

function SkepticPanel({ f, upheld }: { f: NFinding; upheld: number }) {
  const m = verifMeta(f.status)
  const n = f.votes.length
  const refuted = n - upheld
  const sk = n === 1 ? 'skeptic' : 'skeptics'
  const summary =
    f.status === 'confirmed' ? `${upheld} of ${n} ${sk} could not refute it.`
    : f.status === 'refuted' ? `${refuted} of ${n} ${sk} knocked it down.`
    : f.status === 'downgraded' ? `Judged less significant after review (${upheld} of ${n} ${sk} could not refute it).`
    : n ? `${upheld} of ${n} ${sk} could not refute it.` : 'No skeptic review was recorded for this finding.'
  return (
    <div className="rd-skeptics">
      <div className="rd-skeptics-head">
        <span className="rd-skeptics-ic"><IcGavel size={16} /></span>
        <div className="grow">
          <div className="rd-label">Skeptic review</div>
          <div className="rd-skeptics-sum">
            <b className={`rd-tone-${m.tone} rd-tone-text`}>{m.label}.</b> {n ? summary : m.blurb}
          </div>
        </div>
      </div>
      {n > 0 && (
        <div className="rd-votes">
          {f.votes.map((v, i) => {
            const lm = lensMeta(v.lens)
            return (
              <div key={i} className={`rd-vote ${v.refuted ? 'refuted' : 'upheld'}`}>
                <div className="rd-vote-head">
                  <span className="rd-vote-ic">{v.refuted ? <IcX size={14} /> : <IcCheck size={14} />}</span>
                  <b>{lm.label}</b>
                </div>
                {lm.question && <div className="rd-vote-q">{lm.question}</div>}
                <div className="rd-vote-verdict">{v.refuted ? 'Refuted it' : 'Could not refute it'}</div>
                {v.note && <p className="rd-vote-note">{v.note}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
