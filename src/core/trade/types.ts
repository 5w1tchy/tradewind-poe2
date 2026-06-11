import type { PriceEstimate } from '../pricing/types'

/** Slim, IPC-safe view of one trade listing for the popup. */
export interface TradeListing {
  id: string
  price: {
    amount: number
    currency: string
    /** "~b/o" | "~price" — informational only. */
    type: string
  } | null
  accountName: string
  /** ISO timestamp the listing was indexed. */
  indexed: string
  /** Item name + base as listed (for mismatch spotting). */
  itemName: string
  online: boolean
  /** Units available at this price (bulk-exchange offers only). */
  stock?: number
  /** Currency has no exalted rate — listing shown but outside the estimate. */
  unpriceable?: boolean
  /** Priced under the lowball cutoff — likely bait, outside the estimate. */
  lowball?: boolean
}

export interface SearchOutcome {
  searchId: string
  total: number
  /** True when the API flagged the count as approximate. */
  inexact: boolean
  listings: TradeListing[]
  /** Open-in-browser URL for the exact search. */
  webUrl: string
  /** Aggregated price estimate; absent until the price brain fills it in. */
  estimate?: PriceEstimate | null
}
