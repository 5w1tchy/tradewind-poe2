import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'
import styles from './UpdateToast.module.css'

/**
 * Bottom-right toast shown once an update has finished downloading. The update
 * also installs automatically on quit, so this is just the "get it now" path:
 * "Restart now" relaunches into the new version; ✕ dismisses until next launch.
 * It reports its rect to main so that region becomes clickable on the otherwise
 * click-through overlay.
 */
export default function UpdateToast(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.tradewind.onUpdateStatus((s) => {
      setStatus(s)
      // A freshly downloaded update re-arms the toast even if a prior one was dismissed.
      if (s.state === 'downloaded') setDismissed(false)
    })
  }, [])

  const show = status?.state === 'downloaded' && !dismissed

  // Keep main's hit-test rect in sync while the toast is visible (and on overlay
  // resize, e.g. the game window moving); clear it whenever the toast is gone.
  useLayoutEffect(() => {
    if (!show) {
      window.tradewind.setToastRect(null)
      return
    }
    const report = (): void => {
      const el = box.current
      if (!el) return
      const r = el.getBoundingClientRect()
      window.tradewind.setToastRect({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    report()
    window.addEventListener('resize', report)
    return () => {
      window.removeEventListener('resize', report)
      window.tradewind.setToastRect(null)
    }
  }, [show])

  if (!show || status?.state !== 'downloaded') return null

  return (
    <div ref={box} className={styles.toast}>
      <span className={styles.text}>
        <span className="tw-label">Update ready</span> v{status.version}
      </span>
      <button className="tw-btn" onClick={() => window.tradewind.restartToUpdate()}>
        Restart now
      </button>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
