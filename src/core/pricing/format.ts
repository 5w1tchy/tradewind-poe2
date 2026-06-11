import type { PriceEstimate } from './types'

function round(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return String(rounded)
}

/** "14 ex", "3.5 ex", or "2.1 div" once the value crosses one divine. */
export function formatExalted(exalted: number, divineRate: number | null): string {
  if (divineRate !== null && divineRate > 0 && exalted >= divineRate) {
    return `${round(exalted / divineRate)} div`
  }
  return `${round(exalted)} ex`
}

/** "5–8 ex", "1.2–1.5 div" — collapses to one number when the range does. */
export function formatEstimateRange(estimate: PriceEstimate): string {
  const { lowExalted, highExalted, divineRate } = estimate
  const high = formatExalted(highExalted, divineRate)
  if (formatExalted(lowExalted, divineRate) === high) return high
  // Same unit for both ends: the high end picks it.
  const inDivine = high.endsWith('div')
  const lowNumber =
    inDivine && divineRate ? round(lowExalted / divineRate) : round(lowExalted)
  return `${lowNumber}–${high}`
}
