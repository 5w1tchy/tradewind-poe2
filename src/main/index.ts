import { app, screen } from 'electron'
import { StatsDb } from '../core/stats-db/statsDb'
import type { StatsPayload } from '../core/stats-db/types'
import { loadConfig } from './config'
import { cachedFetchJson } from './dataCache'
import { createOverlayWindow } from './overlay'
import { GameWindowTracker, type GameState } from './gameWindow'
import { InputManager } from './input'
import { grabItemText } from './itemGrab'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.whenReady().then(() => {
  const config = loadConfig()
  const devAnyWindow = config.devAnyWindow || process.env['TRADEWIND_ANY_WINDOW'] === '1'

  const overlay = createOverlayWindow()
  const input = new InputManager()
  const tracker = new GameWindowTracker(config.gameWindowTitle, devAnyWindow)

  // Stats DB loads in the background; price checks just show raw text until ready.
  let statsDb: StatsDb | null = null
  void cachedFetchJson<StatsPayload>('stats', 'https://www.pathofexile.com/api/trade2/data/stats')
    .then((payload) => {
      statsDb = new StatsDb(payload)
      console.log(`[data] stats db ready (${payload.result.length} categories)`)
    })
    .catch((err) => console.error('[data] stats db failed to load:', err))

  let overlayBounds = { x: 0, y: 0, width: 0, height: 0 }

  tracker.on('state', (state: GameState) => {
    if (state.active && state.bounds) {
      overlayBounds = screen.screenToDipRect(null, state.bounds)
      overlay.setBounds(overlayBounds)
      if (!overlay.isVisible()) overlay.showInactive()
    } else {
      overlay.hide()
      overlay.webContents.send('tw:hide')
      input.cancelMouseLeave()
    }
  })

  let busy = false
  input.start({
    async onPriceCheck() {
      if (busy || !tracker.isGameActive) return
      busy = true
      try {
        const text = await grabItemText()
        const cursor = screen.getCursorScreenPoint()
        overlay.webContents.send('tw:item', {
          text,
          x: cursor.x - overlayBounds.x,
          y: cursor.y - overlayBounds.y
        })
        input.watchMouseLeave()
      } finally {
        busy = false
      }
    },
    onEscape() {
      overlay.webContents.send('tw:hide')
      input.cancelMouseLeave()
    },
    onMouseMovedAway() {
      overlay.webContents.send('tw:hide')
    }
  })

  tracker.start()

  app.on('will-quit', () => {
    input.stop()
    tracker.stop()
  })

  console.log(
    `[tradewind] running — watching for "${config.gameWindowTitle}"` +
      (devAnyWindow ? ' (devAnyWindow: any foreground window matches)' : '')
  )
})
