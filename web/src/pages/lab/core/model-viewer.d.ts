// JSX typing for Google's <model-viewer> web component (loaded lazily from public/vendor, never imported).
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  alt?: string
  poster?: string
  ar?: boolean
  loading?: 'auto' | 'lazy' | 'eager'
  reveal?: 'auto' | 'manual'
  exposure?: number | string
  // every other model-viewer attribute is dash-cased (camera-controls, ar-modes, tone-mapping, ...)
  [attribute: `${string}-${string}`]: string | number | boolean | undefined
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerAttributes
    }
  }
}
