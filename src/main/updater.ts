import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { Config } from './config'
import type { UpdateStatus } from '../shared/ipc'

// How often to re-check after the startup check. Releases are infrequent; a
// few hours keeps us current without hammering the GitHub feed.
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000

let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * Wire electron-updater against the GitHub releases feed. Downloads happen in
 * the background and install on quit (autoInstallOnAppQuit); the renderer gets
 * status pushes so it can offer an immediate "Restart now". Startup is never
 * blocked, and every failure path (offline, no release yet, rate limit) is
 * swallowed — the overlay must keep working regardless.
 */
export function initAutoUpdater(overlay: BrowserWindow, config: Config): void {
  // Only an installed build can replace itself; in dev there is no feed and
  // checkForUpdates would throw. `npm run dev` stays untouched.
  if (!app.isPackaged) return

  // Channel selection, the GitHub way: leave autoUpdater.channel at its default
  // and toggle allowPrerelease. Stable users see only full releases (GitHub's
  // "latest release" endpoint skips pre-releases). Demo users also see
  // pre-releases and always land on the newest of *either* channel — the
  // provider reads beta.yml for a vX.Y.Z-beta.N tag and latest.yml for a plain
  // tag (see electron-updater GitHubProvider.getLatestVersion).
  autoUpdater.allowPrerelease = config.updateChannel === 'demo'
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (status: UpdateStatus): void => {
    if (!overlay.isDestroyed()) overlay.webContents.send('tw:update-status', status)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[updater]', message)
    send({ state: 'error', message })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err instanceof Error ? err.message : err)
    })
  }

  check()
  pollTimer = setInterval(check, POLL_INTERVAL_MS)
}

export function stopAutoUpdater(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** Quit and install a downloaded update immediately. */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
