/** Filters, actions and the contents rail (desktop) / toolbar (narrow screens). */
import { useEffect, useState } from 'react'
import { Toggle } from '../../components/ui'
import { SEV_TONE, SEVERITIES, SEVERITY_LABEL, statusMeta, type Severity } from './model'
import { IcArrowUp, IcCheck, IcCollapse, IcCopy, IcExpand, IcPrinter } from './icons'

export interface Filters { sev: Record<Severity, boolean>; artifacts: boolean; refuted: boolean }
export const DEFAULT_FILTERS: Filters = { sev: { 0: true, 1: true, 2: true, 3: true }, artifacts: false, refuted: false }

export interface FilterCounts { bySev: Record<Severity, number>; artifacts: number; refuted: number; shown: number; total: number }

export interface TocEntry { id: string; label: string; status?: string; count?: number; group?: 'systems' }

export function FilterChips(props: { filters: Filters; counts: FilterCounts; onChange: (f: Filters) => void }) {
  const { filters, counts, onChange } = props
  return (
    <div className="rd-fchips" role="group" aria-label="Filter findings by severity">
      {SEVERITIES.map((s) => {
        const on = filters.sev[s]
        return (
          <button
            key={s}
            type="button"
            className={`rd-fchip rd-tone-${SEV_TONE[s]} ${on ? 'on' : ''} ${counts.bySev[s] ? '' : 'zero'}`}
            aria-pressed={on}
            title={`${on ? 'Hide' : 'Show'} findings rated “${SEVERITY_LABEL[s]}”`}
            onClick={() => onChange({ ...filters, sev: { ...filters.sev, [s]: !on } })}
          >
            <i className="rd-fchip-box" />
            <span className="rd-fchip-label">{SEVERITY_LABEL[s]}</span>
            <span className="rd-fchip-n mono">{counts.bySev[s]}</span>
          </button>
        )
      })}
    </div>
  )
}

export function FilterToggles(props: { filters: Filters; counts: FilterCounts; onChange: (f: Filters) => void }) {
  const { filters, counts, onChange } = props
  return (
    <div className="rd-ftoggles">
      <Toggle
        label={<span title="Quirks of how the images were made (not things in your body)">Show artifacts <span className="faint mono">{counts.artifacts}</span></span>}
        checked={filters.artifacts}
        onChange={(v) => onChange({ ...filters, artifacts: v })}
      />
      {counts.refuted > 0 && (
        <Toggle
          label={<span title="Findings the skeptics knocked down">Show refuted <span className="faint mono">{counts.refuted}</span></span>}
          checked={filters.refuted}
          onChange={(v) => onChange({ ...filters, refuted: v })}
        />
      )}
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function Actions(props: {
  allOpen: boolean
  onExpand: () => void
  onCollapse: () => void
  onPrint: () => void
  getSummary: () => string
  compact?: boolean
}) {
  const { allOpen, onExpand, onCollapse, onPrint, getSummary, compact } = props
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  useEffect(() => {
    if (copied === 'idle') return
    const t = window.setTimeout(() => setCopied('idle'), 2200)
    return () => window.clearTimeout(t)
  }, [copied])
  return (
    <div className="rd-actions">
      <button type="button" className="btn small" onClick={allOpen ? onCollapse : onExpand} title={allOpen ? 'Collapse every finding' : 'Open the details of every visible finding'}>
        {allOpen ? <IcCollapse size={15} /> : <IcExpand size={15} />}
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
      <button type="button" className="btn small cyan" onClick={onPrint} title="Print this report, or choose “Save as PDF” in the print dialog">
        <IcPrinter size={15} />
        {compact ? 'Print / PDF' : 'Print / save as PDF'}
      </button>
      <button
        type="button"
        className={`btn small rd-copy ${copied}`}
        onClick={async () => setCopied((await copyText(getSummary())) ? 'ok' : 'fail')}
        title="Copy a plain-text summary (verdict, impression, notable findings) to paste into an email or notes"
        aria-live="polite"
      >
        {copied === 'ok' ? <IcCheck size={15} /> : <IcCopy size={15} />}
        {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : compact ? 'Copy summary' : 'Copy text summary'}
      </button>
    </div>
  )
}

export function Rail(props: {
  toc: TocEntry[]
  active: string
  onGo: (id: string) => void
  filters: Filters
  counts: FilterCounts
  onFilters: (f: Filters) => void
  allOpen: boolean
  onExpand: () => void
  onCollapse: () => void
  onPrint: () => void
  getSummary: () => string
  isMock: boolean
}) {
  const { toc, active, onGo } = props
  const top = toc.filter((e) => e.group !== 'systems')
  const systems = toc.filter((e) => e.group === 'systems')
  const item = (e: TocEntry) => {
    const st = e.status ? statusMeta(e.status) : null
    return (
      <li key={e.id}>
        <button type="button" className={`rd-toc-item ${active === e.id ? 'on' : ''}`} onClick={() => onGo(e.id)} aria-current={active === e.id ? 'location' : undefined}>
          {st ? <i className={`rd-toc-dot rd-tone-${st.tone}`} title={st.label} /> : <i className="rd-toc-dot plain" />}
          <span className="grow" title={e.label}>{e.label}</span>
          {!!e.count && <span className="rd-toc-n mono" title={`${e.count} finding${e.count === 1 ? '' : 's'} (excluding artifacts and refuted ones)`}>{e.count}</span>}
        </button>
      </li>
    )
  }
  return (
    <aside className="rd-rail rd-noprint" aria-label="Report contents and filters">
      {props.isMock && <div className="rd-rail-mock mono">MOCK DATA</div>}
      <nav>
        <div className="rd-rail-h">Contents</div>
        <ul className="rd-toc">{top.slice(0, 2).map(item)}</ul>
        {systems.length > 0 && (
          <>
            <div className="rd-rail-h sub">Systems</div>
            <ul className="rd-toc">{systems.map(item)}</ul>
          </>
        )}
        <ul className="rd-toc">{top.slice(2).map(item)}</ul>
      </nav>
      <div className="rd-rail-block">
        <div className="rd-rail-h">Filter findings <span className="faint mono">{props.counts.shown}/{props.counts.total}</span></div>
        <FilterChips filters={props.filters} counts={props.counts} onChange={props.onFilters} />
        <FilterToggles filters={props.filters} counts={props.counts} onChange={props.onFilters} />
      </div>
      <div className="rd-rail-block">
        <Actions allOpen={props.allOpen} onExpand={props.onExpand} onCollapse={props.onCollapse} onPrint={props.onPrint} getSummary={props.getSummary} />
        <button type="button" className="btn small ghost rd-rail-top" onClick={() => onGo('rd-top')}><IcArrowUp size={14} /> Back to top</button>
      </div>
    </aside>
  )
}

export function Toolbar(props: {
  filters: Filters
  counts: FilterCounts
  onFilters: (f: Filters) => void
  allOpen: boolean
  onExpand: () => void
  onCollapse: () => void
  onPrint: () => void
  getSummary: () => string
}) {
  return (
    <div className="rd-toolbar rd-noprint">
      <div className="rd-toolbar-row">
        <div className="rd-rail-h">Filter findings <span className="faint mono">{props.counts.shown}/{props.counts.total}</span></div>
        <FilterToggles filters={props.filters} counts={props.counts} onChange={props.onFilters} />
      </div>
      <FilterChips filters={props.filters} counts={props.counts} onChange={props.onFilters} />
      <Actions allOpen={props.allOpen} onExpand={props.onExpand} onCollapse={props.onCollapse} onPrint={props.onPrint} getSummary={props.getSummary} compact />
    </div>
  )
}
