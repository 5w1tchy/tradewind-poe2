import { median, type RateTable } from '../core/pricing'
import type { TradeApiClient } from './tradeApi'

const TTL_MS = 30 * 60 * 1000

/** Currencies worth a bulk-exchange lookup; everything else stays unpriceable. */
const RATE_CURRENCIES = ['divine', 'chaos'] as const

/**
 * Live exalted rates per league via the bulk exchange. Serves stale values
 * immediately and refreshes in the background past the TTL, so a price check
 * never waits on a rate older than one request cycle.
 */
export class RatesProvider {
  private cache = new Map<string, { rates: RateTable; fetchedAt: number }>()
  private pending = new Map<string, Promise<RateTable>>()

  constructor(private client: TradeApiClient) {}

  async get(league: string): Promise<RateTable> {
    const entry = this.cache.get(league)
    if (entry) {
      if (Date.now() - entry.fetchedAt > TTL_MS) {
        this.refresh(league).catch((err) => console.warn('[rates] refresh failed:', err))
      }
      return entry.rates
    }
    try {
      return await this.refresh(league)
    } catch (err) {
      console.warn('[rates] fetch failed — estimating from exalted listings only:', err)
      return { exalted: 1 }
    }
  }

  private refresh(league: string): Promise<RateTable> {
    const inFlight = this.pending.get(league)
    if (inFlight) return inFlight
    const job = this.fetchRates(league).finally(() => this.pending.delete(league))
    this.pending.set(league, job)
    return job
  }

  private async fetchRates(league: string): Promise<RateTable> {
    const rates: RateTable = { exalted: 1 }
    for (const id of RATE_CURRENCIES) {
      try {
        const outcome = await this.client.exchange(league, id)
        // Offers arrive cheapest-first; the median of the five best resists
        // both bait undercuts and one weird seller.
        const cheapest = outcome.listings
          .map((l) => l.price?.amount)
          .filter((a): a is number => typeof a === 'number' && a > 0)
          .slice(0, 5)
        if (cheapest.length > 0) rates[id] = median(cheapest)
      } catch (err) {
        console.warn(`[rates] ${id} rate unavailable:`, err)
      }
    }
    this.cache.set(league, { rates, fetchedAt: Date.now() })
    console.log(
      `[rates] ${league}: 1 div = ${rates['divine'] ?? '?'} ex, 1 chaos = ${rates['chaos'] ?? '?'} ex`
    )
    return rates
  }
}
