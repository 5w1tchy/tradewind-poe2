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
import { sendChatCommand } from './chatCommand'
import { TradeApiClient } from './tradeApi'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

interface LeaguesPayload {
  result: Array<{ id: string; realm: string; text: string }>
}

interface StaticPayload {
  result: Array<{ id: string; entries?: Array<{ id: string; text: string }> }>
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

  // Exact item text -> bulk-exchange id ("Idol of the Martyr" -> "idol-of-the-martyr").
  let exchangeIds: Record<string, string> = {}
  void cachedFetchJson<StaticPayload>('static', 'https://www.pathofexile.com/api/trade2/data/static')
    .then((payload) => {
      for (const group of payload.result) {
        for (const entry of group.entries ?? []) {
          if (entry.id && entry.id !== 'sep' && entry.text) exchangeIds[entry.text] = entry.id
        }
      }
      console.log(`[data] exchange ids ready (${Object.keys(exchangeIds).length} items)`)
    })
    .catch((err) => console.error('[data] static data failed to load:', err))

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

  const releaseFocus = (): void => {
    if (overlay.isFocused()) overlay.blur()
    overlay.setFocusable(false)
  }

  const hidePopup = (): void => {
    overlay.webContents.send('tw:hide')
    setInteractive(false)
    releaseFocus()
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
            prepared = prepareQuery(parseItem(text), statsDb, {
              spread: config.spread,
              exchangeIds
            })
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
    async onHideout() {
      // Skip when the popup holds keyboard focus — F5 there would land in
      // our own inputs, not the game chat.
      if (busy || !tracker.isGameActive || overlay.isFocused()) return
      busy = true
      try {
        await sendChatCommand('/hideout')
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
    if (prepared.exchangeId) return tradeClient.exchange(league, prepared.exchangeId)
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
    else {
      releaseFocus()
      input.watchMouseLeave()
    }
  })

  // Filter inputs need real keyboard focus; the window is non-focusable the
  // rest of the time so clicks never steal focus from the game.
  ipcMain.on('tw:focus-input', () => {
    overlay.setFocusable(true)
    overlay.focus()
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
