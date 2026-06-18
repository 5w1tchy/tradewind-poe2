/**
 * Currency-exchange pricing types. Unlike rolled gear, currency-exchange items
 * (everything the in-game Currency Exchange / Ange trades — currency,
 * fragments, runes, essences, lineage gems, …) carry a single aggregate price
 * per item, sourced from poe2scout's periodic snapshot rather than a live order
 * book. One number plus a short price/volume history is the whole story.
 */

/** Exalted-per-unit for the two non-base display denominations. */
export interface ExchangeRates {
  /** Exalted per divine. */
  divine: number
  /** Exalted per chaos. */
  chaos: number
}

/** One historical price+volume sample for a currency-exchange item. */
export interface CurrencyPoint {
  /** ISO timestamp of the snapshot. */
  time: string
  /** Aggregate price at that time, in exalted. */
  priceExalted: number
  /** Units listed/traded in the window — a liquidity/confidence signal. */
  quantity: number
}

/**
 * A priced currency-exchange item, resolved from the poe2scout snapshot and
 * attached to the item payload. The chart history is fetched separately (see
 * getCurrencyHistory) so the popup can show the price the instant it opens.
 */
export interface CurrencyQuote {
  /** poe2scout/GGG trade id ("rakiatas-flow"); the join + history key. */
  apiId: string
  /** Display name ("Rakiata's Flow"). */
  text: string
  /** poe2scout category bucket ("lineagesupportgems", "currency", …). */
  category: string
  /** Item art URL (GGG CDN), or null. */
  iconUrl: string | null
  /** Current aggregate price, in exalted. */
  priceExalted: number
  /** Conversion rates to derive divine/chaos, in exalted per unit. */
  rates: ExchangeRates
}

/**
 * Aggregate price for a Unique item, resolved from the same poe2scout snapshot
 * as currency (the flat /Items endpoint also carries every unique) and shown as
 * an instant ballpark banner above the live search. Unlike currency, a unique
 * still prices live per-roll — this is a rough anchor, not the order book — so
 * the join is by Name+Type (uniques carry no ApiId) and there's no chart here.
 */
export interface UniqueQuote {
  /** Unique item name ("Bluetongue") — half the join key. */
  name: string
  /** Base type ("Shortsword") — the other half. */
  type: string
  /** Current aggregate price, in exalted. */
  priceExalted: number
  /** Item art URL (GGG CDN), or null. */
  iconUrl: string | null
  /** poe2scout numeric item id, for the optional history follow-up (#80). */
  itemId: number
  /** Conversion rates to derive divine/chaos, in exalted per unit. */
  rates: ExchangeRates
}

/** A price expressed in all three display denominations. */
export interface Denominations {
  exalted: number
  divine: number
  chaos: number
}

/** Market depth bucket derived from the history's quantities. */
export type Liquidity = 'deep' | 'moderate' | 'thin'
