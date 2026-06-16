import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemPayload } from '../../shared/ipc'
import CraftPane from './components/CraftPane'
import PriceCheck from './components/PriceCheck'
import UpdateToast from './components/UpdateToast'
import styles from './App.module.css'

type Tab = 'price' | 'craft'

const pad = 12

/** Thumbtack glyph for the pin toggle — upright pin, filled head. */
function PinIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.2 1.4 14.6 6.8a1 1 0 0 1-1 1.65l-2.2-.5-2.5 2.5.2 2.3a.7.7 0 0 1-1.2.55l-2.4-2.4-3 3-.5-.5 3-3-2.4-2.4a.7.7 0 0 1 .55-1.2l2.3.2 2.5-2.5-.5-2.2a1 1 0 0 1 1.65-1Z"
      />
    </svg>
  )
}

export default function App(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [payload, setPayload] = useState<ItemPayload | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [tab, setTab] = useState<Tab>('price')
  // Pinned popups survive an outside click (only Esc / ✕ close them). Off by
  // default and reset on every fresh item — the main process mirrors this.
  const [pinned, setPinned] = useState(false)

  const popup = useRef<HTMLDivElement>(null)
  // Pointer offset captured at drag start; null when not dragging.
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  // Latest pending drag target + the rAF that will flush it. Coalesces a
  // high-polling mouse's flood of pointermoves into one move/repaint per frame.
  const dragTarget = useRef<{ x: number; y: number } | null>(null)
  const dragRaf = useRef<number | null>(null)
  // Once the user drags, stop auto-centering — they've placed it deliberately.
  const moved = useRef(false)

  // Push the rect to main so the overlay captures the mouse only while the
  // cursor is over the popup (everything else stays click-through for the game).
  // Report with the freshly computed position, never the async `pos` state.
  function reportRect(x: number, y: number): void {
    const el = popup.current
    if (!el) return
    let left = x
    let top = y
    let right = x + el.offsetWidth
    let bottom = y + el.offsetHeight
    // Dropdowns and the buyout popover float outside the card box; fold them into
    // the reported rect so clicks land on them instead of passing to the game.
    el.querySelectorAll('[data-overlay]').forEach((o) => {
      const r = (o as HTMLElement).getBoundingClientRect()
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    })
    window.tradewind.setPopupRect({ x: left, y: top, w: right - left, h: bottom - top })
  }

  function moveTo(x: number, y: number): void {
    const el = popup.current
    if (!el) return
    const cx = Math.max(pad, Math.min(x, window.innerWidth - el.offsetWidth - pad))
    const cy = Math.max(pad, Math.min(y, window.innerHeight - el.offsetHeight - pad))
    setPos({ x: cx, y: cy })
    reportRect(cx, cy)
  }

  // The popup stays open until dismissed: center it on a fresh item, but once the
  // user has dragged it, only keep its chosen spot on-screen as content resizes.
  function reflow(): void {
    const el = popup.current
    if (!el) return
    if (moved.current) {
      moveTo(el.offsetLeft, el.offsetTop)
    } else {
      moveTo((window.innerWidth - el.offsetWidth) / 2, (window.innerHeight - el.offsetHeight) / 2)
    }
  }

  function close(): void {
    // Closing always returns to the unpinned default; main mirrors this off the
    // null rect below.
    setPinned(false)
    setVisible(false)
    window.tradewind.setPopupRect(null)
  }

  // Header button: pin when unpinned, close when pinned (issue #32). The popup
  // mirrors PoE2's item tooltip — a pinned tooltip closes only via its ✕ / Esc,
  // so once pinned the button *is* the close control (no separate unpin).
  function pin(): void {
    setPinned(true)
    window.tradewind.setPinned(true)
  }

  // Drag from the header bar. Clicks on its buttons (tabs, close) fall through.
  function onDragStart(e: React.PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return
    const el = popup.current
    if (!el) return
    drag.current = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onDragMove(e: React.PointerEvent): void {
    if (!drag.current) return
    moved.current = true
    dragTarget.current = { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }
    if (dragRaf.current === null) {
      dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = null
        const t = dragTarget.current
        if (t) moveTo(t.x, t.y)
      })
    }
  }

  function onDragEnd(e: React.PointerEvent): void {
    if (!drag.current) return
    drag.current = null
    // Flush any frame still pending so the popup lands exactly where released.
    if (dragRaf.current !== null) {
      cancelAnimationFrame(dragRaf.current)
      dragRaf.current = null
      const t = dragTarget.current
      if (t) moveTo(t.x, t.y)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  // Subscribe once to main->renderer pushes (preload appends listeners with no
  // unsubscribe, so this must run exactly once — see main.tsx, no StrictMode).
  useEffect(() => {
    window.tradewind.onItem((p) => {
      moved.current = false
      // Pin persists across searches: a fresh item updates a pinned popup in
      // place and stays pinned (issue #32). Only an actual close resets it.
      setPayload(p)
      setTab('price')
      setVisible(true)
    })
    window.tradewind.onHide(() => {
      setPinned(false)
      setVisible(false)
      window.tradewind.setPopupRect(null)
    })
  }, [])

  // Place once the new item's content has laid out.
  useLayoutEffect(() => {
    if (visible && payload) reflow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // Keep it on-screen / centered as the popup grows/shrinks (results, tab switch).
  useEffect(() => {
    const el = popup.current
    if (!el) return
    const resizer = new ResizeObserver(() => reflow())
    resizer.observe(el)
    return () => resizer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // A floating overlay (dropdown / buyout popover) opening or closing doesn't
  // resize the card, so re-report the rect when one mounts/unmounts — otherwise
  // its area stays click-through and the cursor falls to the game behind it.
  useEffect(() => {
    const el = popup.current
    if (!el) return
    const obs = new MutationObserver(() => reportRect(el.offsetLeft, el.offsetTop))
    obs.observe(el, { childList: true, subtree: true })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // The popup renders only when there's an item; the update toast lives
  // alongside it and shows on its own schedule, so App always returns a tree.
  return (
    <>
      {visible && payload && (
        <div ref={popup} className={styles.popup} style={{ left: pos.x + 'px', top: pos.y + 'px' }}>
          <i className={`${styles.corner} ${styles.tl}`} />
          <i className={`${styles.corner} ${styles.tr}`} />
          <i className={`${styles.corner} ${styles.bl}`} />
          <i className={`${styles.corner} ${styles.br}`} />

          <button
            className={styles.close}
            onClick={pinned ? close : pin}
            aria-label={pinned ? 'Close' : 'Pin'}
            title={pinned ? 'Close (Esc)' : 'Pin — keep open when you click away'}
          >
            {pinned ? '×' : <PinIcon />}
          </button>

          <nav
            className={styles.tabs}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <span className={styles.mark}>◆</span>
            <button
              className={`${styles.tab} tw-label ${tab === 'price' ? styles.active : ''}`}
              onClick={() => setTab('price')}
            >
              Price
            </button>
            <button
              className={`${styles.tab} tw-label ${tab === 'craft' ? styles.active : ''}`}
              onClick={() => setTab('craft')}
            >
              Craft
            </button>
          </nav>

          <div style={{ display: tab === 'price' ? undefined : 'none' }}>
            <PriceCheck payload={payload} />
          </div>

          {tab === 'craft' && <CraftPane payload={payload} />}
        </div>
      )}

      <UpdateToast />
    </>
  )
}
