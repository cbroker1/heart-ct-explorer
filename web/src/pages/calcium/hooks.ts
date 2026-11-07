import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Width of an element in CSS px (ResizeObserver), so charts can draw in real pixels. */
export function useWidth<T extends HTMLElement>(fallback = 600): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // content-box width (padding excluded), so an SVG drawn at this width never overflows its box
      const cs = window.getComputedStyle(el)
      const nw = Math.floor(el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0))
      if (nw > 0) setW((old) => (old === nw ? old : nw))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** True once the element has come within `margin` of the viewport (sticky: stays true). */
export function useNearViewport<T extends HTMLElement>(margin = '300px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true) }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return [ref, near]
}

/** Live visibility (for pausing render loops while scrolled away). */
export function useVisible<T extends HTMLElement>(ref: RefObject<T | null>, margin = '0px'): boolean {
  const [vis, setVis] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setVis(es[es.length - 1].isIntersecting), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin])
  return vis
}

export function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [v, setV] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = () => setV(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return v
}

/** localStorage-backed state that never throws (private mode, blocked storage, ...). */
export function useStoredNumber(key: string): [number | null, (v: number | null) => void] {
  const read = (): number | null => {
    try {
      const s = window.localStorage.getItem(key)
      if (s === null || s === '') return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }
  const [v, setV] = useState<number | null>(read)
  const set = (n: number | null) => {
    setV(n)
    try {
      if (n === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, String(n))
    } catch {
      /* storage unavailable: keep it in memory only */
    }
  }
  return [v, set]
}

/** Axis domain [0, top] with a little headroom, plus at most `maxTicks` round tick values inside it. */
export function axisTicks(max: number, maxTicks = 3): { ticks: number[]; top: number } {
  if (!(max > 0)) return { ticks: [0], top: 1 }
  const top = max * 1.1
  const raw = top / maxTicks
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => st >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(6))
  return { ticks, top }
}

export function compact(v: number): string {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}
