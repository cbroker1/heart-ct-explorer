/** Small shared UI primitives. Styling lives in styles.css. */
import { useEffect, useState, type ReactNode } from 'react'

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const { label, value, min, max, step = 1, format, onChange, disabled } = props
  const pct = ((value - min) / (max - min || 1)) * 100
  return (
    <label className={disabled ? 'slider disabled' : 'slider'}>
      <span className="lbl">
        <span>{label}</span>
        <span className="val">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Toggle(props: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; swatch?: string; disabled?: boolean }) {
  return (
    <label className={props.disabled ? 'toggle disabled' : 'toggle'}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="sw" />
      {props.swatch && <span style={{ width: 10, height: 10, borderRadius: 3, background: props.swatch, flex: '0 0 auto' }} />}
      <span>{props.label}</span>
    </label>
  )
}

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'on' : ''} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function LoaderOverlay(props: { label: string; loaded?: number; total?: number }) {
  const pct = props.total ? Math.min(100, (100 * (props.loaded ?? 0)) / props.total) : null
  return (
    <div className="loader">
      <div className="box">
        <div className="spinner" />
        <div style={{ marginTop: 14, fontWeight: 600 }}>{props.label}</div>
        {pct !== null && (
          <>
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <div className="muted mono" style={{ fontSize: 12 }}>
              {((props.loaded ?? 0) / 1048576).toFixed(1)} / {((props.total ?? 0) / 1048576).toFixed(1)} MB
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function Stat(props: { k: ReactNode; v: ReactNode; unit?: string; color?: string }) {
  return (
    <div className="stat">
      <div className="v" style={{ color: props.color }}>
        {props.v}
        {props.unit && <small>{props.unit}</small>}
      </div>
      <div className="k">{props.k}</div>
    </div>
  )
}

export function ErrorBox(props: { error: string }) {
  return (
    <div className="page-pad">
      <div className="card" style={{ borderColor: 'rgba(255,92,92,.4)' }}>
        <h3 style={{ color: 'var(--danger)' }}>Something went wrong</h3>
        <p className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{props.error}</p>
      </div>
    </div>
  )
}

/** Tiny hash router: "#/slices?x=1" -> { path: "/slices", query } */
export function useHashRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#/, '') || '/'
    const [path, qs] = h.split('?')
    return { path: path || '/', query: new URLSearchParams(qs ?? '') }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`
}

export function HeartIcon(props: { className?: string; size?: number }) {
  const s = props.size ?? 22
  return (
    <svg className={props.className} width={s} height={s} viewBox="0 0 64 64" aria-hidden>
      <path fill="currentColor" d="M32 56S6 40 6 22a13 13 0 0 1 26-4 13 13 0 0 1 26 4c0 18-26 34-26 34z" />
      <path d="M10 31h11l4-8 6 16 5-12 3 4h15" fill="none" stroke="#07090d" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
