import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemPayload } from '../../shared/ipc'
import CraftPane from './components/CraftPane'
import PriceCheck from './components/PriceCheck'
import styles from './App.module.css'

type Tab = 'price' | 'craft'

const pad = 12
// Open beside the cursor, never under it: a popup under the cursor would force
// the overlay interactive immediately and freeze the game tooltip.
const CURSOR_GAP = 20

export default function App(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [payload, setPayload] = useState<ItemPayload | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [tab, setTab] = useState<Tab>('price')

  const popup = useRef<HTMLDivElement>(null)
  const cursor = useRef({ x: 0, y: 0 })

  /** Initial placement: beside the cursor, flipping sides so it never covers it. */
  function place(): void {
    const el = popup.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = cursor.current.x + CURSOR_GAP
    if (x + w + pad > window.innerWidth) x = cursor.current.x - CURSOR_GAP - w
    let y = cursor.current.y + CURSOR_GAP
    if (y + h + pad > window.innerHeight) y = cursor.current.y - CURSOR_GAP - h
    setPos({
      x: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - h - pad))
    })
  }

  // Content growth (listings, switching to Craft) resizes the popup. Only pull it
  // back on-screen — never re-flip, or it would jump out from under the cursor
  // mid-interaction and trip the auto-hide.
  function reclamp(): void {
    const el = popup.current
    if (!el) return
    setPos((prev) => ({
      x: Math.max(pad, Math.min(prev.x, window.innerWidth - el.offsetWidth - pad)),
      y: Math.max(pad, Math.min(prev.y, window.innerHeight - el.offsetHeight - pad))
    }))
  }

  // Subscribe once to main->renderer pushes (preload appends listeners with no
  // unsubscribe, so this must run exactly once — see main.tsx, no StrictMode).
  useEffect(() => {
    window.tradewind.onItem((p) => {
      cursor.current = { x: p.x, y: p.y }
      setPayload(p)
      setTab('price')
      setVisible(true)
    })
    window.tradewind.onHide(() => {
      setVisible(false)
      window.tradewind.setPopupRect(null)
    })
  }, [])

  // Place beside the cursor once the new item's content has laid out.
  useLayoutEffect(() => {
    if (visible && payload) place()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // Keep the popup on-screen as its content grows/shrinks.
  useEffect(() => {
    const el = popup.current
    if (!el) return
    const resizer = new ResizeObserver(() => reclamp())
    resizer.observe(el)
    return () => resizer.disconnect()
  }, [visible])

  // Report the popup's rect so the main process can hit-test the cursor.
  useEffect(() => {
    const el = popup.current
    if (!visible || !el) {
      window.tradewind.setPopupRect(null)
      return
    }
    window.tradewind.setPopupRect({ x: pos.x, y: pos.y, w: el.offsetWidth, h: el.offsetHeight })
  }, [visible, pos, payload, tab])

  if (!visible || !payload) return null

  return (
    <div ref={popup} className={styles.popup} style={{ left: pos.x + 'px', top: pos.y + 'px' }}>
      <i className={`${styles.corner} ${styles.tl}`} />
      <i className={`${styles.corner} ${styles.tr}`} />
      <i className={`${styles.corner} ${styles.bl}`} />
      <i className={`${styles.corner} ${styles.br}`} />

      <nav className={styles.tabs}>
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
  )
}
