import { describe, expect, it } from 'vitest'
import {
  formatAmount,
  formatTrend,
  liquidityOf,
  priceTrend,
  toDenominations
} from './index'
import type { CurrencyPoint, ExchangeRates } from './types'

const RATES: ExchangeRates = { divine: 201.44, chaos: 19.56 }

function pts(values: Array<[number, number]>): CurrencyPoint[] {
  // [priceExalted, quantity] in ascending time order.
  return values.map(([priceExalted, quantity], i) => ({
    time: `2026-06-16T${String(i).padStart(2, '0')}:00:00`,
    priceExalted,
    quantity
  }))
}

describe('toDenominations', () => {
  it('converts an exalted price into div/chaos via the rates', () => {
    const d = toDenominations(22570, RATES)
    expect(d.exalted).toBe(22570)
    expect(d.divine).toBeCloseTo(112.04, 1)
    expect(d.chaos).toBeCloseTo(1153.9, 0)
  })

  it('degrades to 0 rather than Infinity when a rate is missing', () => {
    const d = toDenominations(100, { divine: 0, chaos: 0 })
    expect(d.divine).toBe(0)
    expect(d.chaos).toBe(0)
    expect(d.exalted).toBe(100)
  })
})

describe('priceTrend', () => {
  it('is the first-to-last percent change', () => {
    expect(priceTrend(pts([[100, 1], [110, 1], [120, 1]]))).toBeCloseTo(20, 5)
  })

  it('goes negative when the price fell', () => {
    expect(priceTrend(pts([[200, 1], [150, 1]]))).toBeCloseTo(-25, 5)
  })

  it('is 0 with fewer than two points or a zero open', () => {
    expect(priceTrend(pts([[100, 1]]))).toBe(0)
    expect(priceTrend([])).toBe(0)
    expect(priceTrend(pts([[0, 1], [50, 1]]))).toBe(0)
  })
})

describe('liquidityOf', () => {
  it('reads deep/moderate/thin from the median quantity', () => {
    expect(liquidityOf(pts([[1, 500], [1, 800], [1, 466]]))).toBe('deep')
    expect(liquidityOf(pts([[1, 40], [1, 60], [1, 50]]))).toBe('moderate')
    expect(liquidityOf(pts([[1, 3], [1, 5], [1, 2]]))).toBe('thin')
  })

  it('treats an empty/zero-volume history as thin', () => {
    expect(liquidityOf([])).toBe('thin')
    expect(liquidityOf(pts([[1, 0], [1, 0]]))).toBe('thin')
  })
})

describe('formatAmount', () => {
  it('thousands-separates large values and decimals small ones', () => {
    expect(formatAmount(22570)).toBe('22,570')
    expect(formatAmount(112.04)).toBe('112.0')
    expect(formatAmount(0.45)).toBe('0.45')
    expect(formatAmount(NaN)).toBe('—')
  })
})

describe('formatTrend', () => {
  it('signs the percent with a real minus glyph', () => {
    expect(formatTrend(21.7)).toBe('+21.7%')
    expect(formatTrend(-4.04)).toBe('−4.0%')
    expect(formatTrend(0)).toBe('0%')
  })
})
