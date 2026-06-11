import { USER_AGENT } from './dataCache'

const TTL_MS = 30 * 60 * 1000

interface ScoutEntry {
  Text?: string
  Name?: string
  CurrentPrice?: number
}

/**
 * poe2scout.com aggregate prices as a sanity anchor (exalted per unit).
 * Strictly optional: failures and misses degrade to "no anchor", never an
 * error — the live order book stays the primary source.
 */
export class ScoutAnchorProvider {
  private cache = new Map<string, { prices: Map<string, number>; fetchedAt: number }>()
  private pending = new Map<string, Promise<Map<string, number>>>()

  async get(league: string): Promise<Map<string, number>> {
    const entry = this.cache.get(league)
    if (entry) {
      if (Date.now() - entry.fetchedAt > TTL_MS) {
        this.refresh(league).catch((err) => console.warn('[scout] refresh failed:', err))
      }
      return entry.prices
    }
    try {
      return await this.refresh(league)
    } catch (err) {
      console.warn('[scout] anchor unavailable:', err)
      return new Map()
    }
  }

  private refresh(league: string): Promise<Map<string, number>> {
    const inFlight = this.pending.get(league)
    if (inFlight) return inFlight
    const job = this.fetch(league).finally(() => this.pending.delete(league))
    this.pending.set(league, job)
    return job
  }

  private async fetch(league: string): Promise<Map<string, number>> {
    const url = `https://poe2scout.com/api/poe2/Leagues/${encodeURIComponent(league)}/Items`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`scout HTTP ${res.status}`)
    const entries = (await res.json()) as ScoutEntry[]
    const prices = new Map<string, number>()
    for (const e of entries) {
      if (typeof e.CurrentPrice !== 'number' || e.CurrentPrice <= 0) continue
      // Uniques carry the clean name in Name; currency/stackables in Text.
      const key = e.Name || e.Text
      if (key && !prices.has(key)) prices.set(key, e.CurrentPrice)
      if (e.Text && !prices.has(e.Text)) prices.set(e.Text, e.CurrentPrice)
    }
    this.cache.set(league, { prices, fetchedAt: Date.now() })
    console.log(`[scout] anchor ready for ${league} (${prices.size} prices)`)
    return prices
  }
}
