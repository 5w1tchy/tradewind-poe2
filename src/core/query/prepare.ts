import type { ParsedItem, ParsedMod, ParsedStatLine, RollValue } from '../parser/types'
import type { StatsDb } from '../stats-db/statsDb'
import { extractBaseType } from './baseType'
import { categoryForItemClass } from './categories'
import { deriveEquipmentValues } from './derived'
import type {
  ItemFlagKey,
  PreparedEquipmentFilter,
  PreparedFlag,
  PreparedQuery,
  PreparedRange,
  PreparedStatFilter,
  QuickMode,
  StatSource
} from './types'

export interface PrepareOptions {
  /** Fractional spread below the roll for stat mins (0.1 = "at least 90% of my roll"). */
  spread?: number
  /** Bulk-exchange ids keyed by exact item text (from /api/trade2/data/static). */
  exchangeIds?: Record<string, string>
  /** Known base type names (from /api/trade2/data/items) for extracting the
   *  true base out of decorated white/magic names. */
  baseTypes?: string[]
}

const DEFAULT_SPREAD = 0.1

function preferFor(mod: ParsedMod): string[] {
  if (mod.generation === 'implicit') return ['implicit', 'explicit']
  // Desecrated/essence-crafted mods are still the same stat for pricing —
  // search the explicit id so listings with the regular mod count as
  // comparables. The origin-specific groups (desecrated.*, crafted.*) only
  // match listings sharing that origin; keep them as fallbacks for mods that
  // exist nowhere else.
  if (mod.desecrated) return ['explicit', 'desecrated']
  if (mod.crafted) return ['explicit', 'crafted']
  if (mod.generation === 'enhancement') return ['enchant', 'sanctum', 'explicit', 'skill']
  return ['explicit']
}

/**
 * The clipboard templates *every* number, but a stat text like "#% increased
 * Spell Damage per 100 maximum Mana" carries a fixed literal (100) that isn't a
 * roll. Align the parsed tokens against the matched DB text — '#' marks a roll,
 * a bare number marks fixed text — and keep only the rolls, so the average isn't
 * dragged toward the literal. Falls back to all tokens when the alignment is
 * ambiguous (token count mismatch, or an all-literal "fixed text" stat).
 */
function rollValues(line: ParsedStatLine, candidateText: string): RollValue[] {
  const slots = candidateText.match(/#|-?\d+(?:[.,]\d+)?/g) ?? []
  if (slots.length !== line.values.length) return line.values
  const rolls = line.values.filter((_, i) => slots[i] === '#')
  return rolls.length > 0 ? rolls : line.values
}

function representativeValue(values: RollValue[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, v) => acc + v.value, 0)
  return sum / values.length
}

/**
 * Tier floor: the average of the rolls' lower bounds (the "(70-90)" range from
 * advanced copy), parallel to representativeValue. A component with no range —
 * e.g. the fixed "1" in flat "Adds 1 to 17(16-22)" — doesn't roll, so its own
 * value is its floor. Null only when *nothing* carries a range (basic copy or a
 * chat-linked tooltip), in which case "Match Tier" isn't offered.
 */
function representativeMin(values: RollValue[]): number | null {
  if (values.length === 0 || values.every((v) => v.min === undefined)) return null
  let sum = 0
  for (const v of values) sum += v.min ?? v.value
  return sum / values.length
}

/**
 * Quick-set mode a freshly prepared row starts on: cliff stats (no spread)
 * pre-fill at 100% of the roll, so they start on "Match Roll"; everything else
 * starts on the Smart default that minWithSpread produced.
 */
function defaultMode(lineSpread: number): QuickMode {
  return lineSpread === 0 ? 'roll' : 'smart'
}

/** Lower bound `spread` below the roll; sign-aware so negative rolls loosen downward too. */
function minWithSpread(value: number, spread: number): number {
  const lo = value >= 0 ? value * (1 - spread) : value * (1 + spread)
  return Math.floor(lo)
}

interface LineContext {
  line: ParsedStatLine
  source: StatSource
  prefer: string[]
  enabled: boolean
  affix: 'prefix' | 'suffix' | null
  tier: number | null
  /** Source-mod index; lines of one hybrid mod share it (see PreparedStatFilter). */
  group: number
}

/**
 * GGG indexes a mod under its "(Local)" stat id when it modifies the item
 * itself: everything on weapons (accuracy, attack speed, added damage), but
 * only the defence stats on armour — glove attack speed is global. Quivers
 * are categorized armour yet roll nothing local.
 */
const ARMOUR_LOCAL_RE = /Armour|Evasion|Energy Shield|Block/

function lineWantsLocal(category: string | null, template: string): boolean {
  if (!category) return false
  if (category.startsWith('weapon')) return true
  if (category.startsWith('armour') && category !== 'armour.quiver') {
    return ARMOUR_LOCAL_RE.test(template)
  }
  return false
}

// Stats that roll in fixed brackets — searching below your bracket is never
// what you mean, so the min stays at 100% of the roll.
const NO_SPREAD_TEMPLATES = new Set(['#% increased Movement Speed'])

// Small-integer stats where each point is a price cliff: a "+3 to Level of
// all Spell Skills" search must not loosen to +2, and 2 charm slots must
// not loosen to 1.
const NO_SPREAD_PATTERNS = [/^\+# to Level of /, /Charm Slot/]

function spreadFor(template: string, spread: number): number {
  if (NO_SPREAD_TEMPLATES.has(template)) return 0
  if (NO_SPREAD_PATTERNS.some((p) => p.test(template))) return 0
  return spread
}

/** "#% increased Energy Shield" + 130 -> "130% increased Energy Shield (total)". */
function totalLabel(template: string, total: number): string {
  const rounded = Math.round(total * 10) / 10
  if (template.split('#').length === 2) {
    return `${template.replace('#', String(rounded))} (total)`
  }
  return `${template} (total ${rounded})`
}

function collectLines(item: ParsedItem, statsEnabled: boolean): LineContext[] {
  // Relic mods are indexed in the sanctum stat group; texts like "#%
  // increased Movement Speed" also exist as regular explicits, so without
  // this preference a relic search matches zero relics.
  const isRelic = item.itemClass === 'Relics'
  const prefer = (mod: ParsedMod): string[] =>
    isRelic ? ['sanctum', ...preferFor(mod)] : preferFor(mod)

  const out: LineContext[] = []
  // One group per source mod, so a hybrid mod's lines render as a single node.
  let group = 0
  for (const mod of item.implicits) {
    group++
    for (const line of mod.lines) {
      out.push({
        line,
        source: 'implicit',
        prefer: prefer(mod),
        enabled: false,
        affix: null,
        tier: mod.tier,
        group
      })
    }
  }
  for (const mod of [...item.explicits, ...item.enhancements]) {
    group++
    const source: StatSource = mod.generation === 'enhancement' ? 'enchant' : 'explicit'
    const affix = mod.generation === 'prefix' || mod.generation === 'suffix' ? mod.generation : null
    for (const line of mod.lines) {
      out.push({
        line,
        source,
        prefer: prefer(mod),
        enabled: statsEnabled && source === 'explicit',
        affix,
        tier: mod.tier,
        group
      })
    }
  }
  for (const line of item.runeMods) {
    out.push({
      line,
      source: 'rune',
      prefer: ['rune', 'enchant', 'explicit'],
      enabled: false,
      affix: null,
      tier: null,
      group: ++group
    })
  }
  for (const line of item.enchantMods) {
    out.push({
      line,
      source: 'enchant',
      prefer: ['enchant', 'explicit'],
      enabled: false,
      affix: null,
      tier: null,
      group: ++group
    })
  }
  return out
}

function buildStatRows(
  item: ParsedItem,
  db: StatsDb,
  statsEnabled: boolean,
  spread: number
): { stats: PreparedStatFilter[]; unmatched: string[] } {
  const stats: PreparedStatFilter[] = []
  const templates: string[] = []
  const unmatched: string[] = []
  // First (so-far only) individual row for a stat id; promoted to a display row
  // once a duplicate appears. Then aggByKey points at the searchable total.
  const firstByKey = new Map<string, number>()
  const aggByKey = new Map<string, number>()
  const category = categoryForItemClass(item.itemClass)

  for (const { line, source, prefer, enabled, affix, tier, group } of collectLines(item, statsEnabled)) {
    const candidates = db.match(line, {
      preferCategories: prefer,
      preferLocal: lineWantsLocal(category, line.template)
    })
    const best = candidates[0]
    if (!best) {
      unmatched.push(line.raw)
      continue
    }
    const rolls = rollValues(line, best.text)
    let value = representativeValue(rolls)
    let tierMinRaw = representativeMin(rolls)
    if (best.negated) {
      // increased<->reduced swap: the displayed roll (and its floor) flip sign.
      if (value !== null) value = -value
      if (tierMinRaw !== null) tierMinRaw = -tierMinRaw
    }
    const lineSpread = spreadFor(line.template, spread)
    const smart = value !== null ? minWithSpread(value, lineSpread) : null
    // Floor the tier floor so the worst roll of the tier is never excluded
    // (added-damage averages like 8.5 must search as 8, not round up to 9).
    const tierMin = tierMinRaw !== null ? Math.floor(tierMinRaw) : null

    const node = (en: boolean): void => {
      stats.push({
        statId: best.id,
        label: line.raw,
        source,
        affix,
        tier,
        group,
        value,
        tierMin,
        smartMin: smart,
        quickMode: defaultMode(lineSpread),
        min: smart,
        max: null,
        enabled: en
      })
      templates.push(line.template)
    }

    // A stat rolling on several mods (rarity as prefix AND suffix, double ES
    // prefixes, a Spell Damage prefix beside a Spell Damage suffix) is indexed
    // by the trade site once, summed. So each individual mod stays in its affix
    // group as its own searchable row (off by default), and a "(total)" row sums
    // them for the common case. The query builder dedupes the shared id, so the
    // user can search by a single mod OR by the total without double-filtering.
    const key = `${best.id}|${source}`
    const aggIdx = aggByKey.get(key)
    if (aggIdx !== undefined) {
      // Known duplicate: add this mod (off by default) and fold into the total.
      node(false)
      if (value !== null) {
        const agg = stats[aggIdx]
        agg.value = (agg.value ?? 0) + value
        agg.min = minWithSpread(agg.value, lineSpread)
        agg.smartMin = agg.min
        agg.label = totalLabel(line.template, agg.value)
      }
      continue
    }

    const firstIdx = firstByKey.get(key)
    if (firstIdx !== undefined) {
      // Second occurrence: the total takes over the default search; both mods
      // stay clickable but off so they don't double-filter the summed id.
      const first = stats[firstIdx]
      const firstEnabled = first.enabled
      first.enabled = false
      node(false)
      const total = (first.value ?? 0) + (value ?? 0)
      const totalSmart = total ? minWithSpread(total, lineSpread) : null
      stats.push({
        statId: best.id,
        label: totalLabel(line.template, total),
        source,
        // A summed total is no single mod's roll — a tier/affix badge would lie,
        // and a cross-mod sum has no single tier floor either.
        affix: null,
        tier: null,
        summed: true,
        value: total,
        tierMin: null,
        smartMin: totalSmart,
        quickMode: defaultMode(lineSpread),
        min: totalSmart,
        max: null,
        enabled: firstEnabled || enabled
      })
      templates.push(line.template)
      aggByKey.set(key, stats.length - 1)
      continue
    }

    node(enabled)
    firstByKey.set(key, stats.length - 1)
  }

  foldResistancePseudos(stats, templates, statsEnabled, spread)
  addHybridSingles(stats, statsEnabled)
  disableHybridGroups(stats)
  return { stats, unmatched }
}

/**
 * A hybrid mod's single checkbox can't search just one of its stats — so each
 * component that isn't already independently searchable (no summed "(total)"
 * and not already a pseudo) is surfaced as its own row in the pseudo area. These
 * pseudo rows are the default search target (the hybrid node itself is off — see
 * disableHybridGroups), so they default on like a normal explicit. The builder
 * dedupes if both a pseudo row and its node end up enabled.
 */
function addHybridSingles(stats: PreparedStatFilter[], statsEnabled: boolean): void {
  const groupSize = new Map<number, number>()
  for (const s of stats) {
    if (s.group !== undefined) groupSize.set(s.group, (groupSize.get(s.group) ?? 0) + 1)
  }
  // Ids already standalone-searchable in the pseudo area (totals, pseudos).
  const covered = new Set<string>()
  for (const s of stats) if (s.summed || s.affix === null) covered.add(s.statId)
  const extras: PreparedStatFilter[] = []
  for (const s of stats) {
    if (s.group === undefined || (groupSize.get(s.group) ?? 0) < 2) continue
    if (covered.has(s.statId)) continue
    covered.add(s.statId)
    extras.push({
      statId: s.statId,
      label: s.label,
      source: s.source,
      affix: null,
      tier: null,
      value: s.value,
      // One real mod backs this pseudo row, so its tier floor carries over.
      tierMin: s.tierMin,
      smartMin: s.smartMin,
      quickMode: s.quickMode,
      min: s.min,
      max: null,
      enabled: statsEnabled && s.source === 'explicit'
    })
  }
  stats.push(...extras)
}

/**
 * A hybrid mod renders as one node with a single checkbox; its stats are also
 * surfaced individually in the pseudo area (see addHybridSingles), which is the
 * default search target. So the in-place node is off by default — both its lines
 * share that off state, keeping the single checkbox honest.
 */
function disableHybridGroups(stats: PreparedStatFilter[]): void {
  const groupSize = new Map<number, number>()
  for (const s of stats) {
    if (s.group !== undefined) groupSize.set(s.group, (groupSize.get(s.group) ?? 0) + 1)
  }
  for (const s of stats) {
    if (s.group !== undefined && (groupSize.get(s.group) ?? 0) >= 2) s.enabled = false
  }
}

// Weight of one mod line toward summed resistance pseudo stats. The trade
// site computes "+#% total Elemental Resistance" as fire+cold+lightning,
// so an all-res mod counts three times.
const ELE_RES_PATTERNS: Array<[RegExp, number]> = [
  [/^\+#% to (?:Fire|Cold|Lightning) Resistance$/, 1],
  [/^\+#% to (?:Fire|Cold|Lightning) and (?:Fire|Cold|Lightning) Resistances$/, 2],
  [/^\+#% to all Elemental Resistances$/, 3]
]
const CHAOS_RES_PATTERN = /^\+#% to Chaos Resistance$/
// Hybrid elemental+chaos mods (e.g. "+#% to Fire and Chaos Resistances") apply
// their value to one element AND to chaos, so they feed both pseudo totals.
const ELE_CHAOS_RES_PATTERN = /^\+#% to (?:Fire|Cold|Lightning) and Chaos Resistances$/

/**
 * Fold individual resist lines into summed pseudo filters: 35% fire + 25%
 * cold prices like any combination totalling 60%. The folded lines stay in
 * the list (unchecked) for exact-mod searches. `templates` runs parallel to
 * `stats` (the parser's '#'-normalized line texts).
 */
function foldResistancePseudos(
  stats: PreparedStatFilter[],
  templates: string[],
  statsEnabled: boolean,
  spread: number
): void {
  let ele = 0
  let chaos = 0
  for (const [i, stat] of stats.entries()) {
    // Runes/enchants are swappable — they'd skew totals vs. listings. Synthetic
    // "(total)" rows are skipped so their individual mods aren't counted twice.
    if (stat.value === null || stat.summed) continue
    if (stat.source !== 'explicit' && stat.source !== 'implicit') continue
    const template = templates[i]
    for (const [pattern, weight] of ELE_RES_PATTERNS) {
      if (pattern.test(template)) {
        ele += stat.value * weight
        stat.enabled = false
      }
    }
    if (CHAOS_RES_PATTERN.test(template)) {
      chaos += stat.value
      stat.enabled = false
    }
    if (ELE_CHAOS_RES_PATTERN.test(template)) {
      ele += stat.value
      chaos += stat.value
      stat.enabled = false
    }
  }

  const pseudo = (statId: string, label: string, value: number): PreparedStatFilter => ({
    statId,
    label,
    source: 'pseudo',
    affix: null,
    tier: null,
    value,
    // A summed pseudo spans several mods of differing tiers — no single floor.
    tierMin: null,
    smartMin: minWithSpread(value, spread),
    quickMode: 'smart',
    min: minWithSpread(value, spread),
    max: null,
    enabled: statsEnabled
  })
  if (ele > 0) {
    stats.push(
      pseudo(
        'pseudo.pseudo_total_elemental_resistance',
        `+${ele}% total Elemental Resistance`,
        ele
      )
    )
  }
  if (chaos > 0) {
    stats.push(
      pseudo('pseudo.pseudo_total_chaos_resistance', `+${chaos}% total to Chaos Resistance`, chaos)
    )
  }
}

function range(value: number, opts: Partial<PreparedRange> = {}): PreparedRange {
  return { value, min: value, max: null, enabled: false, ...opts }
}

const EQUIPMENT_RARITIES = new Set(['Normal', 'Magic', 'Rare', 'Unique'])

// Tri-state item attributes shown for equipment, all defaulting to "any" so a
// price check doesn't silently exclude listings on a property the user hasn't
// chosen to filter on.
const EQUIPMENT_FLAGS: ReadonlyArray<[ItemFlagKey, string]> = [
  ['corrupted', 'Corrupted'],
  ['mirrored', 'Mirrored'],
  ['sanctified', 'Sanctified'],
  ['crafted', 'Crafted'],
  ['fractured_item', 'Fractured'],
  ['desecrated', 'Desecrated'],
  ['identified', 'Identified']
]

function equipmentFlags(): PreparedFlag[] {
  return EQUIPMENT_FLAGS.map(([key, label]) => ({ key, label, state: 'any' }))
}

/**
 * ParsedItem -> editable search state with sensible pre-checked defaults:
 *  - uniques: exact name+type, mods present but unchecked
 *  - rares/magic: category + explicit mods checked at `spread` below the roll
 *  - gems: exact type + gem level; currency/normal: exact type
 *  - corruption state always mirrored for identified equipment
 */
export function prepareQuery(
  item: ParsedItem,
  db: StatsDb,
  options: PrepareOptions = {}
): PreparedQuery {
  const spread = options.spread ?? DEFAULT_SPREAD
  const category = categoryForItemClass(item.itemClass)
  const isUnique = item.rarity === 'Unique'
  const isGem = item.rarity === 'Gem'
  const isCurrency = item.rarity === 'Currency'
  const isEquipment = EQUIPMENT_RARITIES.has(item.rarity)

  const prepared: PreparedQuery = {
    itemClass: item.itemClass,
    rarity: item.rarity,
    // PoE2's instant buyout is the trade reality — default to it.
    status: 'securable',
    displayName: item.name ?? item.baseType,
    name: null,
    type: null,
    exchangeId: null,
    categoryFilter: null,
    rarityOption: null,
    baseTypeFilter: null,
    ilvl: null,
    quality: null,
    gemLevel: null,
    mapTier: null,
    flags: [],
    buyout: { min: null, max: null, option: null },
    equipment: [],
    stats: [],
    unmatched: []
  }

  if (isCurrency) {
    // Stackable currency trades on the bulk exchange when it has an id there.
    const exchangeId = options.exchangeIds?.[item.baseType]
    if (exchangeId) {
      prepared.exchangeId = exchangeId
      return prepared
    }
    // "Uncut Skill Gem (Level 19)" -> type + exact gem level filter.
    const uncut = item.baseType.match(/^(.+) \(Level (\d+)\)$/)
    if (uncut) {
      prepared.type = uncut[1]
      const level = Number(uncut[2])
      prepared.gemLevel = range(level, { max: level, enabled: true })
    } else {
      prepared.type = item.baseType
    }
    return prepared
  }

  if (isGem) {
    prepared.type = item.baseType
    const levelProp = item.properties.find((p) => /^Level: \d+/.test(p.raw))
    const level = levelProp ? Number(levelProp.raw.match(/^Level: (\d+)/)![1]) : null
    if (level !== null) prepared.gemLevel = range(level, { enabled: true })
    if (item.quality !== null) prepared.quality = range(item.quality)
    // A corrupted gem is a different item at a different price — pin it.
    prepared.flags = [
      { key: 'corrupted', label: 'Corrupted', state: item.corrupted ? 'yes' : 'no' }
    ]
    return prepared
  }

  if (isUnique) {
    prepared.name = item.name
    // Unidentified uniques show one decorated name line ("Exceptional
    // Fierce Greathelm") — recover the real base; identified base lines
    // pass through the extraction unchanged.
    prepared.type = extractBaseType(item.baseType, options.baseTypes ?? []) ?? item.baseType
    prepared.rarityOption = 'unique'
  } else if (isEquipment) {
    if (category !== null) {
      prepared.categoryFilter = { value: category, label: item.itemClass, enabled: true }
    }
    // Default the rarity filter to the item's own rarity (issue #15). The
    // trade option ids match the lowercased rarity name: normal/magic/rare.
    prepared.rarityOption = item.rarity.toLowerCase()
    // White items ARE their base, but the name can carry display prefixes
    // ("Exceptional Stalking Spear") the API rejects — extract the real base
    // and search it, with Category as the opt-out scope (see-saw, as rares).
    if (item.rarity === 'Normal') {
      const base = extractBaseType(item.baseType, options.baseTypes ?? [])
      if (base) {
        prepared.baseTypeFilter = { value: base, enabled: true }
        if (prepared.categoryFilter) prepared.categoryFilter.enabled = false
      } else if ((options.baseTypes ?? []).length === 0 || !prepared.categoryFilter) {
        // No items DB yet (offline first run) — exact-name search as before.
        prepared.type = item.baseType
      }
      // With a loaded base list and no match, the name is decorated in a way
      // we don't understand — a category search beats a guaranteed 400.
    }
    // Rares show the clean base on the second name line; magic names sandwich
    // it in affix words (recovered from the items DB). Default to the exact
    // base (issue #23), with Category as the opt-out scope (see-saw, as white
    // items) — checking Category unchecks Base in the UI.
    if (item.rarity === 'Rare' && item.name) {
      prepared.baseTypeFilter = { value: item.baseType, enabled: true }
      if (prepared.categoryFilter) prepared.categoryFilter.enabled = false
    }
    if (item.rarity === 'Magic') {
      const base = extractBaseType(item.baseType, options.baseTypes ?? [])
      if (base) {
        prepared.baseTypeFilter = { value: base, enabled: true }
        if (prepared.categoryFilter) prepared.categoryFilter.enabled = false
      }
    }
  }

  if (isEquipment) {
    if (item.itemLevel !== null && !isUnique) prepared.ilvl = range(item.itemLevel)
    if (item.quality !== null) prepared.quality = range(item.quality)
    if (item.waystoneTier !== null) {
      prepared.mapTier = range(item.waystoneTier, { max: item.waystoneTier, enabled: true })
    }
    // Uniques can only meaningfully be corrupted — the rest (mirrored aside,
    // which is too rare to filter on) don't describe a unique's price.
    prepared.flags = isUnique
      ? [{ key: 'corrupted', label: 'Corrupted', state: 'any' }]
      : equipmentFlags()

    prepared.equipment = deriveEquipmentValues(item).map(
      (d): PreparedEquipmentFilter => ({
        ...d,
        // Socket counts are small integers — "at least this many" wants the
        // exact count, not 90% of it.
        min: d.key === 'rune_sockets' ? d.value : minWithSpread(d.value, spread),
        max: null,
        enabled: false
      })
    )

    const { stats, unmatched } = buildStatRows(item, db, !isUnique, spread)
    prepared.stats = stats
    prepared.unmatched = unmatched
  }

  return prepared
}
