/** Line icons for the AI read page (24x24, stroke = currentColor). */
import type { ReactNode, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      {children}
    </svg>
  )
}

// ---------------------------------------------------------------- body systems
export const IcHeart = (p: P) => (
  <Svg {...p}>
    <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8C20.5 15 12 20.5 12 20.5z" />
    <path d="M6.5 11.5h3l1.3-2.3 2.2 4.6 1.4-2.3h3.1" strokeWidth={1.4} />
  </Svg>
)
export const IcAorta = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 21v-9.5a5 5 0 0 1 10 0V21" />
    <path d="M10.6 21v-9.2a1.9 1.9 0 0 1 3.8 0V21" strokeWidth={1.3} opacity={0.55} />
    <path d="M9.6 7.4 8.4 4M12.5 6.5V3M15.4 7.4l1.2-3.4" />
  </Svg>
)
export const IcLungs = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5v7.5M12 11l-2.6 2.2M12 11l2.6 2.2" />
    <path d="M9.2 7.4C6.3 7.6 3.5 12 3.5 17.2c0 1.8 1.3 2.6 2.8 2.1l2.9-1c.7-.2 1.1-.9 1.1-1.6V9.4c0-1.1-.5-2-1.1-2z" />
    <path d="M14.8 7.4c2.9.2 5.7 4.6 5.7 9.8 0 1.8-1.3 2.6-2.8 2.1l-2.9-1c-.7-.2-1.1-.9-1.1-1.6V9.4c0-1.1.5-2 1.1-2z" />
  </Svg>
)
export const IcNodule = (p: P) => (
  <Svg {...p}>
    <path d="M9.2 5.4C6.3 5.6 3.5 10 3.5 15.2c0 1.8 1.3 2.6 2.8 2.1l2.9-1c.7-.2 1.1-.9 1.1-1.6V7.4c0-1.1-.5-2-1.1-2z" />
    <circle cx="16.5" cy="12.5" r="4.2" />
    <circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="m19.6 15.6 1.9 1.9" />
  </Svg>
)
export const IcMediastinum = (p: P) => (
  <Svg {...p}>
    <path d="M5 4.5c-1 3.5-1.5 7.5-.8 11.3.4 2 1.6 3.7 3.4 4.7M19 4.5c1 3.5 1.5 7.5.8 11.3-.4 2-1.6 3.7-3.4 4.7" opacity={0.55} />
    <rect x="9.6" y="3" width="4.8" height="18" rx="2.4" />
    <path d="M9.6 8h4.8M9.6 12h4.8M9.6 16h4.8" strokeWidth={1.3} />
  </Svg>
)
export const IcBone = (p: P) => (
  <Svg {...p}>
    <path d="M7.4 9.6 14.4 16.6a2.3 2.3 0 1 0 3.2 3.2 2.3 2.3 0 1 0 2.2-3.9 2.3 2.3 0 1 0-3.2-3.2L9.6 5.7a2.3 2.3 0 1 0-3.2-3.2A2.3 2.3 0 1 0 4.2 6.4a2.3 2.3 0 1 0 3.2 3.2z" />
  </Svg>
)
export const IcTorso = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5c-2.4.6-4 2.2-4.4 4.6L3 13.5M16 3.5c2.4.6 4 2.2 4.4 4.6l.6 5.4" />
    <path d="M7.2 8.5c.4 4 .2 8.4-1.2 12M16.8 8.5c-.4 4-.2 8.4 1.2 12" />
    <path d="M10.2 13.6c.9.6 2.7.6 3.6 0M12 9v2" opacity={0.6} />
  </Svg>
)
export const IcScanner = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="11" r="7.5" />
    <circle cx="12" cy="11" r="3.4" />
    <path d="M2.5 19.5h19M6 19.5l1.2-2.2M18 19.5l-1.2-2.2" />
  </Svg>
)
export const IcDoc = (p: P) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" />
    <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" />
  </Svg>
)

/** Pick an icon from a system key (tolerant of the exact naming). */
export function SystemIcon({ k, ...p }: P & { k: string }) {
  const s = k.toLowerCase()
  if (s.includes('nodule')) return <IcNodule {...p} />
  if (s.includes('lung') || s.includes('airway') || s.includes('pleura')) return <IcLungs {...p} />
  if (s.includes('vessel') || s.includes('aort')) return <IcAorta {...p} />
  if (s.includes('heart') || s.includes('cardi') || s.includes('pericard') || s.includes('calcium')) return <IcHeart {...p} />
  if (s.includes('mediast') || s.includes('esoph') || s.includes('hila')) return <IcMediastinum {...p} />
  if (s.includes('bone') || s.includes('spine') || s.includes('skelet')) return <IcBone {...p} />
  if (s.includes('abdom') || s.includes('chest') || s.includes('soft')) return <IcTorso {...p} />
  if (s.includes('tech') || s.includes('quality') || s.includes('artifact')) return <IcScanner {...p} />
  return <IcDoc {...p} />
}

// ---------------------------------------------------------------- UI glyphs
export const IcCheck = (p: P) => (<Svg {...p}><path d="m5 12.5 4.2 4.2L19 7" /></Svg>)
export const IcX = (p: P) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>)
export const IcMinus = (p: P) => (<Svg {...p}><path d="M6 12h12" /></Svg>)
export const IcDot = (p: P) => (<Svg {...p}><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></Svg>)
export const IcChevron = (p: P) => (<Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>)
export const IcArrowRight = (p: P) => (<Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>)
export const IcArrowUp = (p: P) => (<Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>)
export const IcPrev = (p: P) => (<Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>)
export const IcNext = (p: P) => (<Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>)
export const IcExternal = (p: P) => (<Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></Svg>)
export const IcPrinter = (p: P) => (
  <Svg {...p}><path d="M7 9V3.5h10V9M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="7" y="14" width="10" height="6.5" rx="1" /></Svg>
)
export const IcSlices = (p: P) => (
  <Svg {...p}><path d="M12 3 3 7.5l9 4.5 9-4.5z" /><path d="m3 12 9 4.5 9-4.5" opacity={0.7} /><path d="m3 16.5 9 4.5 9-4.5" opacity={0.45} /></Svg>
)
export const IcTarget = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Svg>
)
export const IcImage = (p: P) => (
  <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" /></Svg>
)
export const IcShield = (p: P) => (
  <Svg {...p}><path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.4-4.6" /></Svg>
)
export const IcInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.6v.1" strokeWidth={2.2} /></Svg>
)
export const IcFlag = (p: P) => (
  <Svg {...p}><path d="M5 21V4M5 4.5c4-2 7 2 11 0l2.5-1v9.5L16 14c-4 2-7-2-11 0" /></Svg>
)
export const IcAlert = (p: P) => (
  <Svg {...p}><path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4.5M12 17.2v.1" strokeWidth={2.2} /></Svg>
)
export const IcGavel = (p: P) => (
  <Svg {...p}><path d="m14.5 3.5 6 6M12 6l6 6M13.5 4.5l-5 5 6 6 5-5M10 11l-6.5 6.5a1.4 1.4 0 0 0 2 2L12 13" /></Svg>
)
export const IcSpark = (p: P) => (
  <Svg {...p}><path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z" /></Svg>
)
export const IcList = (p: P) => (<Svg {...p}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={2} /></Svg>)
export const IcRuler = (p: P) => (
  <Svg {...p}><rect x="2.8" y="8" width="18.4" height="8" rx="1.5" transform="rotate(-30 12 12)" /><path d="m8.2 9.9 1.2 2M11.1 8.2l1.2 2M14 6.5l1.2 2" /></Svg>
)
export const IcExpand = (p: P) => (<Svg {...p}><path d="M7 9.5 12 4.5l5 5M7 14.5l5 5 5-5" /></Svg>)
export const IcCollapse = (p: P) => (<Svg {...p}><path d="m7 4.5 5 5 5-5M7 19.5l5-5 5 5" /></Svg>)
export const IcZoom = (p: P) => (<Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6" /></Svg>)
export const IcCopy = (p: P) => (<Svg {...p}><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></Svg>)
export const IcFit = (p: P) => (<Svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>)
