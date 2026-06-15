import type {
  MinMax,
  PreparedQuery,
  PreparedRange,
  StatFilterSpec,
  TradeQueryFilters,
  TradeSearchRequest
} from './types'

function minMax(min: number | null, max: number | null): MinMax | undefined {
  if (min === null && max === null) return undefined
  const out: MinMax = {}
  if (min !== null) out.min = min
  if (max !== null) out.max = max
  return out
}

function enabledRange(r: PreparedRange | null): MinMax | undefined {
  if (!r || !r.enabled) return undefined
  return minMax(r.min, r.max)
}

/** Intersect two bounds on the same stat id: tightest min, tightest max. The
 *  trade site indexes a repeated stat once (summed), so several enabled rows
 *  for it collapse to one filter — e.g. a single mod plus its "(total)". */
function intersectBounds(a: MinMax | undefined, b: MinMax | undefined): MinMax | undefined {
  if (!a) return b
  if (!b) return a
  const out: MinMax = {}
  const mins = [a.min, b.min].filter((n): n is number => n !== undefined)
  const maxes = [a.max, b.max].filter((n): n is number => n !== undefined)
  if (mins.length) out.min = Math.max(...mins)
  if (maxes.length) out.max = Math.min(...maxes)
  return out
}

/** PreparedQuery -> the POST body for /api/trade2/search/poe2/{league}. */
export function buildSearchBody(q: PreparedQuery): TradeSearchRequest {
  // One filter per stat id (insertion order); repeats merge their bounds.
  const boundsById = new Map<string, MinMax | undefined>()
  for (const s of q.stats) {
    if (!s.enabled) continue
    const value = minMax(s.min, s.max)
    boundsById.set(
      s.statId,
      boundsById.has(s.statId) ? intersectBounds(boundsById.get(s.statId), value) : value
    )
  }
  const statFilters: StatFilterSpec[] = [...boundsById].map(([id, value]) =>
    value ? { id, value } : { id }
  )

  const filters: TradeQueryFilters = {}

  const typeFilters: NonNullable<TradeQueryFilters['type_filters']>['filters'] = {}
  if (q.categoryFilter?.enabled) typeFilters.category = { option: q.categoryFilter.value }
  if (q.rarityOption) typeFilters.rarity = { option: q.rarityOption }
  const ilvl = enabledRange(q.ilvl)
  if (ilvl) typeFilters.ilvl = ilvl
  const quality = enabledRange(q.quality)
  if (quality) typeFilters.quality = quality
  if (Object.keys(typeFilters).length > 0) filters.type_filters = { filters: typeFilters }

  const mapTier = enabledRange(q.mapTier)
  if (mapTier) filters.map_filters = { filters: { map_tier: mapTier } }

  const miscFilters: NonNullable<TradeQueryFilters['misc_filters']>['filters'] = {}
  for (const flag of q.flags) {
    if (flag.state === 'any') continue
    miscFilters[flag.key] = { option: flag.state === 'yes' ? 'true' : 'false' }
  }
  const gemLevel = enabledRange(q.gemLevel)
  if (gemLevel) miscFilters.gem_level = gemLevel
  if (Object.keys(miscFilters).length > 0) filters.misc_filters = { filters: miscFilters }

  const equipmentFilters: NonNullable<TradeQueryFilters['equipment_filters']>['filters'] = {}
  for (const row of q.equipment) {
    const range = enabledRange(row)
    if (range) equipmentFilters[row.key] = range
  }
  if (Object.keys(equipmentFilters).length > 0) {
    filters.equipment_filters = { filters: equipmentFilters }
  }

  // Buyout price: emit when bounded, or when a specific currency is chosen
  // (the currency alone filters listings to that unit on the trade site).
  const buyout = q.buyout
  if (buyout.option || buyout.min !== null || buyout.max !== null) {
    const price: { min?: number; max?: number; option?: string } = {}
    if (buyout.min !== null) price.min = buyout.min
    if (buyout.max !== null) price.max = buyout.max
    if (buyout.option) price.option = buyout.option
    filters.trade_filters = { filters: { price } }
  }

  const body: TradeSearchRequest = {
    query: {
      status: { option: q.status },
      stats: [{ type: 'and', filters: statFilters }]
    },
    sort: { price: 'asc' }
  }
  if (q.name) body.query.name = q.name
  if (q.type) body.query.type = q.type
  else if (q.baseTypeFilter?.enabled) body.query.type = q.baseTypeFilter.value
  if (Object.keys(filters).length > 0) body.query.filters = filters

  return body
}
