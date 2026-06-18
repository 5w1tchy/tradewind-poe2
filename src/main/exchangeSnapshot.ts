import type { CurrencyPoint, CurrencyQuote, ExchangeRates, UniqueQuote } from '../core/exchange'
import { cachedFetchJson, USER_AGENT } from './dataCache'

const REALM = 'poe2'
const API_BASE = `https://poe2scout.com/api/${REALM}`
// poe2scout recomputes its snapshot ~every 6h; revalidate this often (an ETag
// 304 keeps it cheap) so prices don't drift far, but don't refetch every check.
const SNAPSHOT_FRESH_MS = 30 * 60 * 1000
// Reparsing the 450KB snapshot on every currency check is wasteful — hold the
// built index in memory this long before rebuilding it from the disk cache.
const INDEX_TTL_MS = 5 * 60 * 1000
const HISTORY_TTL_MS = 15 * 60 * 1000

/** Flat /Items row — everything tradeable on the exchange, one aggregate price. */
interface RawItem {
  ItemId: number
  CategoryApiId: string
  Text: string
  Name?: string | null
  Type?: string | null
  ApiId?: string | null
  CurrentPrice: number
  IconUrl?: string | null
}

interface RawPriceLog {
  Price: number
  Time: string
  Quantity: number
}

interface RawCurrencyDetail {
  ApiId: string
  PriceLogs: Array<RawPriceLog | null>
}

interface SnapshotIndex {
  byApiId: Map<string, RawItem>
  /** Uniques keyed by `name|type` (they carry no ApiId) — see uniqueKey. */
  byNameType: Map<string, RawItem>
  rates: ExchangeRates
}

/** Per-league disk-cache file name, kept filesystem-safe. */
function snapshotName(league: string): string {
  return `poe2scout-items-${league.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** Join key for a unique row — case/space-insensitive so a parsed Name+Type
 *  matches the snapshot regardless of incidental casing. */
function uniqueKey(name: string, type: string): string {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')
  return `${norm(name)}|${norm(type)}`
}

/**
 * Currency-exchange prices from poe2scout's periodic snapshot. The flat /Items
 * endpoint returns one aggregate exalted price for every exchange item in a
 * single request (cached to disk with ETag revalidation); per-item price/volume
 * history is fetched lazily for the chart. Strictly optional — every miss or
 * failure degrades to "no quote", leaving the live exchange path as the
 * fallback. The live trade order book is never the source here.
 */
export class ExchangeSnapshotProvider {
  private index = new Map<string, { value: SnapshotIndex; at: number }>()
  private indexPending = new Map<string, Promise<SnapshotIndex>>()
  private history = new Map<string, { value: CurrencyPoint[]; at: number }>()
  private historyPending = new Map<string, Promise<CurrencyPoint[]>>()

  /**
   * Aggregate quote for an exchange item, keyed by its trade id (which matches
   * GGG's static exchange id and poe2scout's ApiId). null when the snapshot is
   * unavailable or doesn't carry the item.
   */
  async quote(league: string, apiId: string): Promise<CurrencyQuote | null> {
    let snap: SnapshotIndex
    try {
      snap = await this.loadIndex(league)
    } catch (err) {
      console.warn('[exchange] snapshot unavailable:', err)
      return null
    }
    const row = snap.byApiId.get(apiId)
    if (!row || typeof row.CurrentPrice !== 'number' || row.CurrentPrice <= 0) return null
    return {
      apiId,
      text: row.Text,
      category: row.CategoryApiId,
      iconUrl: row.IconUrl ?? null,
      priceExalted: row.CurrentPrice,
      rates: snap.rates
    }
  }

  /**
   * Aggregate quote for a Unique item, joined on Name+Type (uniques carry no
   * ApiId). The same snapshot that prices currency also lists every unique, so
   * this is free at check time. null when the snapshot is unavailable or doesn't
   * carry the unique — the renderer simply shows no banner and the live search
   * stays the source of truth (#80).
   */
  async uniqueQuote(league: string, name: string, type: string): Promise<UniqueQuote | null> {
    let snap: SnapshotIndex
    try {
      snap = await this.loadIndex(league)
    } catch (err) {
      console.warn('[exchange] snapshot unavailable:', err)
      return null
    }
    const row = snap.byNameType.get(uniqueKey(name, type))
    if (!row || typeof row.CurrentPrice !== 'number' || row.CurrentPrice <= 0) return null
    return {
      name: row.Name ?? name,
      type: row.Type ?? type,
      priceExalted: row.CurrentPrice,
      iconUrl: row.IconUrl ?? null,
      itemId: row.ItemId,
      rates: snap.rates
    }
  }

  /** Recent price/volume history (ascending time) for the chart; [] on failure. */
  async getHistory(league: string, apiId: string): Promise<CurrencyPoint[]> {
    const key = `${league}:${apiId}`
    const cached = this.history.get(key)
    if (cached && Date.now() - cached.at < HISTORY_TTL_MS) return cached.value
    const inFlight = this.historyPending.get(key)
    if (inFlight) return inFlight
    const job = this.fetchHistory(league, apiId)
      .then((value) => {
        this.history.set(key, { value, at: Date.now() })
        return value
      })
      .catch((err) => {
        console.warn(`[exchange] history failed for ${apiId}:`, err)
        return cached?.value ?? []
      })
      .finally(() => this.historyPending.delete(key))
    this.historyPending.set(key, job)
    return job
  }

  private async fetchHistory(league: string, apiId: string): Promise<CurrencyPoint[]> {
    const url = `${API_BASE}/Leagues/${encodeURIComponent(league)}/Currencies/${encodeURIComponent(apiId)}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`scout history HTTP ${res.status}`)
    const detail = (await res.json()) as RawCurrencyDetail
    // PriceLogs arrive newest-first with null gaps (the in-progress bucket);
    // drop the gaps and reverse to ascending time for the chart.
    return (detail.PriceLogs ?? [])
      .filter((p): p is RawPriceLog => p != null && typeof p.Price === 'number')
      .map((p) => ({ time: p.Time, priceExalted: p.Price, quantity: p.Quantity ?? 0 }))
      .reverse()
  }

  private loadIndex(league: string): Promise<SnapshotIndex> {
    const entry = this.index.get(league)
    if (entry && Date.now() - entry.at < INDEX_TTL_MS) return Promise.resolve(entry.value)
    const inFlight = this.indexPending.get(league)
    if (inFlight) return inFlight
    const job = this.buildIndex(league)
      .then((value) => {
        this.index.set(league, { value, at: Date.now() })
        return value
      })
      .finally(() => this.indexPending.delete(league))
    this.indexPending.set(league, job)
    // A live fetch failure with a stale in-memory index still serves the stale one.
    return entry ? job.catch(() => entry.value) : job
  }

  private async buildIndex(league: string): Promise<SnapshotIndex> {
    const url = `${API_BASE}/Leagues/${encodeURIComponent(league)}/Items`
    const items = await cachedFetchJson<RawItem[]>(snapshotName(league), url, SNAPSHOT_FRESH_MS)
    const byApiId = new Map<string, RawItem>()
    const byNameType = new Map<string, RawItem>()
    for (const item of items) {
      if (item.ApiId && !byApiId.has(item.ApiId)) byApiId.set(item.ApiId, item)
      // Uniques have no ApiId but carry Name+Type — index them for #80's banner.
      if (item.Name && item.Type) {
        const key = uniqueKey(item.Name, item.Type)
        if (!byNameType.has(key)) byNameType.set(key, item)
      }
    }
    const priceOf = (id: string): number => byApiId.get(id)?.CurrentPrice ?? 0
    const rates: ExchangeRates = { divine: priceOf('divine'), chaos: priceOf('chaos') }
    console.log(
      `[exchange] snapshot ready for ${league} (${byApiId.size} exchange, ${byNameType.size} uniques)`
    )
    return { byApiId, byNameType, rates }
  }
}
