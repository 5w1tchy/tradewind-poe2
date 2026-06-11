/** Exalted-per-unit conversion for each currency id ("exalted" itself is 1). */
export type RateTable = Record<string, number>

export type Confidence = 'high' | 'medium' | 'low'

export interface PriceEstimate {
  /** Cheapest realistic listing, in exalted. */
  lowExalted: number
  /** Median of the comparable listings, in exalted. */
  highExalted: number
  confidence: Confidence
  /** Listings the estimate is built on, after exclusions. */
  sampleSize: number
  /** Total results the search reported. */
  total: number
  /** Fetched listings skipped — currency missing from the rate table. */
  excludedCurrency: number
  /** Fetched listings trimmed as lowball bait below half the median. */
  excludedLowball: number
  /** The lowball threshold used, in exalted — listings under it are bait. */
  cutoffExalted: number
  /** Exalted per divine at estimate time; null when the live rate is unknown. */
  divineRate: number | null
}
