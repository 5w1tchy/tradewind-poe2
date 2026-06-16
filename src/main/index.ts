import { app, globalShortcut, ipcMain, screen, shell } from 'electron'
import { parseItem } from '../core/parser/parse'
import { buildSearchBody, prepareQuery } from '../core/query'
import type { PreparedQuery } from '../core/query/types'
import { StatsDb } from '../core/stats-db/statsDb'
import type { StatsPayload } from '../core/stats-db/types'
import type { ItemPayload } from '../shared/ipc'
import { loadConfig, saveConfig } from './config'
import { parseHotkey } from './hotkey'
import { NativeKeyHook } from './keyhook'
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
import {
  checkForUpdatesManually,
  downloadUpdate,
  initAutoUpdater,
  quitAndInstall,
  stopAutoUpdater
} from './updater'
import { createTray } from './tray'
import { createSplashWindow } from './splash'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Render the overlay in software, deliberately. On machines where the GPU is
// present but only half-engaged for Chromium (driver/Windows quirk — the GPU
// shows up but `gpu_compositing` falls back to a WARP software path), letting
// Electron *try* the GPU and limp along in that fallback makes the popup lag
// badly (jerky drag, multi-second hover repaints). The overlay is a tiny, mostly
// static UI that doesn't need the GPU, so forcing clean software rendering for
// everyone is smooth across machines and sidesteps that whole fallback class.
// Must be called before the app is ready.
app.disableHardwareAcceleration()

interface LeaguesPayload {
  result: Array<{ id: string; realm: string; text: string }>
}

interface StaticPayload {
  result: Array<{ id: string; entries?: Array<{ id: string; text: string; image?: string }> }>
}

interface ItemsPayload {
  result: Array<{ id: string; entries?: Array<{ type?: string }> }>
}

app.whenReady().then(() => {
  // Stable identity for Windows notifications and the updater relaunch.
  app.setAppUserModelId('com.tradewind.poe2')

  // Up first so there's something on screen while the data fetches below warm
  // up; dismissed once they settle (or a safety cap) — see below.
  const splash = createSplashWindow()
  const splashStart = Date.now()

  const config = loadConfig()
  const devAnyWindow = config.devAnyWindow || process.env['TRADEWIND_ANY_WINDOW'] === '1'

  const overlay = createOverlayWindow()
  // The overlay is hidden whenever PoE2 isn't focused, so the tray is the only
  // way to quit (and to trigger a manual update check). Held in scope so the GC
  // doesn't reap the icon.
  const tray = createTray({
    onCheckForUpdates: () => checkForUpdatesManually(),
    // Dev-only: lets the tray's update-preview items pop the corner toast.
    onDevEmitUpdateStatus: app.isPackaged
      ? undefined
      : (status) => {
          if (!overlay.isDestroyed()) overlay.webContents.send('tw:update-status', status)
        }
  })
  // Background auto-update (no-op in dev); never blocks startup.
  initAutoUpdater(overlay, config)
  const input = new InputManager()
  const tracker = new GameWindowTracker(config.gameWindowTitle, devAnyWindow)
  const tradeClient = new TradeApiClient()
  const rates = new RatesProvider(tradeClient)
  const scout = new ScoutAnchorProvider()

  // Stats DB loads in the background; price checks just show raw text until ready.
  let statsDb: StatsDb | null = null
  const statsReady = cachedFetchJson<StatsPayload>(
    'stats',
    'https://www.pathofexile.com/api/trade2/data/stats'
  )
    .then((payload) => {
      statsDb = new StatsDb(payload)
      console.log(`[data] stats db ready (${payload.result.length} categories)`)
    })
    .catch((err) => console.error('[data] stats db failed to load:', err))

  // Exact item text -> bulk-exchange id ("Idol of the Martyr" -> "idol-of-the-martyr").
  let exchangeIds: Record<string, string> = {}
  // Orb image URLs for the buyout-price currency icons (served from GGG's CDN,
  // not committed — see the renderer's CSP img-src).
  const currencyIcons: Record<string, string> = {}
  const ICON_CURRENCIES = new Set(['exalted', 'divine', 'chaos'])
  const exchangeReady = cachedFetchJson<StaticPayload>(
    'static',
    'https://www.pathofexile.com/api/trade2/data/static'
  )
    .then((payload) => {
      for (const group of payload.result) {
        for (const entry of group.entries ?? []) {
          if (entry.id && entry.id !== 'sep' && entry.text) exchangeIds[entry.text] = entry.id
          if (entry.id && entry.image && ICON_CURRENCIES.has(entry.id)) {
            currencyIcons[entry.id] = entry.image.startsWith('http')
              ? entry.image
              : `https://web.poecdn.com${entry.image}`
          }
        }
      }
      console.log(`[data] exchange ids ready (${Object.keys(exchangeIds).length} items)`)
    })
    .catch((err) => console.error('[data] static data failed to load:', err))

  // Base names for extracting the true base from decorated white/magic names.
  let baseTypes: string[] = []
  const baseTypesReady = cachedFetchJson<ItemsPayload>(
    'items',
    'https://www.pathofexile.com/api/trade2/data/items'
  )
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
  const leaguesReady = cachedFetchJson<LeaguesPayload>(
    'leagues',
    'https://www.pathofexile.com/api/trade2/data/leagues'
  )
    .then((payload) => {
      leagues = payload.result.filter((l) => l.realm === 'poe2').map((l) => l.id)
      if (!leagues.includes(league)) league = leagues[0] ?? 'Standard'
      console.log(`[data] leagues: ${leagues.join(', ')} — using "${league}"`)
    })
    .catch((err) => console.error('[data] leagues failed to load:', err))

  // Dismiss the splash once the startup data has settled — but keep it up a
  // readable minimum so it never just flashes (everything may be disk-cached),
  // and cap the wait so a hung network can't trap it on screen forever.
  // splash.close() fades out and is idempotent, so both paths can call it.
  const SPLASH_MIN_MS = 2500
  const SPLASH_MAX_MS = 10_000
  void Promise.allSettled([statsReady, exchangeReady, baseTypesReady, leaguesReady]).then(
    async () => {
      const elapsed = Date.now() - splashStart
      if (elapsed < SPLASH_MIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS - elapsed))
      }
      splash.close()
    }
  )
  setTimeout(() => splash.close(), SPLASH_MAX_MS)

  let overlayBounds = { x: 0, y: 0, width: 0, height: 0 }
  // The popup's on-screen rect (overlay-local CSS px) reported by the renderer;
  // null when no popup is open. Doubles as the "popup visible" flag.
  type Rect = { x: number; y: number; w: number; h: number }
  let popupRect: Rect | null = null
  // The hovered listing's item tooltip rect (overlay-local CSS px), or null. It
  // lives outside popupRect, so it gets its own interactive region — otherwise
  // reaching for it would flip the overlay click-through and hide it.
  let tooltipRect: Rect | null = null
  // The update toast's rect; like the others it makes that region clickable, but
  // it never triggers auto-hide (the toast manages its own dismissal).
  let toastRect: Rect | null = null

  // While pinned, an outside click won't dismiss the popup, and a fresh price
  // check updates it in place without unpinning (issue #32). Reset to unpinned
  // only when the popup actually closes — see hidePopup() and the null popup-rect.
  let pinned = false

  let interactiveState = false
  const setInteractive = (interactive: boolean): void => {
    if (interactive === interactiveState) return
    interactiveState = interactive
    // No { forward: true }: forwarding moves to the renderer starves the game of
    // them and freezes its tooltip (see overlay.ts).
    overlay.setIgnoreMouseEvents(!interactive)
  }

  const releaseFocus = (): void => {
    if (overlay.isFocused()) overlay.blur()
    overlay.setFocusable(false)
  }

  const hidePopup = (): void => {
    overlay.webContents.send('tw:hide')
    popupRect = null
    tooltipRect = null
    pinned = false
    setInteractive(false)
    releaseFocus()
  }

  const within = (r: Rect | null, x: number, y: number): boolean =>
    r !== null && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

  // Overlay is click-through by default so the game always receives mouse-moves
  // (and manages its own tooltip). The popup stays open until the user dismisses
  // it (its ✕, Esc, or a fresh price check); we only hit-test the cursor to
  // capture the mouse while it is actually over an interactive widget — the
  // popup, the hovered listing tooltip, or the update toast — leaving the rest
  // of the screen click-through so the game stays playable.
  const onCursorMove = (): void => {
    // A trailing-edge throttle timer (below) can fire after quit has destroyed
    // the overlay; every branch here touches it, so bail before we throw
    // "Object has been destroyed" into the dying process.
    if (overlay.isDestroyed()) return
    if (!popupRect && !tooltipRect && !toastRect) {
      setInteractive(false)
      return
    }
    // A focused filter input keeps the popup interactive regardless of cursor.
    if (overlay.isFocused()) {
      setInteractive(true)
      return
    }
    const cur = screen.getCursorScreenPoint()
    const x = cur.x - overlayBounds.x
    const y = cur.y - overlayBounds.y
    setInteractive(within(popupRect, x, y) || within(tooltipRect, x, y) || within(toastRect, x, y))
  }

  // High-polling-rate mice fire mousemove thousands of times a second; each raw
  // event would otherwise cost a synchronous getCursorScreenPoint + hit-test.
  // Cap that to ~60Hz (leading edge immediate so entering/leaving the popup still
  // toggles click-through promptly, plus a trailing call so the final rest
  // position is always evaluated). Direct onCursorMove() calls elsewhere — after
  // a fresh rect, focus change, etc. — stay unthrottled; they're rare.
  const MOVE_INTERVAL_MS = 16
  let moveTrailing: ReturnType<typeof setTimeout> | null = null
  let lastMoveAt = 0
  const onCursorMoveThrottled = (): void => {
    const elapsed = Date.now() - lastMoveAt
    if (elapsed >= MOVE_INTERVAL_MS) {
      lastMoveAt = Date.now()
      onCursorMove()
    } else if (moveTrailing === null) {
      moveTrailing = setTimeout(() => {
        moveTrailing = null
        lastMoveAt = Date.now()
        onCursorMove()
      }, MOVE_INTERVAL_MS - elapsed)
    }
  }

  // Click-outside-to-close: with a popup open and unpinned, a mouse press
  // anywhere outside the popup (and its tooltip/toast satellites) dismisses it.
  // Presses inside those rects are the user working the popup; pinned keeps it
  // open regardless (only Esc / the ✕ close it then). The outside click still
  // passes to the game — outside the popup the overlay is click-through.
  const onMouseDown = (): void => {
    if (!popupRect || pinned) return
    const cur = screen.getCursorScreenPoint()
    const x = cur.x - overlayBounds.x
    const y = cur.y - overlayBounds.y
    if (within(popupRect, x, y) || within(tooltipRect, x, y) || within(toastRect, x, y)) return
    hidePopup()
  }

  let busy = false
  const priceCheck = async (): Promise<void> => {
    if (busy || !tracker.isGameActive || overlay.isFocused()) return
    busy = true
    try {
      const text = await grabItemText()
      // Nothing under the cursor — stay invisible. Most such presses are
      // accidental (Ctrl+D mid-run); a "copy failed" hint can come later if
      // silent failures ever become a debugging problem.
      if (!text) return
      let prepared: PreparedQuery | null = null
      if (statsDb) {
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
        currencyIcons,
        popupSize: config.popupSize,
        resultsHeight: config.resultsHeight,
        x: cursor.x - overlayBounds.x,
        y: cursor.y - overlayBounds.y
      } satisfies ItemPayload)
      // The renderer reports its rect via tw:popup-rect once laid out; from then
      // on onCursorMove drives interactivity and auto-hide.
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

  // Hotkeys are captured only while PoE2 is focused, so the rest of the
  // desktop keeps its shortcuts. Three tiers, best first:
  //  1. Native WH_KEYBOARD_LL addon — blocks in the hook itself, so the key
  //     never reaches the message queue *or* the key-state table the game
  //     polls for WASD movement (the leak globalShortcut can't plug).
  //  2. globalShortcut (RegisterHotKey) — swallows the message, but the key
  //     state still updates and a "D" hotkey steps the character.
  //  3. uiohook observe-only — fires the handler, keypress leaks entirely.
  const priceCheckKey =
    parseHotkey(config.priceCheckHotkey) ?? parseHotkey('Ctrl+D')!
  const hideoutKey = parseHotkey(config.hideoutHotkey) ?? parseHotkey('F5')!
  console.log(
    `[input] hotkeys: price check ${priceCheckKey.accelerator}, hideout ${hideoutKey.accelerator}`
  )

  const keyhook = NativeKeyHook.load()
  const nativeHooked =
    keyhook?.start(
      { priceCheck: priceCheckKey, hideout: hideoutKey },
      { onPriceCheck: () => void priceCheck(), onHideout: () => void goHideout() }
    ) ?? false
  if (nativeHooked) {
    input.setObserved({ priceCheck: false, hideout: false })
    console.log('[input] native key suppression active (WH_KEYBOARD_LL)')
  }

  let hotkeysClaimed = false
  const claimHotkeys = (): void => {
    if (hotkeysClaimed) return
    hotkeysClaimed = true
    if (nativeHooked) {
      keyhook!.setEnabled(true)
      return
    }
    const pc = globalShortcut.register(priceCheckKey.accelerator, () => void priceCheck())
    const ho = globalShortcut.register(hideoutKey.accelerator, () => void goHideout())
    input.setObserved({ priceCheck: !pc, hideout: !ho })
    if (!pc || !ho) {
      console.warn(
        `[input] could not claim ${[!pc && priceCheckKey.accelerator, !ho && hideoutKey.accelerator].filter(Boolean).join(', ')} — another app holds it; keypress will leak to the game`
      )
    }
  }
  const releaseHotkeys = (): void => {
    if (!hotkeysClaimed) return
    hotkeysClaimed = false
    if (nativeHooked) {
      keyhook!.setEnabled(false)
      return
    }
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

  input.start(
    {
      onPriceCheck: () => void priceCheck(),
      onHideout: () => void goHideout(),
      onEscape() {
        hidePopup()
      },
      onMouseMove() {
        onCursorMoveThrottled()
      },
      onMouseDown() {
        onMouseDown()
      }
    },
    { priceCheck: priceCheckKey, hideout: hideoutKey }
  )

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
      anchor,
      // Gear search is instant-buyout only — every listed price is real, so
      // don't discard the cheap end as bait. Stackable exchange still trims.
      { instantBuyout: !prepared.exchangeId }
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

  ipcMain.on(
    'tw:popup-rect',
    (_event, rect: { x: number; y: number; w: number; h: number } | null) => {
      popupRect = rect
      // The popup closed itself (its ✕): drop keyboard focus so the next click
      // goes to the game, restore click-through, and clear the pin.
      if (!rect) {
        tooltipRect = null
        pinned = false
        releaseFocus()
      }
      // Re-evaluate now so interactivity tracks a resized/moved popup even if the
      // cursor is momentarily still.
      onCursorMove()
    }
  )

  ipcMain.on(
    'tw:tooltip-rect',
    (_event, rect: { x: number; y: number; w: number; h: number } | null) => {
      tooltipRect = rect
      onCursorMove()
    }
  )

  ipcMain.on('tw:set-pinned', (_event, value: boolean) => {
    pinned = value === true
  })

  // The user finished dragging the resize handle — persist the new popup size so
  // it's restored on the next price check and after a restart.
  ipcMain.on('tw:set-popup-size', (_event, size: { w: number; h: number } | null) => {
    if (!size || typeof size.w !== 'number' || typeof size.h !== 'number') return
    config.popupSize = { w: Math.round(size.w), h: Math.round(size.h) }
    saveConfig(config)
  })

  // Likewise for the Price-tab results-list height.
  ipcMain.on('tw:set-results-height', (_event, height: number) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    config.resultsHeight = Math.round(height)
    saveConfig(config)
  })

  // Filter inputs need real keyboard focus; the window is non-focusable the
  // rest of the time so clicks never steal focus from the game.
  ipcMain.on('tw:focus-input', () => {
    overlay.setFocusable(true)
    overlay.focus()
  })

  // A focused filter input lost focus to something that isn't another input:
  // drop the keyboard grab so PoE2 reclaims focus (without closing the popup),
  // then re-evaluate click-through for the cursor's current position.
  ipcMain.on('tw:release-focus', () => {
    releaseFocus()
    onCursorMove()
  })

  ipcMain.on(
    'tw:toast-rect',
    (_event, rect: { x: number; y: number; w: number; h: number } | null) => {
      toastRect = rect
      onCursorMove()
    }
  )

  ipcMain.on('tw:download-update', () => downloadUpdate())
  ipcMain.on('tw:restart-update', () => quitAndInstall())

  tracker.start()

  app.on('will-quit', () => {
    // A pending trailing mousemove timer would fire onCursorMove against the
    // soon-to-be-destroyed overlay; drop it before teardown.
    if (moveTrailing !== null) clearTimeout(moveTrailing)
    // Teardown is best-effort cleanup of native addons; a throw here used to
    // surface as Electron's "JavaScript error in the main process" dialog mid
    // restart-to-install. Isolate each step so quit always completes quietly.
    const safe = (label: string, fn: () => void): void => {
      try {
        fn()
      } catch (err) {
        console.error(`[quit] ${label} cleanup failed:`, err)
      }
    }
    safe('globalShortcut', () => globalShortcut.unregisterAll())
    safe('keyhook', () => keyhook?.stop())
    safe('input', () => input.stop())
    safe('tracker', () => tracker.stop())
    safe('updater', () => stopAutoUpdater())
    safe('tray', () => tray.destroy())
  })

  console.log(
    `[tradewind] running — watching for "${config.gameWindowTitle}"` +
      (devAnyWindow ? ' (devAnyWindow: any foreground window matches)' : '')
  )
})
