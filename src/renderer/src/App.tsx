import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemPayload } from '../../shared/ipc'
import CraftPane from './components/CraftPane'
import PriceCheck from './components/PriceCheck'
import UpdateToast from './components/UpdateToast'
import styles from './App.module.css'

type Tab = 'price' | 'craft'

const pad = 12
// Resize bounds (CSS px). Upper bounds are the viewport minus `pad` on each side,
// computed live in clampSize.
const MIN_W = 360
const MIN_H = 220

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
  // The popup is a fixed-size box (not content-sized) so it stays put when the
  // content changes — switching tabs no longer resizes it (issue #35). Seeded
  // from the persisted size on each item; the user resizes it via the corner
  // handle, which persists back through main.
  const [size, setSize] = useState({ w: 520, h: 560 })
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
  // Resize gesture state, mirroring the drag plumbing: the geometry captured at
  // grab time, the latest pending target, and the rAF that flushes it.
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const resizeTarget = useRef<{ w: number; h: number } | null>(null)
  const resizeRaf = useRef<number | null>(null)

  // Clamp a desired size to [MIN, viewport - pad]. Keeps the popup from being
  // shrunk to nothing or grown past the screen (also re-applied per item, since a
  // size saved on a larger monitor may not fit the current one).
  function clampSize(w: number, h: number): { w: number; h: number } {
    return {
      w: Math.round(Math.max(MIN_W, Math.min(w, window.innerWidth - pad * 2))),
      h: Math.round(Math.max(MIN_H, Math.min(h, window.innerHeight - pad * 2)))
    }
  }

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
      // Top-middle: horizontally centered but biased toward the top of the
      // screen (≈8% down), closer to where PoE2 draws its own item tooltip than
      // dead-center (issue #35).
      const top = Math.round(window.innerHeight * 0.08)
      moveTo((window.innerWidth - el.offsetWidth) / 2, top)
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

  // Resize from the bottom-right handle. Anchored top-left (the grabbed corner
  // follows the cursor), rAF-coalesced like the drag, and persisted on release so
  // the chosen size survives the next price check / restart (issue #35).
  function onResizeStart(e: React.PointerEvent): void {
    // Anchor to the size we *render* (state), not el.offsetWidth — the latter
    // includes the popup's padding + border, so seeding from it would snap the
    // frame up by that difference on the first move tick before tracking smoothly.
    resize.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }

  function onResizeMove(e: React.PointerEvent): void {
    const r = resize.current
    if (!r) return
    resizeTarget.current = { w: r.w + (e.clientX - r.x), h: r.h + (e.clientY - r.y) }
    if (resizeRaf.current === null) {
      resizeRaf.current = requestAnimationFrame(() => {
        resizeRaf.current = null
        const t = resizeTarget.current
        if (t) setSize(clampSize(t.w, t.h))
      })
    }
  }

  function onResizeEnd(e: React.PointerEvent): void {
    if (!resize.current) return
    resize.current = null
    if (resizeRaf.current !== null) {
      cancelAnimationFrame(resizeRaf.current)
      resizeRaf.current = null
    }
    const t = resizeTarget.current
    if (t) {
      const s = clampSize(t.w, t.h)
      setSize(s)
      window.tradewind.setPopupSize(s)
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
      // Restore the user's saved size (clamped to the current monitor).
      if (p.popupSize) setSize(clampSize(p.popupSize.w, p.popupSize.h))
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

  // The frame is fixed-size now, so content changes (results, tab switch) no
  // longer resize it — only a user resize does. When that happens, keep the
  // popup on-screen and re-report its rect, but DON'T re-center: a resize is
  // anchored to the corner the user grabbed, not pulled back to the middle.
  useEffect(() => {
    const el = popup.current
    if (!el) return
    const resizer = new ResizeObserver(() => {
      const node = popup.current
      if (node) moveTo(node.offsetLeft, node.offsetTop)
    })
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
        <div
          ref={popup}
          className={styles.popup}
          style={{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }}
        >
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

          <div className={styles.body}>
            {/* Each tab panel fills the fixed frame and owns its own scrolling
                (the stats/results lists, the essence list) — so content changes
                never resize the popup. */}
            <div
              style={{
                display: tab === 'price' ? 'flex' : 'none',
                flexDirection: 'column',
                flex: '1 1 auto',
                minHeight: 0
              }}
            >
              <PriceCheck payload={payload} />
            </div>

            {tab === 'craft' && <CraftPane payload={payload} />}
          </div>

          <div
            className={styles.resize}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            title="Drag to resize"
            aria-hidden="true"
          />
        </div>
      )}

      <UpdateToast />
    </>
  )
}
