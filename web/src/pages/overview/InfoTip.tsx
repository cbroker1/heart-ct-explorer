/**
 * Accessible info popover: hover (mouse) or tap/click/focus to open; Escape, an outside tap or scrolling the
 * button off screen closes it.
 * Rendered in a portal with fixed positioning so glass panels (backdrop-filter) never clip it.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconInfo } from './icons'

export function InfoTip(props: { label: string; children: ReactNode; className?: string }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hover || pinned
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const id = useId()
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null)
  // A short grace period lets the mouse travel from the button into the popover.
  const leaveTimer = useRef<number | undefined>(undefined)
  const enter = (e: { pointerType: string }) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(leaveTimer.current)
    setHover(true)
  }
  const leave = (e: { pointerType: string }) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => setHover(false), 140)
  }
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const b = btn.current?.getBoundingClientRect()
      const p = pop.current
      if (!b || !p) return
      const vw = window.innerWidth, vh = window.innerHeight
      const w = p.offsetWidth, h = p.offsetHeight
      const cx = b.left + b.width / 2
      const left = Math.max(10, Math.min(vw - w - 10, cx - w / 2))
      const below = b.top - h - 12 < 64 && b.bottom + h + 12 < vh
      const top = below ? b.bottom + 10 : b.top - h - 10
      setPos({ left, top, below, arrow: Math.max(12, Math.min(w - 12, cx - left)) })
    }
    place()
    // Follow the button while the page scrolls; close once it leaves the screen.
    const onScroll = () => {
      const b = btn.current?.getBoundingClientRect()
      if (!b || b.bottom < 0 || b.top > window.innerHeight) { setPinned(false); setHover(false); return }
      place()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || pop.current?.contains(t)) return
      setPinned(false)
      setHover(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setHover(false); btn.current?.blur() } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`ovw-tip-btn ${props.className ?? ''}`}
        aria-label={props.label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={enter}
        onPointerLeave={leave}
        // Pointer clicks/taps don't move focus here: focusing makes mobile Chrome nudge the page scroll.
        // Keyboard users still Tab to it (and :focus-visible opens it).
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPinned((v) => !v) }}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setPinned(true) }}
        onBlur={() => setPinned(false)}
      >
        <IconInfo size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            className={`ovw-tip-pop${pos ? ' is-placed' : ''}${pos?.below ? ' is-below' : ''}`}
            style={pos ? { left: pos.left, top: pos.top, ['--arrow' as string]: `${pos.arrow}px` } : undefined}
            onPointerEnter={enter}
            onPointerLeave={leave}
          >
            {props.children}
          </div>,
          document.body,
        )}
    </>
  )
}
