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
      identified?: OptionFilter
      corrupted?: OptionFilter
      mirrored?: OptionFilter
      sanctified?: OptionFilter
      crafted?: OptionFilter
      fractured_item?: OptionFilter
      desecrated?: OptionFilter
      gem_level?: MinMax
    }
  }
  equipment_filters?: {
    filters: Partial<Record<EquipmentFilterKey, MinMax>>
  }
  trade_filters?: {
    filters: {
      /** Buyout price; `option` is the currency unit (omitted = exalted equivalent). */
      price?: { min?: number; max?: number; option?: string }
    }
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

/**
 * Quick-set mode for a stat row's `min` bound (issue #16). The "=" button cycles
 * through these and writes the matching target into `min`:
 *   roll  — the item's actual roll (100%)
 *   tier  — the tier floor (worst roll of the mod's current tier; see `tierMin`)
 *   smart — the pre-filled default (spread below the roll, or 100% for cliffs)
 *   custom — the user typed a value by hand (off the cycle, shown as a dot)
 */
export type QuickMode = 'roll' | 'tier' | 'smart' | 'custom'

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
  | 'rune_sockets'

export interface PreparedStatFilter {
  statId: string
  /** Clipboard line, shown in the filter list. */
  label: string
  source: StatSource
  /** Affix slot from advanced copy. Null for implicit/rune/enchant/pseudo rows
   *  and for summed totals (no single affix owns the sum). */
  affix: 'prefix' | 'suffix' | null
  /** True on the synthetic "(total)" row that sums a stat the trade site indexes
   *  once across several mods. The individual mods stay as their own searchable
   *  rows; the builder dedupes so enabling both can't double-filter the id. */
  summed?: boolean
  /** Index of the source modifier. Rows sharing a group come from one hybrid mod
   *  (e.g. "Spell Damage + Mana") and render as a single node with one checkbox.
   *  Undefined on synthetic rows (totals, pseudos). */
  group?: number
  /** Mod tier from advanced copy (PoE2: T1 is best). Null for pseudo/rune/enchant rows. */
  tier: number | null
  /** Representative roll — average when the line has several numbers. */
  value: number | null
  /** Tier floor: the worst roll within the mod's current tier, from advanced-copy
   *  ranges (the "(70-90)" parentheticals). Null when the copy carried no range
   *  (basic copy) or the row is a cross-mod sum/pseudo with no single tier —
   *  then the quick-set cycle skips the "Match Tier" step. */
  tierMin: number | null
  /** The pre-filled "Smart" default min (spread below the roll, or the full roll
   *  for cliff stats). Stored so cycling back to Smart restores it after edits. */
  smartMin: number | null
  /** Which quick-set produced the current min — drives the cycling "=" button
   *  glyph; flips to 'custom' once the user types a min by hand. */
  quickMode: QuickMode
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

/** Boolean item attributes (corrupted, mirrored, …) search as yes / no / any. */
export type TriState = 'yes' | 'no' | 'any'

/** misc_filters keys we expose as tri-state item flags. */
export type ItemFlagKey =
  | 'corrupted'
  | 'mirrored'
  | 'sanctified'
  | 'crafted'
  | 'fractured_item'
  | 'desecrated'
  | 'identified'

export interface PreparedFlag {
  key: ItemFlagKey
  /** Human label shown in the filter list ("Corrupted"). */
  label: string
  state: TriState
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
  /**
   * Bulk-exchange id (e.g. "idol-of-the-martyr"). When set, the price check
   * queries /api/trade2/exchange instead of item search — stackable currency
   * trades there, not in item listings.
   */
  exchangeId: string | null
  /** Item-class category restriction; label is the human name ("Boots"). */
  categoryFilter: { value: string; label: string; enabled: boolean } | null
  rarityOption: string | null
  /** Optional exact-base restriction for rares ("Amethyst Ring" vs any ring). */
  baseTypeFilter: { value: string; enabled: boolean } | null
  ilvl: PreparedRange | null
  quality: PreparedRange | null
  gemLevel: PreparedRange | null
  mapTier: PreparedRange | null
  /** Tri-state item attributes (corrupted, mirrored, …); empty for currency. */
  flags: PreparedFlag[]
  /**
   * Buyout-price filter. `option` is the currency unit (null = exalted-orb
   * equivalent, the trade default); min/max are bounds in that unit.
   */
  buyout: { min: number | null; max: number | null; option: string | null }
  equipment: PreparedEquipmentFilter[]
  stats: PreparedStatFilter[]
  /** Mod lines with no trade stat id — excluded from the search, surfaced as warnings. */
  unmatched: string[]
}
