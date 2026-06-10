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
}

export interface SearchOutcome {
  searchId: string
  total: number
  /** True when the API flagged the count as approximate. */
  inexact: boolean
  listings: TradeListing[]
  /** Open-in-browser URL for the exact search. */
  webUrl: string
}
