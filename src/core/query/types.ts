/** ---------- Trade API request (POST /api/trade2/search/poe2/{league}) ---------- */

export interface MinMax {
  min?: number
  max?: number
}

export interface StatFilterSpec {
  id: string
  value?: MinMax
  disabled?: boolean
}

export interface StatGroupSpec {
  type: 'and'
  filters: StatFilterSpec[]
}

export interface OptionFilter {
  option: string
}

/** Verified live 2026-06-10: ilvl/quality live in type_filters on trade2. */
export interface TradeQueryFilters {
  type_filters?: {
    filters: {
      category?: OptionFilter
      rarity?: OptionFilter
      ilvl?: MinMax
      quality?: MinMax
    }
  }
  map_filters?: {
    filters: {
      map_tier?: MinMax
    }
  }
  misc_filters?: {
    filters: {
      corrupted?: OptionFilter
      gem_level?: MinMax
    }
  }
  equipment_filters?: {
    filters: Partial<Record<EquipmentFilterKey, MinMax>>
  }
}

export interface TradeSearchRequest {
  query: {
    status: { option: string }
    /** Exact unique-item name. */
    name?: string
    /** Exact base type (uniques, currency, gems, normal-rarity items). */
    type?: string
    stats: StatGroupSpec[]
    filters?: TradeQueryFilters
  }
  sort: { price: 'asc' }
}

/** ---------- Prepared query: the UI-editable state between item and request ---------- */

export type StatSource = 'explicit' | 'implicit' | 'enchant' | 'rune' | 'pseudo'

/** trade2 equipment_filters keys we emit. */
export type EquipmentFilterKey =
  | 'ar'
  | 'ev'
  | 'es'
  | 'spirit'
  | 'block'
  | 'dps'
  | 'pdps'
  | 'edps'

export interface PreparedStatFilter {
  statId: string
  /** Clipboard line, shown in the filter list. */
  label: string
  source: StatSource
  /** Representative roll — average when the line has several numbers. */
  value: number | null
  min: number | null
  max: number | null
  enabled: boolean
}

export interface PreparedRange {
  value: number
  min: number | null
  max: number | null
  enabled: boolean
}

/** Derived item numbers (defences, DPS) searchable via equipment_filters. */
export interface PreparedEquipmentFilter extends PreparedRange {
  key: EquipmentFilterKey
  label: string
}

export interface PreparedToggle {
  value: boolean
  enabled: boolean
}

/**
 * Listing-status options (verified live 2026-06-10): securable = Instant
 * Buyout, available = Instant Buyout and In Person, online = In Person
 * (Online), any = Any.
 */
export type ListingStatus = 'securable' | 'available' | 'online' | 'any'

/** Plain-JSON (IPC-safe) editable search state for one price check. */
export interface PreparedQuery {
  itemClass: string
  rarity: string
  status: ListingStatus
  /** Popup header line. */
  displayName: string
  /** Exact-name search (uniques). */
  name: string | null
  /** Exact-type search (uniques, currency, gems, normal items). */
  type: string | null
  category: string | null
  rarityOption: string | null
  /** Optional exact-base restriction for rares ("Amethyst Ring" vs any ring). */
  baseTypeFilter: { value: string; enabled: boolean } | null
  ilvl: PreparedRange | null
  quality: PreparedRange | null
  gemLevel: PreparedRange | null
  mapTier: PreparedRange | null
  corrupted: PreparedToggle | null
  equipment: PreparedEquipmentFilter[]
  stats: PreparedStatFilter[]
  /** Mod lines with no trade stat id — excluded from the search, surfaced as warnings. */
  unmatched: string[]
}
