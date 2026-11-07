/** Tiny inline icon set (stroke icons, 16px, currentColor). */
import type { ReactNode } from 'react'

function Svg(props: { children: ReactNode; size?: number }) {
  const s = props.size ?? 16
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {props.children}
    </svg>
  )
}

export const Icon = {
  layout3: () => <Svg><rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M9.5 2v12M9.5 8h5" /></Svg>,
  single: () => <Svg><rect x="1.5" y="2" width="13" height="12" rx="2" /></Svg>,
  compare: () => <Svg><rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M8 2v12" /></Svg>,
  cross: () => <Svg><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" /><circle cx="8" cy="8" r="0.8" fill="currentColor" /></Svg>,
  ruler: () => <Svg><path d="M2 11.5 11.5 2l2.5 2.5L4.5 14z" /><path d="M5 8.5l1.3 1.3M7 6.5l1.3 1.3M9 4.5l1.3 1.3" /></Svg>,
  play: () => <Svg><path d="M5 3.2v9.6L12.5 8z" fill="currentColor" /></Svg>,
  pause: () => <Svg><path d="M5 3.5v9M11 3.5v9" strokeWidth={2.2} /></Svg>,
  reset: () => <Svg><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" /><path d="M2.5 2.5v3h3" /></Svg>,
  link: () => <Svg><path d="M6.5 9.5l3-3" /><path d="M7.2 4.6l1.2-1.2a2.8 2.8 0 0 1 4 4l-1.2 1.2M8.8 11.4l-1.2 1.2a2.8 2.8 0 0 1-4-4l1.2-1.2" /></Svg>,
  search: () => <Svg><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3.5 3.5" /></Svg>,
  target: () => <Svg><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></Svg>,
  x: () => <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>,
  expand: () => <Svg><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" /></Svg>,
  check: () => <Svg><path d="M3 8.5l3.2 3L13 4.5" /></Svg>,
  zoomIn: () => <Svg><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3.5 3.5M5 7h4M7 5v4" /></Svg>,
  zoomOut: () => <Svg><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3.5 3.5M5 7h4" /></Svg>,
  layers: () => <Svg><path d="M8 2 1.5 5.5 8 9l6.5-3.5z" /><path d="M1.5 9 8 12.5 14.5 9" /></Svg>,
}
