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
}

/** The contextBridge surface exposed as window.tradewind. */
export interface TradewindApi {
  onItem(cb: (payload: ItemPayload) => void): void
  onHide(cb: () => void): void
  /** Build the trade body from edited filters, run search + first fetch. */
  search(prepared: PreparedQuery): Promise<SearchOutcome>
  setLeague(league: string): Promise<void>
  /** Popup hover state: true makes the overlay clickable. */
  setInteractive(interactive: boolean): void
  /** Grab keyboard focus for a filter input (released when the popup hides). */
  requestFocus(): void
  /** Open a pathofexile.com URL in the default browser. */
  openUrl(url: string): void
}
