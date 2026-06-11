import { app, globalShortcut, ipcMain, screen, shell } from 'electron'
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
import { RatesProvider } from './rates'
import { estimatePrice, type RateTable } from '../core/pricing'
import type { SearchOutcome, TradeListing } from '../core/trade/types'
import { ScoutAnchorProvider } from './scoutAnchor'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

interface LeaguesPayload {
  result: Array<{ id: string; realm: string; text: string }>
}

interface StaticPayload {
  result: Array<{ id: string; entries?: Array<{ id: string; text: string }> }>
}

interface ItemsPayload {
  result: Array<{ id: string; entries?: Array<{ type?: string }> }>
}

app.whenReady().then(() => {
  const config = loadConfig()
  const devAnyWindow = config.devAnyWindow || process.env['TRADEWIND_ANY_WINDOW'] === '1'

  const overlay = createOverlayWindow()
  const input = new InputManager()
  const tracker = new GameWindowTracker(config.gameWindowTitle, devAnyWindow)
  const tradeClient = new TradeApiClient()
  const rates = new RatesProvider(tradeClient)
  const scout = new ScoutAnchorProvider()

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

  // Base names for extracting the true base from decorated white/magic names.
  let baseTypes: string[] = []
  void cachedFetchJson<ItemsPayload>('items', 'https://www.pathofexile.com/api/trade2/data/items')
    .then((payload) => {
      const seen = new Set<string>()
      for (const group of payload.result) {
        for (const entry of group.entries ?? []) {
          if (entry.type) seen.add(entry.type)
        }
      }
      baseTypes = [...seen]
      console.log(`[data] base types ready (${baseTypes.length})`)
    })
    .catch((err) => console.error('[data] items data failed to load:', err))

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

  let busy = false
  const priceCheck = async (): Promise<void> => {
    if (busy || !tracker.isGameActive || overlay.isFocused()) return
    busy = true
    try {
      const text = await grabItemText()
      let prepared: PreparedQuery | null = null
      if (text && statsDb) {
        try {
          prepared = prepareQuery(parseItem(text), statsDb, {
            spread: config.spread,
            exchangeIds,
            baseTypes
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
  }
  const goHideout = async (): Promise<void> => {
    // Skip when the popup holds keyboard focus — F5 there would land in
    // our own inputs, not the game chat.
    if (busy || !tracker.isGameActive || overlay.isFocused()) return
    busy = true
    try {
      await sendChatCommand('/hideout')
    } finally {
      busy = false
    }
  }

  // Hotkeys are claimed (and thereby swallowed — no leaking "D" stepping the
  // character sideways in WASD mode) only while PoE2 is focused, so the rest
  // of the desktop keeps its shortcuts. If another tool already owns a key,
  // fall back to observing it via uiohook: works, but the keypress leaks.
  let hotkeysClaimed = false
  const claimHotkeys = (): void => {
    if (hotkeysClaimed) return
    hotkeysClaimed = true
    const pc = globalShortcut.register('Control+D', () => void priceCheck())
    const ho = globalShortcut.register('F5', () => void goHideout())
    input.setObserved({ priceCheck: !pc, hideout: !ho })
    if (!pc || !ho) {
      console.warn(
        `[input] could not claim ${[!pc && 'Ctrl+D', !ho && 'F5'].filter(Boolean).join(', ')} — another app holds it; keypress will leak to the game`
      )
    }
  }
  const releaseHotkeys = (): void => {
    if (!hotkeysClaimed) return
    hotkeysClaimed = false
    globalShortcut.unregisterAll()
    input.setObserved({ priceCheck: true, hideout: true })
  }

  tracker.on('state', (state: GameState) => {
    if (state.active && state.bounds) {
      overlayBounds = screen.screenToDipRect(null, state.bounds)
      overlay.setBounds(overlayBounds)
      if (!overlay.isVisible()) overlay.showInactive()
      claimHotkeys()
    } else {
      overlay.hide()
      hidePopup()
      releaseHotkeys()
    }
  })

  input.start({
    onPriceCheck: () => void priceCheck(),
    onHideout: () => void goHideout(),
    onEscape() {
      hidePopup()
    },
    onMouseMovedAway() {
      overlay.webContents.send('tw:hide')
      setInteractive(false)
    }
  })

  const listingPrices = (listings: TradeListing[]): Array<{ amount: number; currency: string }> =>
    listings.map((l) => l.price).filter((p): p is NonNullable<typeof p> => p !== null)

  /**
   * Stackables need denomination-aware querying: GGG sorts exchange offers
   * by raw ask amount ignoring currency and caps the response, so one
   * mixed-currency query starves whichever book the item doesn't trade in
   * (cheap runes vanish behind "0.5 divine" trolls; omens behind exalted
   * bait). Ask the exalted book first — when it's deep and tight it is the
   * market. Only a thin or scattered book earns the wide second call, where
   * the same cap conveniently starves the junk instead.
   */
  // Re-checking the same stackable shouldn't burn exchange budget.
  const exchangeCache = new Map<string, { outcome: SearchOutcome; at: number }>()
  const EXCHANGE_CACHE_MS = 60_000

  async function exchangeWithEstimate(
    exchangeId: string,
    rateTable: RateTable,
    anchor: number | undefined
  ): Promise<SearchOutcome> {
    const cacheKey = `${league}:${exchangeId}`
    const cached = exchangeCache.get(cacheKey)
    if (cached && Date.now() - cached.at < EXCHANGE_CACHE_MS) return cached.outcome

    const exaltedBook = await tradeClient.exchange(league, exchangeId, {
      have: ['exalted'],
      rates: rateTable
    })
    const exEst = estimatePrice(
      listingPrices(exaltedBook.listings),
      rateTable,
      exaltedBook.total,
      anchor
    )
    // A dozen independent sellers agreeing is a market, not a bait wall —
    // only a thin or scattered exalted book earns the wide second call.
    let outcome = exaltedBook
    if (!(exEst?.confidence === 'high' && exEst.sampleSize >= 12)) {
      const wideBook = await tradeClient.exchange(league, exchangeId, { rates: rateTable })
      const wideEst = estimatePrice(
        listingPrices(wideBook.listings),
        rateTable,
        wideBook.total,
        anchor
      )
      if (anchor !== undefined && exEst && wideEst) {
        // Both books are suspect — let the independent aggregate referee:
        // a thin-but-real exalted book beats a deep divine troll wall.
        const dist = (e: NonNullable<typeof exEst>): number =>
          Math.abs(Math.log((e.lowExalted + e.highExalted) / 2 / anchor))
        outcome = dist(exEst) <= dist(wideEst) ? exaltedBook : wideBook
      } else if (wideBook.listings.length > 0) {
        outcome = wideBook
      }
    }
    exchangeCache.set(cacheKey, { outcome, at: Date.now() })
    return outcome
  }

  ipcMain.handle('tw:search', async (_event, prepared: PreparedQuery) => {
    const rateTable = await rates.get(league)
    // Stackables key by their text, uniques by their given name.
    const anchor =
      prepared.exchangeId || prepared.name
        ? (await scout.get(league)).get(prepared.displayName)
        : undefined
    const outcome = prepared.exchangeId
      ? await exchangeWithEstimate(prepared.exchangeId, rateTable, anchor)
      : await tradeClient.searchWithListings(league, buildSearchBody(prepared)).catch((err) => {
          // Which identifiers produced the failure matters more than the
          // HTTP body ("Unknown item base type" never says which type).
          console.error(
            `[trade] search failed for "${prepared.displayName}"`,
            JSON.stringify({
              name: prepared.name,
              type: prepared.type,
              base: prepared.baseTypeFilter?.enabled ? prepared.baseTypeFilter.value : undefined,
              category: prepared.categoryFilter?.enabled ? prepared.categoryFilter.value : undefined
            })
          )
          throw err
        })
    outcome.estimate = estimatePrice(
      listingPrices(outcome.listings),
      rateTable,
      outcome.total,
      anchor
    )
    for (const listing of outcome.listings) {
      if (!listing.price) continue
      const rate = rateTable[listing.price.currency]
      if (rate === undefined) {
        listing.unpriceable = true
      } else if (outcome.estimate && listing.price.amount * rate < outcome.estimate.cutoffExalted) {
        listing.lowball = true
      }
    }
    // Bait sinks below the credible offers (stable sort keeps price order).
    outcome.listings.sort((a, b) => Number(a.lowball ?? false) - Number(b.lowball ?? false))
    return outcome
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
    globalShortcut.unregisterAll()
    input.stop()
    tracker.stop()
  })

  console.log(
    `[tradewind] running — watching for "${config.gameWindowTitle}"` +
      (devAnyWindow ? ' (devAnyWindow: any foreground window matches)' : '')
  )
})
