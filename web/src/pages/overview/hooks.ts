import { useEffect, useRef, useState, type RefObject } from 'react'

const RM_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(RM_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(RM_QUERY)
    if (!mq) return
    const on = () => setRm(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return rm
}

/** True while the element intersects the viewport (or once it has, with `once`). */
export function useInView<T extends Element>(opts: { once?: boolean; rootMargin?: string; threshold?: number } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  const { once = false, rootMargin = '0px', threshold = 0 } = opts
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      const hit = entries.some((e) => e.isIntersecting)
      if (hit && once) { setInView(true); io.disconnect(); return }
      setInView(hit)
    }, { rootMargin, threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [once, rootMargin, threshold])
  return [ref, inView]
}

/** Whether the document is visible (pauses animation loops in background tabs). */
export function usePageVisible(): boolean {
  const [vis, setVis] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVis(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return vis
}

/** Animates 0 -> target once `start` becomes true (instant with reduced motion). */
export function useCountUp(target: number | null, start: boolean, reduced: boolean, duration = 1300): number | null {
  const [v, setV] = useState<number | null>(null)
  useEffect(() => {
    if (target === null) { setV(null); return }
    if (!start) { setV(reduced ? target : 0); return }
    if (reduced || target === 0) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / duration)
      const e = 1 - Math.pow(1 - k, 3)
      setV(target * e)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, start, reduced, duration])
  return v
}

/** Cheap WebGL2 capability probe (the context is released immediately). */
let webgl2Cache: boolean | null = null
export function hasWebGL2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    webgl2Cache = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2Cache = false
  }
  return webgl2Cache
}
