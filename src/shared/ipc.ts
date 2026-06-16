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
  /** Persisted popup size (CSS px) the renderer restores the frame to, so a
   *  user's resize sticks across checks. */
  popupSize: { w: number; h: number }
  /** Persisted height (CSS px) of the Price-tab results list. */
  resultsHeight: number
}

/** Auto-update lifecycle, pushed main -> renderer. */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

/** The contextBridge surface exposed as window.tradewind. */
export interface TradewindApi {
  onItem(cb: (payload: ItemPayload) => void): void
  onHide(cb: () => void): void
  /** Build the trade body from edited filters, run search + first fetch. */
  search(prepared: PreparedQuery): Promise<SearchOutcome>
  setLeague(league: string): Promise<void>
  /**
   * Report the popup's on-screen rect (overlay-local CSS px) so the main process
   * can hit-test the cursor against it and toggle click-through; null when hidden.
   */
  setPopupRect(rect: { x: number; y: number; w: number; h: number } | null): void
  /**
   * Report the hovered item-tooltip's rect (overlay-local CSS px) so the main
   * process keeps that region interactive too; null when no tooltip is shown.
   */
  setTooltipRect(rect: { x: number; y: number; w: number; h: number } | null): void
  /**
   * Pin/unpin the popup. While pinned, a click outside the popup no longer
   * dismisses it (Esc and the ✕ still do); unpinned (the default), an outside
   * click closes it. Reset to unpinned on every fresh price check.
   */
  setPinned(pinned: boolean): void
  /**
   * Persist a user-chosen popup size (CSS px) so it's restored on the next price
   * check and after a restart. Reported when the user finishes dragging the
   * resize handle.
   */
  setPopupSize(size: { w: number; h: number }): void
  /**
   * Persist the Price-tab results-list height (CSS px) so it's restored on the
   * next price check and after a restart. Reported when the user finishes
   * dragging the results resize handle.
   */
  setResultsHeight(height: number): void
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
  /**
   * Report the update toast's on-screen rect (overlay-local CSS px) so the main
   * process makes that region clickable; null when the toast is hidden.
   */
  setToastRect(rect: { x: number; y: number; w: number; h: number } | null): void
}
