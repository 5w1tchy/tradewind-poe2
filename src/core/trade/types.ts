import type { PriceEstimate } from '../pricing/types'

/** One PoE property/requirement line: a name plus its display values. */
export interface ItemProperty {
  name: string
  /** PoE encodes each value as [displayText, valueType]; we only show the text. */
  values: Array<[string, number]>
}

/** One rolled prefix/suffix line, tagged like the trade site (P1, S3…). */
export interface ListingMod {
  text: string
  /** 'P' prefix (red tag) / 'S' suffix (blue tag) / null when the API omits it. */
  affix: 'P' | 'S' | null
  /** Affix tier (1 = best) or null. */
  tier: number | null
  /** Mod source, drives the text color: explicit | fractured | crafted | desecrated. */
  source: string
}

/**
 * The listed item's full detail, as returned by the trade /fetch endpoint —
 * enough to reconstruct an in-game-style tooltip so the user can eyeball how a
 * listing's mods differ from their own item. Absent for bulk-exchange offers.
 */
export interface ListingItem {
  /** Rarity bucket from frameType: normal | magic | rare | unique | gem | currency. */
  rarity: string
  /** Unique/rare name line; empty for normal/magic items. */
  name: string
  baseType: string
  ilvl?: number
  corrupted?: boolean
  /** Armour/damage/quality lines etc. */
  properties?: ItemProperty[]
  requirements?: ItemProperty[]
  enchantMods?: string[]
  implicitMods?: string[]
  /** Rune/"Bonded" flavour lines (no affix); shown above the affix block. */
  runeMods?: string[]
  /** Rolled prefixes/suffixes (explicit + fractured + crafted + desecrated), one block. */
  affixMods?: ListingMod[]
}

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
  /** Full item detail for the hover tooltip; absent for bulk-exchange offers. */
  item?: ListingItem
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
