import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'
import styles from './UpdateToast.module.css'

/**
 * Bottom-right toast for the poll-found update path. Downloads never start on
 * their own (that could spike ping mid-game), so a polled update shows here as
 * "available" with an Update button; clicking it downloads and — since that
 * click is also consent to restart — the app installs and relaunches itself
 * when the download finishes (no second prompt). The toast just narrates that:
 * available → downloading → installing. It reports its rect to main so the
 * region becomes clickable on the otherwise click-through overlay.
 */
export default function UpdateToast(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.tradewind.onUpdateStatus((s) => {
      setStatus(s)
      // A fresh "available" re-arms the toast even if a prior one was dismissed.
      if (s.state === 'available') setDismissed(false)
    })
  }, [])

  // Dismiss only hides the "available" prompt; once downloading/installing the
  // restart is imminent, so keep narrating it.
  const show =
    status != null &&
    ((status.state === 'available' && !dismissed) ||
      status.state === 'downloading' ||
      status.state === 'downloaded')

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

  if (!show || status == null) return null

  if (status.state === 'available') {
    return (
      <div ref={box} className={styles.toast}>
        <span className={styles.text}>
          <span className="tw-label">Update</span> v{status.version} available
        </span>
        <button className="tw-btn" onClick={() => window.tradewind.downloadUpdate()}>
          Update
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

  return (
    <div ref={box} className={styles.toast}>
      <span className={styles.text}>
        <span className="tw-label">Updating</span>
        {status.state === 'downloading' ? `${status.percent}%` : 'restarting…'}
      </span>
    </div>
  )
}
