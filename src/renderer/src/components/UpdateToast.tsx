import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'
import styles from './UpdateToast.module.css'

/**
 * Bottom-right toast shown once an update has finished downloading. The update
 * also installs automatically on quit, so this is just the "get it now" path:
 * "Restart now" relaunches into the new version; ✕ dismisses until next launch.
 * Marked data-surface so App folds it into the overlay window's footprint and
 * hit-test rect (the overlay is otherwise click-through).
 */
export default function UpdateToast(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.tradewind.onUpdateStatus((s) => {
      setStatus(s)
      // A freshly downloaded update re-arms the toast even if a prior one was dismissed.
      if (s.state === 'downloaded') setDismissed(false)
    })
  }, [])

  const show = status?.state === 'downloaded' && !dismissed

  if (!show || status?.state !== 'downloaded') return null

  return (
    <div className={styles.toast} data-surface data-viewport-anchored>
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
