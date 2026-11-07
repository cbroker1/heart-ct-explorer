/** Inline SVG icons for the Overview page (stroke = currentColor unless noted). */
import type { ReactNode } from 'react'

type P = { size?: number; className?: string }

function Svg(props: P & { children: ReactNode; vb?: string; sw?: number }) {
  const s = props.size ?? 20
  return (
    <svg
      className={props.className}
      width={s}
      height={s}
      viewBox={props.vb ?? '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth={props.sw ?? 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

export const ArrowRight = (p: P) => <Svg {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Svg>
export const ArrowUpRight = (p: P) => <Svg {...p}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></Svg>
export const IconCube = (p: P) => (
  <Svg {...p}><path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" /><path d="M4 7.3 12 12l8-4.7" /><path d="M12 12v9.2" /></Svg>
)
export const IconLayers = (p: P) => (
  <Svg {...p}><path d="m12 3 9 4.6-9 4.6-9-4.6z" /><path d="m3 12.2 9 4.6 9-4.6" /><path d="m3 16.6 9 4.6 9-4.6" /></Svg>
)
export const IconInfo = (p: P) => (
  <Svg {...p} sw={2}><circle cx="12" cy="12" r="9.2" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" strokeWidth={2.6} /></Svg>
)
export const IconGithub = (p: P) => {
  const s = p.size ?? 20
  return (
    <svg className={p.className} width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  )
}

// ------------------------------------------------------------ timeline glyphs
export const IconDisc = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" /><path d="M16.5 7.5a6 6 0 0 1 1.4 3" /></Svg>
)
export const IconShield = (p: P) => (
  <Svg {...p}><path d="M12 2.8 19.5 6v5.6c0 4.6-3.2 8.3-7.5 9.6-4.3-1.3-7.5-5-7.5-9.6V6z" /><path d="m8.8 12.2 2.3 2.3 4.2-4.6" /></Svg>
)
export const IconBrain = (p: P) => (
  <Svg {...p}>
    <path d="M9 4.5a3 3 0 0 0-5 2.2 3.2 3.2 0 0 0-1 5.8 3.3 3.3 0 0 0 2.6 5.2A3 3 0 0 0 11 18V6.4A2.5 2.5 0 0 0 9 4.5Z" />
    <path d="M15 4.5a3 3 0 0 1 5 2.2 3.2 3.2 0 0 1 1 5.8 3.3 3.3 0 0 1-2.6 5.2A3 3 0 0 1 13 18V6.4a2.5 2.5 0 0 1 2-1.9Z" />
  </Svg>
)
export const IconMesh = (p: P) => (
  <Svg {...p}><path d="m12 3 8 5v8l-8 5-8-5V8z" /><path d="m4 8 8 5 8-5" /><path d="M12 13v8" /><path d="m8 5.5 8 10" strokeOpacity={0.55} /><path d="m16 5.5-8 10" strokeOpacity={0.55} /></Svg>
)
export const IconScreen = (p: P) => (
  <Svg {...p}><rect x="2.8" y="4" width="18.4" height="12.6" rx="2" /><path d="M8.5 20h7" /><path d="M12 16.6V20" /><path d="m6.5 12 2.6-3 2.4 2.2 3-4 3 4.8" /></Svg>
)
export const IconGlobe = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></Svg>
)

// ------------------------------------------------------------ section-card mini visuals (64x64)
const V = (props: { children: ReactNode; id: string }) => (
  <svg className="ovw-card-art" viewBox="0 0 64 64" aria-hidden="true">{props.children}</svg>
)

export function ArtSlices() {
  return (
    <V id="slices">
      <defs>
        <linearGradient id="ovw-g-sl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8be7ff" /><stop offset="1" stopColor="#38d6ff" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M10 ${40 - i * 8} L32 ${30 - i * 8} L54 ${40 - i * 8} L32 ${50 - i * 8} Z`} fill={i === 1 ? 'url(#ovw-g-sl)' : 'none'} fillOpacity={i === 1 ? 0.35 : 0} stroke="#38d6ff" strokeOpacity={i === 1 ? 1 : 0.35 + i * 0.08} strokeWidth="1.4" strokeLinejoin="round" />
      ))}
      <ellipse cx="32" cy="32" rx="5.5" ry="2.6" fill="#ff4d5e" fillOpacity="0.85" />
    </V>
  )
}

export function ArtAnatomy() {
  return (
    <V id="anatomy">
      <defs>
        <radialGradient id="ovw-g-an" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ff8a95" /><stop offset="1" stopColor="#c8283a" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="33" rx="25" ry="9" fill="none" stroke="#ff8a95" strokeOpacity="0.35" strokeWidth="1.2" transform="rotate(-18 32 33)" />
      <path d="M32 50S14 39.5 14 27.5a8.6 8.6 0 0 1 18-3 8.6 8.6 0 0 1 18 3C50 39.5 32 50 32 50Z" fill="url(#ovw-g-an)" />
      <path d="M22 26c2-3.5 5.5-4.5 8-3" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M50.5 26.5a25 9 -18 0 1 -6 9" fill="none" stroke="#ff8a95" strokeOpacity="0.9" strokeWidth="1.4" strokeLinecap="round" />
    </V>
  )
}

export function ArtVolume() {
  return (
    <V id="volume">
      <defs>
        <radialGradient id="ovw-g-vo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#d6ccff" stopOpacity="0.95" /><stop offset="0.5" stopColor="#a08bff" stopOpacity="0.45" /><stop offset="1" stopColor="#a08bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M32 9 52 20v24L32 55 12 44V20z" fill="none" stroke="#a08bff" strokeOpacity="0.55" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12 20 32 31l20-11M32 31v24" fill="none" stroke="#a08bff" strokeOpacity="0.3" strokeWidth="1.1" />
      <circle cx="32" cy="33" r="14" fill="url(#ovw-g-vo)" />
      <path d="M4 24 32 33" stroke="#e7e1ff" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="2 2.5" />
    </V>
  )
}

export function ArtCalcium() {
  return (
    <V id="calcium">
      <path d="M12 14c10 2 14 9 16 17s7 16 22 18" fill="none" stroke="#ff4d5e" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" />
      <path d="M28 31c4-4 10-6 18-5" fill="none" stroke="#ff4d5e" strokeOpacity="0.4" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="22" cy="20" r="3" fill="#ffb547" />
      <circle cx="35" cy="43" r="2.2" fill="#ffd27a" />
      <circle cx="22" cy="20" r="6.5" fill="#ffb547" fillOpacity="0.18" />
      <g stroke="#ffb547" strokeWidth="1.3" strokeLinecap="round"><path d="M49 8v6" /><path d="M46 11h6" /></g>
    </V>
  )
}

export function ArtRead() {
  return (
    <V id="read">
      <rect x="14" y="8" width="30" height="40" rx="4" fill="#3ee08f" fillOpacity="0.06" stroke="#3ee08f" strokeOpacity="0.6" strokeWidth="1.4" />
      <g stroke="#3ee08f" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round"><path d="M20 17h18" /><path d="M20 23h14" /><path d="M20 29h18" /><path d="M20 35h10" /></g>
      <path d="M46 34l2.4 5.6L54 42l-5.6 2.4L46 50l-2.4-5.6L38 42l5.6-2.4z" fill="#8ff0bf" />
      <circle cx="21" cy="43" r="1.6" fill="#3ee08f" />
    </V>
  )
}

export function ArtLab() {
  return (
    <V id="lab">
      <defs>
        <linearGradient id="ovw-g-lab" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff4d5e" stopOpacity="0.85" /><stop offset="1" stopColor="#a08bff" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <path d="M26 8h12M28 8v14L15 47a5 5 0 0 0 4.4 7.3h25.2A5 5 0 0 0 49 47L36 22V8" fill="none" stroke="#ff8a95" strokeOpacity="0.75" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M19.6 40h24.8l4.4 7.7A4 4 0 0 1 45.3 53H18.7a4 4 0 0 1-3.5-5.3z" fill="url(#ovw-g-lab)" />
      <circle cx="29" cy="46" r="2" fill="#fff" fillOpacity="0.7" />
      <circle cx="36" cy="43" r="1.3" fill="#fff" fillOpacity="0.6" />
      <circle cx="33" cy="33" r="1.5" fill="#ff8a95" />
      <circle cx="30" cy="26" r="1" fill="#ff8a95" fillOpacity="0.7" />
    </V>
  )
}
