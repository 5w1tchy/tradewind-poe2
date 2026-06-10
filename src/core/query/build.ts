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
  if (q.category) typeFilters.category = { option: q.category }
  if (q.rarityOption) typeFilters.rarity = { option: q.rarityOption }
  const ilvl = enabledRange(q.ilvl)
  if (ilvl) typeFilters.ilvl = ilvl
  const quality = enabledRange(q.quality)
  if (quality) typeFilters.quality = quality
  if (Object.keys(typeFilters).length > 0) filters.type_filters = { filters: typeFilters }

  const mapTier = enabledRange(q.mapTier)
  if (mapTier) filters.map_filters = { filters: { map_tier: mapTier } }

  const miscFilters: NonNullable<TradeQueryFilters['misc_filters']>['filters'] = {}
  if (q.corrupted?.enabled) miscFilters.corrupted = { option: String(q.corrupted.value) }
  const gemLevel = enabledRange(q.gemLevel)
  if (gemLevel) miscFilters.gem_level = gemLevel
  if (Object.keys(miscFilters).length > 0) filters.misc_filters = { filters: miscFilters }

  const body: TradeSearchRequest = {
    query: {
      status: { option: 'online' },
      stats: [{ type: 'and', filters: statFilters }]
    },
    sort: { price: 'asc' }
  }
  if (q.name) body.query.name = q.name
  if (q.type) body.query.type = q.type
  if (Object.keys(filters).length > 0) body.query.filters = filters

  return body
}
