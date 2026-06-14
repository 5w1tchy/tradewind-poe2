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

/** Anchor window: offers outside [0.4x, 2.5x] of the aggregate are noise. */
const ANCHOR_WINDOW_LOW = 0.4
const ANCHOR_WINDOW_HIGH = 2.5

/** True when the anchor sits far outside our range's midpoint. */
export function anchorDiverges(estimate: PriceEstimate): boolean {
  if (estimate.anchorExalted === undefined) return false
  const mid = (estimate.lowExalted + estimate.highExalted) / 2
  if (mid <= 0) return false
  const ratio = estimate.anchorExalted / mid
  return ratio > ANCHOR_WINDOW_HIGH || ratio < ANCHOR_WINDOW_LOW
}

/**
 * Estimate from the fetched listings (the cheapest the search returned).
 * The range reads "you'd pay between the cheapest credible listing and the
 * going rate": low = cheapest credible offer, high = median of the credible.
 *
 * "Credible" depends on what we know. With an independent aggregate price
 * (poe2scout), the book is read through its window — ask books float bait
 * floors AND delusion ceilings around the real cluster, and the window
 * finds that cluster. Without one (or when the whole book sits outside the
 * window), lowballs below half the median are trimmed and divergence from
 * the anchor caps confidence at low. Null when nothing is priceable.
 */
export function estimatePrice(
  prices: PriceInput[],
  rates: RateTable,
  total: number,
  anchorExalted?: number,
  options: { instantBuyout?: boolean } = {}
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

  // Window around an independent aggregate when we have one (works for any
  // book shape); else, on instant-buyout gear every listed price is genuinely
  // buyable so nothing is "bait" — keep them all; else (stackables) trim cheap
  // troll-ask walls below half the median.
  let cutoff = 0
  let survivors: number[]
  const windowLow = anchorExalted !== undefined ? anchorExalted * ANCHOR_WINDOW_LOW : 0
  const inWindow =
    anchorExalted !== undefined
      ? normalized.filter((v) => v >= windowLow && v <= anchorExalted * ANCHOR_WINDOW_HIGH)
      : []
  if (inWindow.length >= 3) {
    cutoff = windowLow
    survivors = inWindow
  } else if (options.instantBuyout) {
    survivors = normalized
  } else {
    cutoff = median(normalized) * LOWBALL_FRACTION
    survivors = normalized.filter((v) => v >= cutoff)
  }

  const low = survivors[0]
  const high = median(survivors)
  const estimate: PriceEstimate = {
    lowExalted: low,
    highExalted: high,
    confidence: confidenceFor(survivors.length, low, high),
    sampleSize: survivors.length,
    total,
    excludedCurrency,
    excludedLowball: normalized.filter((v) => v < cutoff).length,
    cutoffExalted: cutoff,
    divineRate: rates['divine'] ?? null
  }
  if (anchorExalted !== undefined) {
    estimate.anchorExalted = anchorExalted
    if (anchorDiverges(estimate)) estimate.confidence = 'low'
  }
  return estimate
}
