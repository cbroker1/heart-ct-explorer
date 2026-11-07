/** Small hooks shared by the Lab sections (data loading, visibility, motion preference). */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { fetchBytes, loadJSON } from '../../../lib/data'
import type { BiomarkerReport, ExamInfo } from './types'

const jsonCache = new Map<string, Promise<unknown>>()
function cachedJSON<T>(rel: string): Promise<T> {
  let p = jsonCache.get(rel)
  if (!p) {
    p = loadJSON<T>(rel)
    jsonCache.set(rel, p)
    p.catch(() => jsonCache.delete(rel))
  }
  return p as Promise<T>
}

export type Loadable<T> = { data: T | null; error: string | null }

function useJSON<T>(rel: string): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null })
  useEffect(() => {
    let alive = true
    cachedJSON<T>(rel)
      .then((d) => alive && setState({ data: d, error: null }))
      .catch((e) => alive && setState({ data: null, error: String(e?.message ?? e) }))
    return () => { alive = false }
  }, [rel])
  return state
}

export const useBiomarkers = () => useJSON<BiomarkerReport>('biomarkers.json')
export const useExamInfo = () => useJSON<ExamInfo>('exam.json')

/** Nearest scrolling ancestor: the Lab scrolls inside `.page-scroll`, not the window, and an
 *  IntersectionObserver only honours rootMargin on its own root. */
function scrollRoot(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

/** True once the element has come within `margin` of the visible area (latches by default). */
export function useInView<T extends Element>(margin = '300px', once = true): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.some((e) => e.isIntersecting)
        if (vis) { setInView(true); if (once) io.disconnect() }
        else if (!once) setInView(false)
      },
      { root: scrollRoot(el), rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin, once])
  return [ref, inView]
}

export function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return !!reduced
}

/** Animated count-up from 0 to `target` once `start` is true (instant when reduced motion). */
export function useCountUp(target: number, start: boolean, ms = 1100): number {
  const reduced = usePrefersReducedMotion()
  const [v, setV] = useState(reduced ? target : 0)
  useEffect(() => {
    if (!start) return
    if (reduced) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(target * e)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, start, ms, reduced])
  return v
}

let webgl2: boolean | null = null
/** Probe WebGL2 once per page load, shared by every Lab section. The tiny probe canvas is simply
 *  dropped (forcing a context loss on it makes Chrome log a CONTEXT_LOST warning). */
export function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    webgl2 = !!c.getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return webgl2
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

type ProgressFn = (loaded: number, total: number) => void
const pendingBytes = new Map<string, { p: Promise<Uint8Array>; listeners: Set<ProgressFn> }>()

/** fetchBytes shared between overlapping callers (StrictMode re-mounts, quick remounts): one download,
 *  progress fanned out to every live listener. The entry is dropped once the download settles. */
export function fetchBytesShared(rel: string, expected: number, onProgress?: ProgressFn) {
  let entry = pendingBytes.get(rel)
  if (!entry) {
    const listeners = new Set<ProgressFn>()
    const p = fetchBytes(rel, expected, (l, t) => listeners.forEach((f) => f(l, t)))
    entry = { p, listeners }
    pendingBytes.set(rel, entry)
    p.then(() => pendingBytes.delete(rel), () => pendingBytes.delete(rel))
  }
  const e = entry
  if (onProgress) e.listeners.add(onProgress)
  return { promise: e.p, release: () => { if (onProgress) e.listeners.delete(onProgress) } }
}
