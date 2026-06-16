import { app, nativeImage, Tray } from 'electron'
import { showTrayMenu, type TrayMenuItem } from './tray-menu'
import { showThemedDialog } from './themed-dialog'

// The app's only window is the click-through overlay, which is hidden whenever
// PoE2 isn't focused — so a tray icon is the user's only way to quit. The icon
// is the app's compass logo (build/icon.png) downscaled to 32x32 and embedded
// as base64, not a packaged asset, so it loads identically in dev and in the
// asar build. Regenerate via `node scripts/gen-tray.mjs` if build/icon.png
// changes.
const ICON_PNG =
  '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'

export interface TrayHandlers {
  /** User-initiated update check (reports its result with a native dialog). */
  onCheckForUpdates: () => void
}

/**
 * Dev-only menu entries that pop each themed update dialog directly. The real
 * ones (update-available, ready-to-restart, error) only fire from a packaged
 * build's update feed, so these let us eyeball them in `npm run dev`. Returns
 * an empty list in a packaged build, so they never ship.
 */
function devDialogTestItems(): TrayMenuItem[] {
  if (app.isPackaged) return []
  return [
    { separator: true },
    { header: 'Dev — dialog previews' },
    {
      label: 'Dialog: up to date',
      action: () =>
        void showThemedDialog({
          message: 'You’re up to date',
          detail: `Tradewind ${app.getVersion()} is the latest version.`
        })
    },
    {
      label: 'Dialog: update available',
      action: () =>
        void showThemedDialog({
          message: 'Update 9.9.9 available',
          detail:
            'Downloading in the background — you’ll be prompted to restart when it’s ready.'
        })
    },
    {
      label: 'Dialog: ready (restart?)',
      action: () =>
        void showThemedDialog({
          message: 'Update 9.9.9 ready',
          detail: 'Restart Tradewind to finish installing.',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1
        }).then((r) => console.log(`[dev] restart dialog → ${r === 0 ? 'Restart now' : 'Later'}`))
    },
    {
      label: 'Dialog: error',
      action: () =>
        void showThemedDialog({
          title: 'Update check failed',
          message: 'Couldn’t check for updates.',
          detail: 'net::ERR_INTERNET_DISCONNECTED'
        })
    }
  ]
}

/**
 * Create the system-tray (notification-area) icon and its menu. Returns the
 * Tray so the caller can keep it alive (a GC'd Tray disappears from the
 * notification area).
 */
export function createTray(handlers: TrayHandlers): Tray {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG}`)
  const tray = new Tray(icon)
  tray.setToolTip('Tradewind')

  // Our own themed menu instead of tray.setContextMenu's native Win32 menu,
  // which can't be styled to match the overlay. Opened by either button so a
  // left-click — which the native menu ignores — is also discoverable.
  const open = (): void =>
    showTrayMenu([
      { header: `Tradewind v${app.getVersion()}` },
      { separator: true },
      { label: 'Check for updates…', action: () => handlers.onCheckForUpdates() },
      ...devDialogTestItems(),
      { separator: true },
      { label: 'Quit', action: () => app.quit() }
    ])
  tray.on('click', open)
  tray.on('right-click', open)

  return tray
}
