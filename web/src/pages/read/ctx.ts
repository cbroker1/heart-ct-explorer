import { createContext, useContext, useEffect, useState } from 'react'
import type { VolumeMeta } from '../../lib/data'
import type { ExamInfo, NLink } from './model'

export interface ReadCtxValue {
  /** True while printing: every collapsible is open and images load eagerly. */
  printing: boolean
  volumes: VolumeMeta[]
  exam: ExamInfo | null
  expanded: Set<string>
  toggleFinding: (id: string) => void
  /** Opens the slice viewer; with `fromFinding`, Back returns to that finding. */
  openSlice: (link: NLink, fromFinding?: string) => void
}

export const ReadCtx = createContext<ReadCtxValue | null>(null)

export function useRead(): ReadCtxValue {
  const v = useContext(ReadCtx)
  if (!v) throw new Error('useRead() outside <ReadCtx.Provider>')
  return v
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}
