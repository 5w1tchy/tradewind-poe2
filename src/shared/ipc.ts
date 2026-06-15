import type { PreparedQuery } from '../core/query/types'
import type { SearchOutcome } from '../core/trade/types'

/** Sent main -> renderer on every price-check hotkey. */
export interface ItemPayload {
  x: number
  y: number
  /** Raw clipboard text — fallback display while the stats DB loads.
   *  An empty grab (no item under cursor) never reaches the renderer. */
  text: string
  /** null when parsing failed or the stats DB isn't ready yet. */
  prepared: PreparedQuery | null
  leagues: string[]
  league: string
  /** Currency id ("exalted"/"divine"/"chaos") -> orb image URL (GGG CDN), for
   *  the buyout-price icons. Empty until the static data has loaded. */
  currencyIcons: Record<string, string>
}

/** Auto-update lifecycle, pushed main -> renderer. */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

/** A rectangle in virtual (game-window-local) CSS pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The renderer's current on-screen footprint, reported whenever it changes so the
 * main process can size the overlay window to its content (the overlay is no
 * longer a fullscreen surface — a fullscreen transparent window is murderously
 * slow to composite when the GPU falls back to software/WARP).
 */
export interface OverlayLayout {
  /**
   * Bounding box (virtual px) the OS window should be sized/positioned to — the
   * union of every visible surface. null when nothing is shown (window hides).
   */
  window: Rect | null
  /**
   * The interactive sub-rects (virtual px) — popup, hovered tooltip, toast. The
   * main process hit-tests the cursor against these (not the bounding `window`,
   * whose gaps must stay click-through) to toggle capture vs. pass-through.
   */
  interactive: Rect[]
}

/** The contextBridge surface exposed as window.tradewind. */
export interface TradewindApi {
  onItem(cb: (payload: ItemPayload) => void): void
  onHide(cb: () => void): void
  /**
   * The virtual viewport size (the tracked game window's size, DIP) — the
   * coordinate space the renderer lays out in. Pushed on every game-rect change
   * so layout math no longer reads the (now content-sized) `window.innerWidth`.
   */
  onViewport(cb: (size: { w: number; h: number }) => void): void
  /** Build the trade body from edited filters, run search + first fetch. */
  search(prepared: PreparedQuery): Promise<SearchOutcome>
  setLeague(league: string): Promise<void>
  /** Report the current overlay footprint so main can size/hit-test the window. */
  setLayout(layout: OverlayLayout): void
  /** Grab keyboard focus for a filter input (released when the popup hides). */
  requestFocus(): void
  /**
   * Release the window's keyboard focus back to the game without closing the
   * popup — sent when a focused filter input loses focus to anything other than
   * another input (clicking the popup, a button, or back into the game).
   */
  releaseFocus(): void
  /** Open a pathofexile.com URL in the default browser. */
  openUrl(url: string): void
  /** Subscribe to auto-update status pushes. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): void
  /** Quit and install a downloaded update now (the toast's "Restart now"). */
  restartToUpdate(): void
}
