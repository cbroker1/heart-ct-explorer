/** Image lightbox (portal to <body>) + thumbnail button with a graceful "unavailable" state. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { NImage } from './model'
import { IcExternal, IcFit, IcImage, IcNext, IcPrev, IcX, IcZoom } from './icons'

type OpenFn = (images: NImage[], index?: number, title?: string) => void
const LightboxCtx = createContext<OpenFn>(() => {})
export const useLightbox = () => useContext(LightboxCtx)

interface LbState { images: NImage[]; index: number; title?: string }

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<LbState | null>(null)
  const open = useCallback<OpenFn>((images, index = 0, title) => {
    if (!images.length) return
    setSt({ images, index: Math.max(0, Math.min(images.length - 1, index)), title })
  }, [])
  const setIndex = useCallback((i: number) => setSt((s) => (s ? { ...s, index: i } : s)), [])
  const close = useCallback(() => setSt(null), [])
  return (
    <LightboxCtx.Provider value={open}>
      {children}
      {st && createPortal(<Lightbox {...st} onIndex={setIndex} onClose={close} />, document.body)}
    </LightboxCtx.Provider>
  )
}

function Lightbox(props: LbState & { onIndex: (i: number) => void; onClose: () => void }) {
  const { images, index, title, onIndex, onClose } = props
  const n = images.length
  const img = images[index]
  const [actual, setActual] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const live = useRef({ index, n, onIndex, onClose })
  live.current = { index, n, onIndex, onClose }

  const go = useCallback((d: number) => {
    const { index: i, n: len, onIndex: set } = live.current
    if (len > 1) set((i + d + len) % len)
  }, [])

  useEffect(() => { setStatus('loading'); setNatural(null) }, [img.url])

  // Track the stage's content box so "fit" can scale small images up (to 4x) as well as down.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const cs = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      setStage({ w: Math.max(0, w), h: Math.max(0, h) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [actual])
  const fitScale = natural && stage ? Math.min(stage.w / natural.w, stage.h / natural.h, 4) : null
  const fitStyle = !actual && natural && fitScale ? { width: Math.round(natural.w * fitScale), height: Math.round(natural.h * fitScale) } : undefined

  // keyboard + focus restore (mount only; reads the latest props through `live`)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); live.current.onClose() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'Tab') {
        // Keep keyboard focus inside the (modal) viewer.
        const root = rootRef.current
        if (!root) return
        const items = [...root.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => el.getClientRects().length > 0)
        if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey ? active === first || !root.contains(active) : active === last || !root.contains(active)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.({ preventScroll: true })
    }
  }, [go])

  // Drag to pan (1:1 mode, mouse) and swipe to change image (fit mode, touch).
  const drag = useRef<{ x: number; y: number; sl: number; st: number; id: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    const el = stageRef.current
    if (!el) return
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, id: e.pointerId, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, el = stageRef.current
    if (!d || !el || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (actual && e.pointerType === 'mouse' && e.buttons === 1) {
      el.scrollLeft = d.sl - dx
      el.scrollTop = d.st - dy
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!actual && e.pointerType !== 'mouse' && Math.abs(dx) > 50 && Math.abs(dy) < 80) { go(dx < 0 ? 1 : -1); return }
    // A plain click/tap on the backdrop (not on the image) closes.
    const t = e.target as HTMLElement
    if (!d.moved && !actual && !t.closest('img, .rd-lb-err')) onClose()
  }

  return (
    <div ref={rootRef} className="rd-lb" role="dialog" aria-modal="true" aria-label={title ? `Image viewer: ${title}` : 'Image viewer'}>
      <div className="rd-lb-top">
        <div className="rd-lb-title">
          {title && <div className="rd-lb-eyebrow">{title}</div>}
          {n > 1 && <span className="rd-lb-count mono">{index + 1} / {n}</span>}
        </div>
        <div className="rd-lb-actions">
          <button className="rd-lb-btn" onClick={() => setActual((a) => !a)} title={actual ? 'Fit to screen' : 'Show at actual size (drag or scroll to pan)'}>
            {actual ? <IcFit size={18} /> : <IcZoom size={18} />}<span className="rd-hide-sm">{actual ? 'Fit' : '1:1'}</span>
          </button>
          <a className="rd-lb-btn" href={img.url} target="_blank" rel="noopener noreferrer" title="Open the original image in a new tab">
            <IcExternal size={18} /><span className="rd-hide-sm">Original</span>
          </a>
          <button ref={closeRef} className="rd-lb-btn" onClick={onClose} title="Close (Esc)" aria-label="Close image viewer">
            <IcX size={20} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`rd-lb-stage ${actual ? 'actual' : 'fit'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
      >
        {status === 'error' ? (
          <div className="rd-lb-err"><IcImage size={28} /><div>This image could not be loaded.</div><div className="mono faint">{img.src}</div></div>
        ) : (
          <div className="rd-lb-imgwrap">
            <img
              key={img.url}
              src={img.url}
              alt={img.caption || title || 'CT image'}
              draggable={false}
              className={status === 'ok' ? 'in' : ''}
              style={fitStyle}
              onLoad={(e) => {
                const im = e.currentTarget
                setNatural(im.naturalWidth && im.naturalHeight ? { w: im.naturalWidth, h: im.naturalHeight } : null)
                setStatus('ok')
              }}
              onError={() => setStatus('error')}
            />
          </div>
        )}
        {status === 'loading' && <div className="spinner rd-lb-spin" />}
      </div>

      {n > 1 && (
        <>
          <button className="rd-lb-nav prev" onClick={() => go(-1)} aria-label="Previous image"><IcPrev size={26} /></button>
          <button className="rd-lb-nav next" onClick={() => go(1)} aria-label="Next image"><IcNext size={26} /></button>
        </>
      )}

      <div className="rd-lb-bottom">
        {img.caption && <div className="rd-lb-caption">{img.caption}</div>}
        {n > 1 && (
          <div className="rd-lb-strip">
            {images.map((im, i) => (
              <button key={im.url + i} className={i === index ? 'on' : ''} onClick={() => onIndex(i)} aria-label={`Image ${i + 1}`}>
                <img src={im.url} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A clickable thumbnail. `eager` is used while printing so every image is loaded. */
export function Thumb(props: { image: NImage; onOpen: () => void; eager?: boolean; className?: string; label?: string }) {
  const { image, onOpen, eager, className, label } = props
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  useEffect(() => { setState('loading') }, [image.url])
  return (
    <button
      type="button"
      className={`rd-thumb ${className ?? ''}`}
      data-state={state}
      onClick={onOpen}
      aria-label={label ?? `Enlarge image${image.caption ? `: ${image.caption}` : ''}`}
    >
      {state === 'error' ? (
        <span className="rd-thumb-err"><IcImage size={20} /><span>Image unavailable</span></span>
      ) : (
        <img
          src={image.url}
          alt={image.caption || label || 'CT image'}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      <span className="rd-thumb-zoom" aria-hidden><IcZoom size={16} /></span>
    </button>
  )
}
