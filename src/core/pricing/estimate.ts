import type { Confidence, PriceEstimate, RateTable } from './types'

export interface PriceInput {
  amount: number
  currency: string
}

/** Listings under this fraction of the median are price-fixing bait. */
const LOWBALL_FRACTION = 0.5

export function median(sorted: number[]): number {
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** null when the currency has no known exalted rate. */
export function toExalted(price: PriceInput, rates: RateTable): number | null {
  const rate = rates[price.currency]
  return rate === undefined ? null : price.amount * rate
}

function confidenceFor(sampleSize: number, low: number, high: number): Confidence {
  // Spread is relative to the median: 0 = every comparable listing agrees.
  // Cheap items are quantized to whole exalted, so a couple of exalted of
  // absolute spread is "everyone agrees", whatever the ratio says.
  const spread = high > 0 ? (high - low) / high : 0
  const tight = spread <= 0.4 || high - low <= 2
  if (sampleSize >= 5 && tight) return 'high'
  if (sampleSize >= 3 && spread <= 1) return 'medium'
  return 'low'
}

/**
 * Cross-check against an independent aggregate price. Strong divergence
 * means the book we read is probably manipulated or mis-keyed — keep our
 * range (it reflects real listings) but stop claiming confidence.
 */
export function applyAnchor(estimate: PriceEstimate, anchorExalted: number): void {
  estimate.anchorExalted = anchorExalted
  if (anchorDiverges(estimate)) estimate.confidence = 'low'
}

/** True when the anchor sits far outside our range's midpoint. */
export function anchorDiverges(estimate: PriceEstimate): boolean {
  if (estimate.anchorExalted === undefined) return false
  const mid = (estimate.lowExalted + estimate.highExalted) / 2
  if (mid <= 0) return false
  const ratio = estimate.anchorExalted / mid
  return ratio > 2.5 || ratio < 0.4
}

/**
 * Estimate from the fetched listings (the cheapest the search returned).
 * The range reads "you'd pay between the cheapest credible listing and the
 * going rate": lowballs below half the median are trimmed first, then
 * low = cheapest survivor, high = median of survivors. Null when no listing
 * has a price in a known currency.
 */
export function estimatePrice(
  prices: PriceInput[],
  rates: RateTable,
  total: number
): PriceEstimate | null {
  const normalized: number[] = []
  let excludedCurrency = 0
  for (const price of prices) {
    if (price.amount <= 0) continue
    const exalted = toExalted(price, rates)
    if (exalted === null) excludedCurrency++
    else normalized.push(exalted)
  }
  if (normalized.length === 0) return null

  normalized.sort((a, b) => a - b)
  const cutoff = median(normalized) * LOWBALL_FRACTION
  const survivors = normalized.filter((v) => v >= cutoff)

  const low = survivors[0]
  const high = median(survivors)
  return {
    lowExalted: low,
    highExalted: high,
    confidence: confidenceFor(survivors.length, low, high),
    sampleSize: survivors.length,
    total,
    excludedCurrency,
    excludedLowball: normalized.length - survivors.length,
    cutoffExalted: cutoff,
    divineRate: rates['divine'] ?? null
  }
}
