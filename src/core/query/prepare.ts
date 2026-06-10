import type { ParsedItem, ParsedMod, ParsedStatLine } from '../parser/types'
import type { StatsDb } from '../stats-db/statsDb'
import { categoryForItemClass } from './categories'
import type {
  PreparedQuery,
  PreparedRange,
  PreparedStatFilter,
  StatSource
} from './types'

export interface PrepareOptions {
  /** Fractional spread below the roll for stat mins (0.1 = "at least 90% of my roll"). */
  spread?: number
}

const DEFAULT_SPREAD = 0.1

/** Same context preference used by the matcher coverage test. */
function preferFor(mod: ParsedMod): string[] {
  if (mod.generation === 'implicit') return ['implicit', 'explicit']
  if (mod.desecrated) return ['desecrated', 'explicit']
  if (mod.crafted) return ['crafted', 'explicit']
  if (mod.generation === 'enhancement') return ['enchant', 'sanctum', 'explicit', 'skill']
  return ['explicit']
}

function representativeValue(line: ParsedStatLine): number | null {
  if (line.values.length === 0) return null
  const sum = line.values.reduce((acc, v) => acc + v.value, 0)
  return sum / line.values.length
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
}

function collectLines(item: ParsedItem, statsEnabled: boolean): LineContext[] {
  const out: LineContext[] = []
  for (const mod of item.implicits) {
    for (const line of mod.lines) {
      out.push({ line, source: 'implicit', prefer: preferFor(mod), enabled: false })
    }
  }
  for (const mod of [...item.explicits, ...item.enhancements]) {
    const source: StatSource = mod.generation === 'enhancement' ? 'enchant' : 'explicit'
    for (const line of mod.lines) {
      out.push({
        line,
        source,
        prefer: preferFor(mod),
        enabled: statsEnabled && source === 'explicit'
      })
    }
  }
  for (const line of item.runeMods) {
    out.push({ line, source: 'rune', prefer: ['rune', 'enchant', 'explicit'], enabled: false })
  }
  for (const line of item.enchantMods) {
    out.push({ line, source: 'enchant', prefer: ['enchant', 'explicit'], enabled: false })
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
  const unmatched: string[] = []

  for (const { line, source, prefer, enabled } of collectLines(item, statsEnabled)) {
    const candidates = db.match(line, { preferCategories: prefer })
    const best = candidates[0]
    if (!best) {
      unmatched.push(line.raw)
      continue
    }
    let value = representativeValue(line)
    if (value !== null && best.negated) value = -value
    stats.push({
      statId: best.id,
      label: line.raw,
      source,
      value,
      min: value !== null ? minWithSpread(value, spread) : null,
      max: null,
      enabled
    })
  }
  return { stats, unmatched }
}

function range(value: number, opts: Partial<PreparedRange> = {}): PreparedRange {
  return { value, min: value, max: null, enabled: false, ...opts }
}

const EQUIPMENT_RARITIES = new Set(['Normal', 'Magic', 'Rare', 'Unique'])

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
    displayName: item.name ?? item.baseType,
    name: null,
    type: null,
    category: null,
    rarityOption: null,
    ilvl: null,
    quality: null,
    gemLevel: null,
    mapTier: null,
    corrupted: null,
    stats: [],
    unmatched: []
  }

  if (isCurrency) {
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
    prepared.corrupted = { value: item.corrupted, enabled: true }
    return prepared
  }

  if (isUnique) {
    prepared.name = item.name
    prepared.type = item.baseType
    prepared.rarityOption = 'unique'
  } else if (isEquipment) {
    prepared.category = category
    prepared.rarityOption = 'nonunique'
    // Normal-rarity names carry no affixes, so the exact base is searchable
    // (fragments, keys, white bases).
    if (item.rarity === 'Normal') prepared.type = item.baseType
  }

  if (isEquipment) {
    if (item.itemLevel !== null && !isUnique) prepared.ilvl = range(item.itemLevel)
    if (item.quality !== null) prepared.quality = range(item.quality)
    if (item.waystoneTier !== null) {
      prepared.mapTier = range(item.waystoneTier, { max: item.waystoneTier, enabled: true })
    }
    if (!item.unidentified) prepared.corrupted = { value: item.corrupted, enabled: true }

    const { stats, unmatched } = buildStatRows(item, db, !isUnique, spread)
    prepared.stats = stats
    prepared.unmatched = unmatched
  }

  return prepared
}
