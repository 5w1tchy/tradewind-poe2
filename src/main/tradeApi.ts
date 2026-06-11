import type { RateTable } from '../core/pricing'
import type { TradeSearchRequest } from '../core/query/types'
import type { SearchOutcome, TradeListing } from '../core/trade/types'
import { USER_AGENT } from './dataCache'

const API_BASE = 'https://www.pathofexile.com/api/trade2'

/** requests : window seconds : penalty seconds — the GGG header triplet. */
interface RateRule {
  max: number
  windowSec: number
}

// Seeds from live headers (2026-06-10); replaced by real headers after the
// first response, so GGG tightening limits mid-league is handled.
const SEARCH_SEED: RateRule[] = [
  { max: 5, windowSec: 10 },
  { max: 15, windowSec: 60 },
  { max: 30, windowSec: 300 }
]
const FETCH_SEED: RateRule[] = [
  { max: 12, windowSec: 4 },
  { max: 16, windowSec: 12 }
]
const EXCHANGE_SEED: RateRule[] = [
  { max: 5, windowSec: 15 },
  { max: 10, windowSec: 90 },
  { max: 30, windowSec: 300 }
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Longest pre-throttle pause we hide from the user; beyond this we fail fast. */
const MAX_SILENT_WAIT_MS = 10_000

export class RateLimitedError extends Error {
  constructor(readonly waitSeconds: number) {
    super(`Rate limited by GGG — try again in ~${waitSeconds}s`)
    this.name = 'RateLimitedError'
  }
}

/**
 * Sliding-window pre-throttle for one rate-limit policy. Counts our own
 * request timestamps against each rule (keeping one request in reserve so a
 * browser tab on the same IP doesn't tip us over) and waits out any penalty
 * the server reports.
 */
class RateLimiter {
  private rules: RateRule[]
  private sent: number[] = []
  private blockedUntil = 0

  constructor(seed: RateRule[]) {
    this.rules = seed
  }

  async waitTurn(): Promise<void> {
    for (;;) {
      const now = Date.now()
      let until = this.blockedUntil
      for (const rule of this.rules) {
        const budget = Math.max(1, rule.max - 1)
        const windowStart = now - rule.windowSec * 1000
        const inWindow = this.sent.filter((t) => t > windowStart)
        if (inWindow.length >= budget) {
          until = Math.max(until, inWindow[0] + rule.windowSec * 1000)
        }
      }
      if (until <= now) break
      // Long penalties (league-start 429s run minutes) must surface in the
      // popup, not leave it on "searching…" while blocking the whole queue.
      if (until - now > MAX_SILENT_WAIT_MS) {
        throw new RateLimitedError(Math.ceil((until - now) / 1000))
      }
      await sleep(until - now + 100)
    }
    this.sent.push(Date.now())
    const horizon = Math.max(...this.rules.map((r) => r.windowSec)) * 1000
    this.sent = this.sent.filter((t) => t > Date.now() - horizon)
  }

  /**
   * Adopt the server's current rules. Header format:
   *   X-Rate-Limit-Rules: Ip
   *   X-Rate-Limit-Ip: 5:10:60,15:60:300,30:300:1800   (max:window:penalty)
   *   X-Rate-Limit-Ip-State: 1:10:0,...                 (current:window:active-penalty)
   */
  updateFromHeaders(headers: Headers): void {
    const ruleNames = headers.get('x-rate-limit-rules')?.split(',') ?? []
    const rules: RateRule[] = []
    for (const name of ruleNames) {
      const spec = headers.get(`x-rate-limit-${name.trim().toLowerCase()}`)
      if (!spec) continue
      for (const triplet of spec.split(',')) {
        const [max, windowSec] = triplet.split(':').map(Number)
        if (Number.isFinite(max) && Number.isFinite(windowSec)) {
          rules.push({ max, windowSec })
        }
      }
      const state = headers.get(`x-rate-limit-${name.trim().toLowerCase()}-state`)
      if (state) {
        for (const triplet of state.split(',')) {
          const penalty = Number(triplet.split(':')[2])
          if (penalty > 0) this.blockFor(penalty)
        }
      }
    }
    if (rules.length > 0) this.rules = rules
  }

  blockFor(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + seconds * 1000)
  }
}

/** Serializes every trade API call so the limiters see a consistent world. */
class RequestQueue {
  private chain: Promise<unknown> = Promise.resolve()

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

interface RawSearchResponse {
  id: string
  result: string[]
  total: number
  inexact?: boolean
}

interface RawExchangeResponse {
  id: string
  result: Record<
    string,
    {
      id: string
      listing: {
        indexed: string
        account: { name: string; online: unknown }
        offers: Array<{
          exchange: { currency: string; amount: number }
          item: { currency: string; amount: number; stock: number }
        }>
      }
    }
  >
}

interface RawFetchResponse {
  result: Array<{
    id: string
    listing: {
      indexed: string
      price: { type?: string; amount: number; currency: string } | null
      account: { name: string; online: unknown }
    }
    item: { name?: string; typeLine?: string; baseType?: string }
  } | null>
}

export class TradeApiClient {
  private queue = new RequestQueue()
  private limiters = {
    search: new RateLimiter(SEARCH_SEED),
    fetch: new RateLimiter(FETCH_SEED),
    exchange: new RateLimiter(EXCHANGE_SEED)
  }

  /** Run a search and fetch the first `count` listings (one fetch call, ≤10). */
  async searchWithListings(
    league: string,
    body: TradeSearchRequest,
    count = 10
  ): Promise<SearchOutcome> {
    const leaguePath = encodeURIComponent(league)
    const search = await this.request<RawSearchResponse>(
      'search',
      `${API_BASE}/search/poe2/${leaguePath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )

    let listings: TradeListing[] = []
    const ids = search.result.slice(0, Math.min(count, 10))
    if (ids.length > 0) {
      const fetched = await this.request<RawFetchResponse>(
        'fetch',
        `${API_BASE}/fetch/${ids.join(',')}?query=${search.id}&realm=poe2`,
        { method: 'GET' }
      )
      listings = fetched.result
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ({
          id: r.id,
          price: r.listing.price
            ? {
                amount: r.listing.price.amount,
                currency: r.listing.price.currency,
                type: r.listing.price.type ?? ''
              }
            : null,
          accountName: r.listing.account?.name ?? '?',
          indexed: r.listing.indexed,
          itemName: [r.item.name, r.item.typeLine ?? r.item.baseType]
            .filter(Boolean)
            .join(' '),
          online: Boolean(r.listing.account?.online)
        }))
    }

    return {
      searchId: search.id,
      total: search.total,
      inexact: search.inexact ?? false,
      listings,
      webUrl: `https://www.pathofexile.com/trade2/search/poe2/${leaguePath}/${search.id}`
    }
  }

  /**
   * Price a stackable on the bulk exchange. Asks for offers in every
   * currency with a known rate — high-value books (omens, some essences)
   * are denominated in divine, and an exalted-only query reads junk asks.
   */
  async exchange(
    league: string,
    wantId: string,
    opts: { have?: string[]; rates?: RateTable } = {}
  ): Promise<SearchOutcome> {
    const rates = opts.rates ?? { exalted: 1 }
    const have = opts.have ?? Object.keys(rates)
    const leaguePath = encodeURIComponent(league)
    const res = await this.request<RawExchangeResponse>(
      'exchange',
      `${API_BASE}/exchange/poe2/${leaguePath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: { status: { option: 'online' }, have, want: [wantId] },
          sort: { have: 'asc' },
          engine: 'new'
        })
      }
    )

    const listings: TradeListing[] = []
    for (const entry of Object.values(res.result)) {
      // One listing can quote several have-currencies — each ask is its own row.
      for (const offer of entry.listing.offers) {
        listings.push({
          id: `${entry.id}:${offer.exchange.currency}`,
          price: {
            amount: offer.exchange.amount / offer.item.amount,
            currency: offer.exchange.currency,
            type: 'exchange'
          },
          accountName: entry.listing.account?.name ?? '?',
          indexed: entry.listing.indexed,
          itemName: wantId,
          online: Boolean(entry.listing.account?.online),
          stock: offer.item.stock
        })
      }
    }
    const inExalted = (l: TradeListing): number => {
      const rate = l.price ? rates[l.price.currency] : undefined
      return rate === undefined ? Number.POSITIVE_INFINITY : l.price!.amount * rate
    }
    listings.sort((a, b) => inExalted(a) - inExalted(b))

    return {
      searchId: res.id,
      total: listings.length,
      inexact: listings.length >= 20,
      listings: listings.slice(0, 10),
      webUrl: `https://www.pathofexile.com/trade2/exchange/poe2/${leaguePath}/${res.id}`
    }
  }

  private request<T>(
    kind: 'search' | 'fetch' | 'exchange',
    url: string,
    init: RequestInit
  ): Promise<T> {
    return this.queue.enqueue(async () => {
      const limiter = this.limiters[kind]
      const headers = { ...(init.headers as Record<string, string>), 'User-Agent': USER_AGENT }

      for (let attempt = 0; ; attempt++) {
        await limiter.waitTurn()
        const res = await fetch(url, { ...init, headers })
        limiter.updateFromHeaders(res.headers)

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '10')
          limiter.blockFor(retryAfter)
          if (attempt === 0 && retryAfter * 1000 <= MAX_SILENT_WAIT_MS) {
            console.warn(`[trade] 429 on ${kind}, retrying after ${retryAfter}s`)
            continue
          }
          console.warn(`[trade] 429 on ${kind}, penalty ${retryAfter}s — surfacing`)
          throw new RateLimitedError(retryAfter)
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`trade ${kind} HTTP ${res.status}: ${text.slice(0, 300)}`)
        }
        return (await res.json()) as T
      }
    })
  }
}
