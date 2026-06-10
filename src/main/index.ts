import { app, ipcMain, screen, shell } from 'electron'
import { parseItem } from '../core/parser/parse'
import { buildSearchBody, prepareQuery } from '../core/query'
import type { PreparedQuery } from '../core/query/types'
import { StatsDb } from '../core/stats-db/statsDb'
import type { StatsPayload } from '../core/stats-db/types'
import type { ItemPayload } from '../shared/ipc'
import { loadConfig, saveConfig } from './config'
import { cachedFetchJson } from './dataCache'
import { createOverlayWindow } from './overlay'
import { GameWindowTracker, type GameState } from './gameWindow'
import { InputManager } from './input'
import { grabItemText } from './itemGrab'
import { TradeApiClient } from './tradeApi'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

interface LeaguesPayload {
  result: Array<{ id: string; realm: string; text: string }>
}

app.whenReady().then(() => {
  const config = loadConfig()
  const devAnyWindow = config.devAnyWindow || process.env['TRADEWIND_ANY_WINDOW'] === '1'

  const overlay = createOverlayWindow()
  const input = new InputManager()
  const tracker = new GameWindowTracker(config.gameWindowTitle, devAnyWindow)
  const tradeClient = new TradeApiClient()

  // Stats DB loads in the background; price checks just show raw text until ready.
  let statsDb: StatsDb | null = null
  void cachedFetchJson<StatsPayload>('stats', 'https://www.pathofexile.com/api/trade2/data/stats')
    .then((payload) => {
      statsDb = new StatsDb(payload)
      console.log(`[data] stats db ready (${payload.result.length} categories)`)
    })
    .catch((err) => console.error('[data] stats db failed to load:', err))

  let leagues: string[] = []
  let league = config.league
  void cachedFetchJson<LeaguesPayload>(
    'leagues',
    'https://www.pathofexile.com/api/trade2/data/leagues'
  )
    .then((payload) => {
      leagues = payload.result.filter((l) => l.realm === 'poe2').map((l) => l.id)
      if (!leagues.includes(league)) league = leagues[0] ?? 'Standard'
      console.log(`[data] leagues: ${leagues.join(', ')} — using "${league}"`)
    })
    .catch((err) => console.error('[data] leagues failed to load:', err))

  let overlayBounds = { x: 0, y: 0, width: 0, height: 0 }

  const setInteractive = (interactive: boolean): void => {
    overlay.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  const hidePopup = (): void => {
    overlay.webContents.send('tw:hide')
    setInteractive(false)
    input.cancelMouseLeave()
  }

  tracker.on('state', (state: GameState) => {
    if (state.active && state.bounds) {
      overlayBounds = screen.screenToDipRect(null, state.bounds)
      overlay.setBounds(overlayBounds)
      if (!overlay.isVisible()) overlay.showInactive()
    } else {
      overlay.hide()
      hidePopup()
    }
  })

  let busy = false
  input.start({
    async onPriceCheck() {
      if (busy || !tracker.isGameActive) return
      busy = true
      try {
        const text = await grabItemText()
        let prepared: PreparedQuery | null = null
        if (text && statsDb) {
          try {
            prepared = prepareQuery(parseItem(text), statsDb, { spread: config.spread })
          } catch (err) {
            console.error('[item] failed to prepare query:', err)
          }
        }
        const cursor = screen.getCursorScreenPoint()
        overlay.webContents.send('tw:item', {
          text,
          prepared,
          leagues,
          league,
          x: cursor.x - overlayBounds.x,
          y: cursor.y - overlayBounds.y
        } satisfies ItemPayload)
        input.watchMouseLeave()
      } finally {
        busy = false
      }
    },
    onEscape() {
      hidePopup()
    },
    onMouseMovedAway() {
      overlay.webContents.send('tw:hide')
      setInteractive(false)
    }
  })

  ipcMain.handle('tw:search', (_event, prepared: PreparedQuery) => {
    return tradeClient.searchWithListings(league, buildSearchBody(prepared))
  })

  ipcMain.handle('tw:set-league', (_event, id: string) => {
    league = id
    config.league = id
    saveConfig(config)
  })

  ipcMain.on('tw:open-url', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://www.pathofexile.com/')) {
      void shell.openExternal(url)
    }
  })

  ipcMain.on('tw:interactive', (_event, interactive: boolean) => {
    setInteractive(interactive)
    // The popup owns the cursor while hovered — pause the wander-away auto-hide.
    if (interactive) input.cancelMouseLeave()
    else input.watchMouseLeave()
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
