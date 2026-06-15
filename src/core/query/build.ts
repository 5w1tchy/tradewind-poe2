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

/** PreparedQuery -> the POST body for /api/trade2/search/poe2/{league}. */
export function buildSearchBody(q: PreparedQuery): TradeSearchRequest {
  const statFilters: StatFilterSpec[] = q.stats
    .filter((s) => s.enabled)
    .map((s) => {
      const value = minMax(s.min, s.max)
      return value ? { id: s.statId, value } : { id: s.statId }
    })

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
