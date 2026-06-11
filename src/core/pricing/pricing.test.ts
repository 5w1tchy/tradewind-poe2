import { describe, expect, it } from 'vitest'
import {
  anchorDiverges,
  applyAnchor,
  estimatePrice,
  formatEstimateRange,
  formatExalted
} from './index'
import type { RateTable } from './types'

const RATES: RateTable = { exalted: 1, divine: 300, chaos: 6 }

function ex(amounts: number[]): Array<{ amount: number; currency: string }> {
  return amounts.map((amount) => ({ amount, currency: 'exalted' }))
}

describe('estimatePrice', () => {
  it('clean cluster: min to median, high confidence', () => {
    const est = estimatePrice(ex([5, 5, 6, 6, 7, 8, 9, 10]), RATES, 134)!
    expect(est.lowExalted).toBe(5)
    expect(est.highExalted).toBe(6.5)
    expect(est.confidence).toBe('high')
    expect(est.sampleSize).toBe(8)
    expect(est.total).toBe(134)
  })

  it('trims lowballs below half the median', () => {
    const est = estimatePrice(ex([1, 1, 10, 11, 12, 13, 14]), RATES, 50)!
    expect(est.excludedLowball).toBe(2)
    expect(est.cutoffExalted).toBe(5.5) // half the pre-trim median of 11
    expect(est.lowExalted).toBe(10)
    expect(est.highExalted).toBe(12)
    expect(est.confidence).toBe('high')
  })

  it('normalizes divine and chaos listings through the rate table', () => {
    const est = estimatePrice(
      [
        { amount: 290, currency: 'exalted' },
        { amount: 1, currency: 'divine' },
        { amount: 52, currency: 'chaos' },
        { amount: 320, currency: 'exalted' }
      ],
      RATES,
      12
    )!
    expect(est.sampleSize).toBe(4)
    expect(est.lowExalted).toBe(290)
    expect(est.highExalted).toBe(306) // median of 290, 300, 312, 320
  })

  it('excludes unknown currencies from the estimate but counts them', () => {
    const est = estimatePrice(
      [...ex([10, 11, 12]), { amount: 3, currency: 'annul' }],
      RATES,
      20
    )!
    expect(est.excludedCurrency).toBe(1)
    expect(est.sampleSize).toBe(3)
  })

  it('quantized cheap book: 1-2 ex spread is agreement, not scatter', () => {
    // Live Greater Iron Rune book 2026-06-11: whole-exalted price steps make
    // the relative spread huge while the market is in perfect agreement.
    const book = [
      ...Array(24).fill(1),
      ...Array(28).fill(2),
      ...Array(36).fill(3),
      ...Array(11).fill(4),
      5
    ] as number[]
    const est = estimatePrice(ex(book), RATES, 100)!
    expect(est.lowExalted).toBe(1)
    expect(est.highExalted).toBe(2)
    expect(est.confidence).toBe('high')
  })

  it('single listing: estimate exists but confidence is low', () => {
    const est = estimatePrice(ex([25]), RATES, 1)!
    expect(est.lowExalted).toBe(25)
    expect(est.highExalted).toBe(25)
    expect(est.confidence).toBe('low')
  })

  it('wide spread caps confidence at medium, huge spread at low', () => {
    expect(estimatePrice(ex([10, 14, 18]), RATES, 30)!.confidence).toBe('medium')
    expect(estimatePrice(ex([10, 100, 400]), RATES, 30)!.confidence).toBe('low')
  })

  it('null when nothing is priceable', () => {
    expect(estimatePrice([], RATES, 0)).toBeNull()
    expect(estimatePrice([{ amount: 5, currency: 'annul' }], RATES, 3)).toBeNull()
    expect(estimatePrice(ex([0]), RATES, 1)).toBeNull()
  })

  it('survives a missing divine rate', () => {
    const est = estimatePrice(ex([5, 6, 7]), { exalted: 1 }, 9)!
    expect(est.divineRate).toBeNull()
    expect(est.highExalted).toBe(6)
  })
})

describe('applyAnchor', () => {
  it('agreeing anchor attaches without touching confidence', () => {
    const est = estimatePrice(ex([5, 5, 6, 6, 7, 8, 9, 10]), RATES, 100)!
    applyAnchor(est, 7)
    expect(est.anchorExalted).toBe(7)
    expect(est.confidence).toBe('high')
    expect(anchorDiverges(est)).toBe(false)
  })

  it('divergent anchor drops confidence to low', () => {
    // Bait wall won: book says 10-25 ex, aggregate says ~500 ex.
    const est = estimatePrice(ex([10, 20, 20, 25, 30]), RATES, 60)!
    applyAnchor(est, 500)
    expect(est.confidence).toBe('low')
    expect(anchorDiverges(est)).toBe(true)
  })
})

describe('formatting', () => {
  it('formats exalted with sane rounding', () => {
    expect(formatExalted(5, 300)).toBe('5 ex')
    expect(formatExalted(3.46, 300)).toBe('3.5 ex')
    expect(formatExalted(147.4, 300)).toBe('147 ex')
  })

  it('switches to divine at one divine', () => {
    expect(formatExalted(300, 300)).toBe('1 div')
    expect(formatExalted(450, 300)).toBe('1.5 div')
    expect(formatExalted(450, null)).toBe('450 ex')
  })

  it('formats ranges in one unit, collapsing equal ends', () => {
    const base = {
      confidence: 'high' as const,
      sampleSize: 8,
      total: 100,
      excludedCurrency: 0,
      excludedLowball: 0,
      cutoffExalted: 0
    }
    expect(
      formatEstimateRange({ ...base, lowExalted: 5, highExalted: 8, divineRate: 300 })
    ).toBe('5–8 ex')
    expect(
      formatEstimateRange({ ...base, lowExalted: 280, highExalted: 390, divineRate: 300 })
    ).toBe('0.9–1.3 div')
    expect(
      formatEstimateRange({ ...base, lowExalted: 25, highExalted: 25.4, divineRate: 300 })
    ).toBe('25 ex')
  })
})
