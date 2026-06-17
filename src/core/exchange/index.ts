import type { CurrencyPoint, Denominations, ExchangeRates, Liquidity } from './types'

export type {
  CurrencyPoint,
  CurrencyQuote,
  Denominations,
  ExchangeRates,
  Liquidity
} from './types'

/** Express an exalted price in all three denominations (0 when a rate is unset). */
export function toDenominations(exalted: number, rates: ExchangeRates): Denominations {
  return {
    exalted,
    divine: rates.divine > 0 ? exalted / rates.divine : 0,
    chaos: rates.chaos > 0 ? exalted / rates.chaos : 0
  }
}

/**
 * Percent change from the first to the last sample. 0 when there's nothing to
 * compare (fewer than two points, or a non-positive opening price).
 */
export function priceTrend(history: CurrencyPoint[]): number {
  if (history.length < 2) return 0
  const first = history[0].priceExalted
  const last = history[history.length - 1].priceExalted
  if (first <= 0) return 0
  return ((last - first) / first) * 100
}

/**
 * Market depth from the typical (median) quantity across the window — our
 * confidence cue, standing in for the outlier math the live order book needs.
 * Thresholds are deliberately coarse: this only drives a one-word label.
 */
export function liquidityOf(history: CurrencyPoint[]): Liquidity {
  const qtys = history.map((p) => p.quantity).filter((q) => q > 0)
  if (qtys.length === 0) return 'thin'
  qtys.sort((a, b) => a - b)
  const mid = qtys[Math.floor(qtys.length / 2)]
  if (mid >= 200) return 'deep'
  if (mid >= 30) return 'moderate'
  return 'thin'
}

/**
 * Compact human number for a denomination amount: thousands-separated whole
 * numbers at scale, one decimal in the single/double/triple-digit range, two
 * below one. "22,570", "112.0", "0.45".
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 1) return n.toFixed(1)
  return n.toFixed(2)
}

/** "+21.7%" / "−4.0%" / "0%" — signed, one decimal, real minus glyph. */
export function formatTrend(percent: number): string {
  const r = Math.round(percent * 10) / 10
  if (r === 0) return '0%'
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`
}
