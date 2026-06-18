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
      gem_sockets?: MinMax
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
 * Special provenance of a mod, surfaced as a short tag after the affix badge
 * (issue #54). Null for an ordinary rolled prefix/suffix/implicit. A mod has at
 * most one: crafted (bench), desecrated (Abyss), fractured (locked by a
 * Fracturing Orb), enhanced (anoint/enchant `{ Enhancement }`), or corruption
 * (`{ Corruption Enhancement }`).
 */
export type ModOrigin = 'crafted' | 'desecrated' | 'fractured' | 'enhanced' | 'corruption'

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
  | 'aps'
  | 'crit'
  | 'rune_sockets'

export interface PreparedStatFilter {
  statId: string
  /** Clipboard line, shown in the filter list. */
  label: string
  source: StatSource
  /** Affix slot from advanced copy. Null for implicit/rune/enchant/pseudo rows
   *  and for summed totals (no single affix owns the sum). */
  affix: 'prefix' | 'suffix' | null
  /** Special mod provenance (crafted/desecrated/fractured/enhanced/corruption),
   *  rendered as a tag after the affix badge. Null/absent for an ordinary roll
   *  and for synthetic rows (summed totals, resistance pseudos) spanning several
   *  mods. Optional like the other situational fields (`summed`, `group`). */
  origin?: ModOrigin | null
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

/**
 * A "number of modifiers" pseudo filter (issue #22): empty prefix/suffix/total
 * affix-slot counts, for finding craftable bases with open slots (e.g. "1 open
 * prefix and 2 open suffixes"). Searched as a plain pseudo stat (`statId`)
 * bounded by min/max — there is no roll value, so no quick-set cycle. Offered on
 * rares/magic only; `enabled` is bound-driven (set when min or max is present).
 */
export interface PreparedModCount {
  statId: string
  /** Human label shown in the filter list ("Open Prefix Modifiers"). */
  label: string
  min: number | null
  max: number | null
  enabled: boolean
}

/** Derived item numbers (defences, DPS) searchable via equipment_filters. */
export interface PreparedEquipmentFilter extends PreparedRange {
  key: EquipmentFilterKey
  label: string
  /** The pre-filled "Smart" default min (spread below the value), so the "="
   *  button can cycle back to it after the user bumps the row to 100%. Equals
   *  `value` for no-spread rows (sockets), where the cycle is a no-op. */
  smartMin: number | null
  /** No equipment row carries a tier floor — always null. Present so the row
   *  shares the QuickMode cycle shape with stat rows, which skips the "T" step
   *  when this is null. */
  tierMin: number | null
  /** Which quick-set produced the current min — drives the cycling "=" glyph,
   *  flipping to 'custom' once a min is typed by hand (issue #16, DPS/defences). */
  quickMode: QuickMode
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
  /** Support-gem socket count (Skill/Spirit gems, issue #58); maps to the
   *  misc_filters `gem_sockets` minMax. Null for non-gems. */
  gemSockets: PreparedRange | null
  /**
   * Uncut Support Gem levels to price as an aggregate banner (issue #58), for a
   * *cuttable* support gem — one not traded on the currency exchange (the lineage
   * supports take the exchange path before this). The realistic way to obtain it
   * is to buy an uncut and engrave it. Levels run from the required tier up to 5;
   * with no tier data we show all five [1,2,3,4,5]. Null for everything else, and
   * the renderer arms (does not auto-fire) the live finished-gem search when set.
   */
  uncutSupportLevels: number[] | null
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
  /** "Number of empty modifiers" pseudo filters (issue #22); empty for items
   *  without affix slots (uniques, currency, gems, white bases). */
  modCounts: PreparedModCount[]
  /** Mod lines with no trade stat id — excluded from the search, surfaced as warnings. */
  unmatched: string[]
}
