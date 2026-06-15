import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemPayload, Rect } from '../../shared/ipc'
import CraftPane from './components/CraftPane'
import PriceCheck from './components/PriceCheck'
import UpdateToast from './components/UpdateToast'
import styles from './App.module.css'

type Tab = 'price' | 'craft'

const pad = 12
/** Slack around the content so the popup's drop shadow isn't clipped by the
 *  content-sized window (box-shadow extends past the measured border box). */
const SHADOW = 40

/** Browser preview has no OS window to size, so it never shrinks (see preview.ts). */
const embedded = !(window as { __twPreview?: boolean }).__twPreview

function bbox(rects: Rect[]): Rect {
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const k of rects) {
    x = Math.min(x, k.x)
    y = Math.min(y, k.y)
    r = Math.max(r, k.x + k.w)
    b = Math.max(b, k.y + k.h)
  }
  return { x, y, w: r - x, h: b - y }
}

export default function App(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [payload, setPayload] = useState<ItemPayload | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [tab, setTab] = useState<Tab>('price')

  const popup = useRef<HTMLDivElement>(null)
  // The virtual-space stage: a transformed containing block for the fixed-
  // positioned surfaces. Its transform maps the content's bounding box onto the
  // (now content-sized) window's origin — see reportLayout.
  const stage = useRef<HTMLDivElement>(null)
  // The virtual viewport (tracked game-window size), pushed by main. Layout math
  // reads this instead of window.innerWidth/Height, which is now the small window.
  const vp = useRef({ w: window.innerWidth, h: window.innerHeight })
  // Pointer offset captured at drag start; null when not dragging.
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  // Latest pending drag target + the rAF that will flush it (coalesce a high-
  // polling mouse's flood of pointermoves into one move/repaint per frame).
  const dragTarget = useRef<{ x: number; y: number } | null>(null)
  const dragRaf = useRef<number | null>(null)
  // Once the user drags, stop auto-centering — they've placed it deliberately.
  const moved = useRef(false)

  // Measure every visible surface relative to the stage (virtual px), size the
  // overlay window to fit, and shift the stage so that box lands at the window's
  // origin. A fullscreen transparent window is crippling to composite under
  // software/WARP, so the window is only ever as large as its content.
  function reportLayout(): void {
    const st = stage.current
    if (!st) return
    const sb = st.getBoundingClientRect()
    const interactive: Rect[] = []
    st.querySelectorAll('[data-surface]').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      let left = r.left
      let top = r.top
      let right = r.right
      let bottom = r.bottom
      // Floating menus / the buyout popover spill outside the card box — fold
      // them in so their area stays clickable instead of falling to the game.
      el.querySelectorAll('[data-overlay]').forEach((o) => {
        const q = (o as HTMLElement).getBoundingClientRect()
        left = Math.min(left, q.left)
        top = Math.min(top, q.top)
        right = Math.max(right, q.right)
        bottom = Math.max(bottom, q.bottom)
      })
      interactive.push({ x: left - sb.left, y: top - sb.top, w: right - left, h: bottom - top })
    })

    // The tooltip and toast anchor themselves against the viewport, so they only
    // render correctly in a full-size window; keep it full whenever one is up
    // (both are infrequent). Preview never shrinks either.
    const full = !embedded || st.querySelector('[data-viewport-anchored]') !== null

    let win: Rect | null = null
    if (interactive.length > 0) {
      if (full) {
        win = { x: 0, y: 0, w: vp.current.w, h: vp.current.h }
      } else {
        const b = bbox(interactive)
        win = { x: b.x - SHADOW, y: b.y - SHADOW, w: b.w + 2 * SHADOW, h: b.h + 2 * SHADOW }
      }
    }
    // The transform creates the containing block the fixed surfaces resolve
    // against; `none` lets them anchor to the real (full) viewport.
    st.style.transform = win && !full ? `translate(${-win.x}px, ${-win.y}px)` : 'none'
    window.tradewind.setLayout({ window: win, interactive })
  }

  function moveTo(x: number, y: number): void {
    const el = popup.current
    if (!el) return
    const cx = Math.max(pad, Math.min(x, vp.current.w - el.offsetWidth - pad))
    const cy = Math.max(pad, Math.min(y, vp.current.h - el.offsetHeight - pad))
    setPos({ x: cx, y: cy })
  }

  // The popup stays open until dismissed: center it on a fresh item, but once the
  // user has dragged it, only keep its chosen spot on-screen as content resizes.
  function reflow(): void {
    const el = popup.current
    if (!el) return
    if (moved.current) {
      moveTo(el.offsetLeft, el.offsetTop)
    } else {
      moveTo((vp.current.w - el.offsetWidth) / 2, (vp.current.h - el.offsetHeight) / 2)
    }
  }

  function close(): void {
    setVisible(false)
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
      setPayload(p)
      setTab('price')
      setVisible(true)
    })
    window.tradewind.onHide(() => {
      setVisible(false)
    })
    window.tradewind.onViewport((size) => {
      vp.current = size
      // Re-place against the new viewport, then re-report (post-render).
      reflow()
      requestAnimationFrame(reportLayout)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Place once the new item's content has laid out.
  useLayoutEffect(() => {
    if (visible && payload) reflow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // Re-report the window/footprint whenever placement or content state changes.
  useLayoutEffect(() => {
    reportLayout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, visible, tab])

  // Keep it on-screen / centered as the popup grows/shrinks (results, tab switch).
  useEffect(() => {
    const el = popup.current
    if (!el) return
    const resizer = new ResizeObserver(() => {
      reflow()
      reportLayout()
    })
    resizer.observe(el)
    return () => resizer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // A floating overlay (dropdown / buyout popover / listing tooltip) or the toast
  // mounting/unmounting doesn't resize the card, so re-report when the subtree
  // changes — otherwise its area stays click-through, or the window won't grow to
  // contain it. Observe the whole stage so toast/tooltip changes are caught too.
  useEffect(() => {
    const st = stage.current
    if (!st) return
    const obs = new MutationObserver(() => reportLayout())
    obs.observe(st, { childList: true, subtree: true })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The popup renders only when there's an item; the update toast lives alongside
  // it and shows on its own schedule. Both sit in the virtual-space stage.
  return (
    <div ref={stage} className={styles.stage}>
      {visible && payload && (
        <div
          ref={popup}
          className={styles.popup}
          style={{
            left: pos.x + 'px',
            top: pos.y + 'px',
            maxHeight: Math.round(vp.current.h * 0.8) + 'px'
          }}
          data-surface
        >
          <i className={`${styles.corner} ${styles.tl}`} />
          <i className={`${styles.corner} ${styles.tr}`} />
          <i className={`${styles.corner} ${styles.bl}`} />
          <i className={`${styles.corner} ${styles.br}`} />

          <button className={styles.close} onClick={close} aria-label="Close" title="Close (Esc)">
            ×
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
    </div>
  )
}
