import type { ParsedItem, ParsedMod, ParsedStatLine, RollValue } from '../parser/types'
import type { StatsDb } from '../stats-db/statsDb'
import { affixForStat, KNOWN_BASES, reconstructCandidates } from '../mod-pool/modPool'
import { extractBaseType } from './baseType'
import { categoryForItemClass } from './categories'
import { deriveEquipmentValues } from './derived'
import type {
  EquipmentFilterKey,
  ItemFlagKey,
  ModOrigin,
  PreparedEquipmentFilter,
  PreparedFlag,
  PreparedModCount,
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
  /** Last-chosen buyout-price currency (issue #20) seeded into the buyout filter
   *  so the picker remembers the user's choice. null = Exalted Orb Equivalent. */
  buyoutOption?: string | null
}

const DEFAULT_SPREAD = 0.1

// The item level at which every *rollable* mod unlocks its top (T1) tier. Across
// the bundled mod pool (src/core/mod-pool/pool.json, `r` = required_level per
// tier) the max required_level for any mod with spawn weights is exactly 82; the
// only entries above it (flat Chaos damage on weapons, req 83) have no spawn
// weights and can't be crafted. So an ilvl-82 base and an ilvl-90 base roll the
// same top tiers — capping the ilvl filter's min at 82 widens a high-ilvl search
// to all equivalent listings. Re-verify after a patch (re-run gen-mod-pool.mjs).
const T1_ILVL_CEILING = 82

// Quality cap on ordinary equipment. An Exceptional item (issue #14) breaks it.
const NORMAL_MAX_QUALITY = 20

// Normal rune-socket cap per item class (issue #14). Body armour and two-handed
// martial weapons take 2; one-handed martial weapons, helmet/gloves/boots and
// off-hand armour take 1. Caster weapons, quivers, foci and jewellery take none
// and are absent here (an absent class is never socket-flagged). An Exceptional
// item carries one socket past its cap — the "additional Augment Socket".
const NORMAL_MAX_SOCKETS: Record<string, number> = {
  'Body Armours': 2,
  'Two Hand Swords': 2,
  'Two Hand Axes': 2,
  'Two Hand Maces': 2,
  Quarterstaves: 2,
  Bows: 2,
  Crossbows: 2,
  Helmets: 1,
  Gloves: 1,
  Boots: 1,
  Shields: 1,
  Bucklers: 1,
  Claws: 1,
  Daggers: 1,
  'One Hand Swords': 1,
  'One Hand Axes': 1,
  'One Hand Maces': 1,
  Spears: 1,
  Flails: 1
}

// Equipment props whose smart min keeps fractional precision (everything else
// floors to a whole number). aps/crit are fine-grained weapon stats.
const EQUIP_DECIMALS: Partial<Record<EquipmentFilterKey, number>> = { aps: 2, crit: 2 }

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
 * Special provenance of a mod, for the origin tag after the affix badge (issue
 * #54). Mutually exclusive in practice — a mod carries one of these flags at
 * most. A `{ Corruption Enhancement }` mod parses as enhancement-generation with
 * `corrupted` set, so it reads as 'corruption' rather than a plain 'enhanced'
 * anoint. Ordinary rolls return null.
 */
function originFor(mod: ParsedMod): ModOrigin | null {
  if (mod.fractured) return 'fractured'
  if (mod.desecrated) return 'desecrated'
  if (mod.crafted) return 'crafted'
  if (mod.generation === 'enhancement') return mod.corrupted ? 'corruption' : 'enhanced'
  return null
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
  return minWithSpreadPrec(value, spread, 0)
}

/**
 * Lower bound `spread` below the roll, kept to `decimals` of precision. Stat
 * rows and integer equipment props floor to whole numbers (decimals = 0); aps
 * and crit roll fractionally, so their filters keep a decimal or two.
 */
function minWithSpreadPrec(value: number, spread: number, decimals: number): number {
  const lo = value >= 0 ? value * (1 - spread) : value * (1 + spread)
  const f = 10 ** decimals
  return Math.floor(lo * f) / f
}

interface LineContext {
  line: ParsedStatLine
  source: StatSource
  prefer: string[]
  enabled: boolean
  affix: 'prefix' | 'suffix' | null
  /** Special mod provenance (fractured/crafted/…) for the origin tag, or null. */
  origin: ModOrigin | null
  tier: number | null
  /** Reconstructed tier floor (chat copies have no roll range to derive it). */
  reconTierMin?: number
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

interface ReconResult {
  affix: 'prefix' | 'suffix'
  tier: number | null
  tierMin: number | null
}

/**
 * Basic-copy (chat-linked) items carry no affix/tier in the clipboard text, so
 * a parsed explicit mod has generation 'explicit' and tier null. Recover both
 * from the bundled mod pool by matching each rolled value — including
 * crafted/desecrated mods, which reuse the regular tier ladder (a "(crafted)"
 * 26% cast speed is the same T3 a rolled one would be). Advanced-copy mods
 * already state their affix/tier and are left alone.
 *
 * Resolution order:
 *  1. confident — exactly one affix fits the roll (affix + tier);
 *  2. affix-only — no tier (out-of-pool value), but the stat has one fixed slot;
 *  3. group-collision guard — PoE can't roll two mods of one group, so a
 *     collision means we misread one: drop them;
 *  4. slot constraint — an ambiguous roll (fits both a prefix and a suffix) is
 *     forced once one side fills up (rares cap at 3+3, magic at 1+1). The rare
 *     "+1 prefix/suffix" crafts can exceed the cap — a known edge.
 * Anything still undecided stays unbadged.
 */
function reconstructExplicits(
  mods: ParsedMod[],
  reconBase: string | null,
  maxAffix: number
): Map<ParsedMod, ReconResult> {
  const out = new Map<ParsedMod, ReconResult>()
  if (!reconBase) return out

  const confident: Array<{ mod: ParsedMod; affix: 'prefix' | 'suffix'; tier: number; tierMin: number; group: string }> = []
  const ambiguous: Array<{ mod: ParsedMod; cands: ReturnType<typeof reconstructCandidates> }> = []
  const affixOnly: Array<{ mod: ParsedMod; affix: 'prefix' | 'suffix' }> = []

  for (const mod of mods) {
    if (mod.generation !== 'explicit' || mod.tier !== null || mod.lines.length !== 1) continue
    const cands = reconstructCandidates(reconBase, mod.lines[0])
    if (cands.length === 1) {
      // Desecrated mods come from a separate pool that can legitimately share a
      // stat group with a regular/fractured mod (e.g. a fractured + a desecrated
      // "increased Physical Damage" on one item) — namespace the collision key
      // so the same-group guard below doesn't drop the pair as a misread.
      const group = mod.desecrated ? `desecrated:${cands[0].group}` : cands[0].group
      confident.push({ mod, ...cands[0], group })
    } else if (cands.length === 0) {
      const affix = affixForStat(reconBase, mod.lines[0])
      if (affix) affixOnly.push({ mod, affix })
    } else ambiguous.push({ mod, cands })
  }

  // Drop confident reconstructions that collide on a group (impossible — a misread).
  const groupCount = new Map<string, number>()
  for (const c of confident) groupCount.set(c.group, (groupCount.get(c.group) ?? 0) + 1)

  let prefixes = 0
  let suffixes = 0
  const place = (mod: ParsedMod, affix: 'prefix' | 'suffix', tier: number | null, tierMin: number | null): void => {
    out.set(mod, { affix, tier, tierMin })
    // Desecrated mods sit on top of the 3+3 regular affix slots, so they don't
    // consume a slot the ambiguous-roll constraint counts against.
    if (mod.desecrated) return
    if (affix === 'prefix') prefixes++
    else suffixes++
  }
  for (const c of confident) {
    if ((groupCount.get(c.group) ?? 0) > 1) continue
    place(c.mod, c.affix, c.tier, c.tierMin)
  }
  for (const a of affixOnly) place(a.mod, a.affix, null, null)

  // A full affix slot forces every ambiguous roll to the open side. Loop to a
  // fixpoint so cascading resolutions settle (two ambiguous mods, one full side).
  let changed = true
  while (changed && ambiguous.length > 0) {
    changed = false
    for (let i = ambiguous.length - 1; i >= 0; i--) {
      const { cands } = ambiguous[i]
      let pick: (typeof cands)[number] | undefined
      if (prefixes >= maxAffix && suffixes < maxAffix) pick = cands.find((c) => c.affix === 'suffix')
      else if (suffixes >= maxAffix && prefixes < maxAffix) pick = cands.find((c) => c.affix === 'prefix')
      if (pick) {
        place(ambiguous[i].mod, pick.affix, pick.tier, pick.tierMin)
        ambiguous.splice(i, 1)
        changed = true
      }
    }
  }
  return out
}

function collectLines(item: ParsedItem, statsEnabled: boolean, reconBase: string | null): LineContext[] {
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
        origin: null,
        tier: mod.tier,
        group
      })
    }
  }
  const explicitMods = [...item.explicits, ...item.enhancements]
  // Affix-slot caps for the constraint step: magic items hold 1 prefix + 1
  // suffix, rares 3 + 3.
  const maxAffix = item.rarity === 'Magic' ? 1 : 3
  const reconstructed = reconstructExplicits(explicitMods, reconBase, maxAffix)
  for (const mod of explicitMods) {
    group++
    const source: StatSource = mod.generation === 'enhancement' ? 'enchant' : 'explicit'
    // Advanced copy states the affix/tier; for a basic copy the reconstruction
    // fills it (the clipboard tags implicits "(implicit)" even in a chat copy,
    // so the parser already split those out — everything here is an explicit).
    const known = mod.generation === 'prefix' || mod.generation === 'suffix' ? mod.generation : null
    const rec = reconstructed.get(mod)
    const affix = known ?? rec?.affix ?? null
    const tier = known ? mod.tier : (rec?.tier ?? null)
    for (const line of mod.lines) {
      out.push({
        line,
        source,
        prefer: prefer(mod),
        enabled: statsEnabled && source === 'explicit',
        affix,
        origin: originFor(mod),
        tier,
        reconTierMin: known ? undefined : (rec?.tierMin ?? undefined),
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
      origin: null,
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
      // A chat-copy `(enchant)` line is an enhancement (anoint/enchant, or a
      // corruption-added enchant). Chat copies can't say which, so it tags as
      // the generic 'enhanced' (E) — the advanced copy's `{ Corruption
      // Enhancement }` header is the only place the CE distinction survives.
      origin: 'enhanced',
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
  spread: number,
  reconBase: string | null
): { stats: PreparedStatFilter[]; unmatched: string[] } {
  const stats: PreparedStatFilter[] = []
  const templates: string[] = []
  const unmatched: string[] = []
  // First (so-far only) individual row for a stat id; promoted to a display row
  // once a duplicate appears. Then aggByKey points at the searchable total.
  const firstByKey = new Map<string, number>()
  const aggByKey = new Map<string, number>()
  const category = categoryForItemClass(item.itemClass)

  for (const { line, source, prefer, enabled, affix, origin, tier, reconTierMin, group } of collectLines(item, statsEnabled, reconBase)) {
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
    // Advanced copies carry the roll range, so representativeMin gives the tier
    // floor directly; a chat copy has no range, so fall back to the floor the
    // reconstruction recovered from the mod pool.
    let tierMinRaw = representativeMin(rolls) ?? reconTierMin ?? null
    if (best.negated) {
      // increased<->reduced swap: the displayed roll (and its floor) flip sign.
      if (value !== null) value = -value
      if (tierMinRaw !== null) tierMinRaw = -tierMinRaw
    }
    const lineSpread = spreadFor(line.template, spread)
    // Fractional stats (crit chance, attacks/sec) keep two decimals; flooring a
    // 4.41 tier floor to 4 would loosen the search below the tier. Integer stats
    // still floor to a whole number (an added-damage average like 8.5 -> 8 so
    // the worst roll of the tier is never excluded).
    const decimals = rolls.some((r) => !Number.isInteger(r.value)) ? 2 : 0
    const smart = value !== null ? minWithSpreadPrec(value, lineSpread, decimals) : null
    const prec = 10 ** decimals
    const tierMin = tierMinRaw !== null ? Math.floor(tierMinRaw * prec) / prec : null

    const node = (en: boolean): void => {
      stats.push({
        statId: best.id,
        label: line.raw,
        source,
        affix,
        origin,
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
        // and a cross-mod sum has no single tier floor or origin either.
        affix: null,
        origin: null,
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
      // The in-place hybrid node carries the origin tag; this convenience row in
      // the pseudo area stays untagged so a tag isn't shown twice.
      origin: null,
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
    origin: null,
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

// "Number of empty modifiers" pseudo filters (issue #22), for finding crafting
// bases with open affix slots. These are GGG pseudo stat ids searched like any
// other stat; the trade site indexes them itself, so we never derive a value —
// the user bounds them. Offered on rares/magic only (uniques roll fixed mods,
// white bases have none). [pseudo stat id, label].
const MOD_COUNT_FILTERS: ReadonlyArray<[string, string]> = [
  ['pseudo.pseudo_number_of_empty_prefix_mods', 'Open Prefix Modifiers'],
  ['pseudo.pseudo_number_of_empty_suffix_mods', 'Open Suffix Modifiers'],
  ['pseudo.pseudo_number_of_empty_affix_mods', 'Open Modifiers (total)']
]

function modCountFilters(): PreparedModCount[] {
  return MOD_COUNT_FILTERS.map(([statId, label]) => ({
    statId,
    label,
    min: null,
    max: null,
    enabled: false
  }))
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
    gemSockets: null,
    mapTier: null,
    flags: [],
    buyout: { min: null, max: null, option: options.buyoutOption ?? null },
    equipment: [],
    stats: [],
    modCounts: [],
    unmatched: []
  }

  // Anything GGG lists on the in-game Currency Exchange prices off the
  // aggregate snapshot, regardless of rarity — that covers stackable currency
  // AND non-gear oddities like lineage support gems (Rarity: Gem) and uncut
  // gems, which the exchange lists by exact name. Gear (Normal/Magic/Rare/
  // Unique) is never exchange-traded, so it's excluded to avoid a unique name
  // colliding with an exchange id. The exchange view needs nothing else.
  if (!isEquipment) {
    const exchangeId =
      options.exchangeIds?.[item.baseType] ??
      (item.name ? options.exchangeIds?.[item.name] : undefined)
    if (exchangeId) {
      prepared.exchangeId = exchangeId
      return prepared
    }
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
    // Skill/Spirit gem view (issue #58): the price-defining knobs are gem level,
    // quality, support-gem sockets, and corruption — all default-armed to the
    // item's own values (min-only, "at least this") so the check finds gems at
    // least as good. Corruption is pinned (a corrupted gem is a different item).
    prepared.type = item.baseType
    const levelProp = item.properties.find((p) => /^Level: \d+/.test(p.raw))
    const level = levelProp ? Number(levelProp.raw.match(/^Level: (\d+)/)![1]) : null
    if (level !== null) prepared.gemLevel = range(level, { enabled: true })
    if (item.quality !== null) prepared.quality = range(item.quality, { enabled: true })
    if (item.sockets !== null) prepared.gemSockets = range(item.sockets, { enabled: true })
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
    if (item.itemLevel !== null && !isUnique) {
      // Cap the search floor at the T1 ceiling — a higher ilvl rolls no better
      // tiers, so 82+ matches every equivalent base. Default the filter ON for
      // Normal bases (their value IS their ilvl — a crafting input), opt-in for
      // Magic/Rare (dominated by their actual mods). `value` keeps the item's
      // real ilvl for display; only `min` is capped.
      const min = Math.min(item.itemLevel, T1_ILVL_CEILING)
      prepared.ilvl = range(item.itemLevel, { min, enabled: item.rarity === 'Normal' })
    }
    if (item.quality !== null) prepared.quality = range(item.quality)
    if (item.waystoneTier !== null) {
      prepared.mapTier = range(item.waystoneTier, { max: item.waystoneTier, enabled: true })
    }
    // Uniques can only meaningfully be corrupted — the rest (mirrored aside,
    // which is too rare to filter on) don't describe a unique's price.
    prepared.flags = isUnique
      ? [{ key: 'corrupted', label: 'Corrupted', state: 'any' }]
      : equipmentFlags()

    prepared.equipment = deriveEquipmentValues(item).map((d): PreparedEquipmentFilter => {
      // Socket counts are small integers — "at least this many" wants the exact
      // count, not 90% of it. aps/crit roll fractionally, so keep their decimals.
      const noSpread = d.key === 'rune_sockets'
      const smartMin = noSpread
        ? d.value
        : minWithSpreadPrec(d.value, spread, EQUIP_DECIMALS[d.key] ?? 0)
      return {
        ...d,
        smartMin,
        tierMin: null,
        // Sockets start matched at 100% (smart == roll); the rest pre-fill at
        // the loose smart default and cycle up to the roll via the "=" button.
        quickMode: noSpread ? 'roll' : 'smart',
        min: smartMin,
        max: null,
        enabled: false
      }
    })

    // Exceptional items (issue #14) drop with a bonus past the normal cap: quality
    // over the 20% maximum and/or an extra augment socket (one past the item
    // class's normal socket cap). Detect each independently — one item can exceed
    // both — and default-arm the matching filter so the check scopes to
    // comparably-exceptional listings. Read off the numbers, not the name: only
    // white items decorate the base with the literal "Exceptional" word; a
    // Magic/Rare exceptional carries its normal magic/rare name.
    if (prepared.quality && item.quality !== null && item.quality > NORMAL_MAX_QUALITY) {
      prepared.quality.enabled = true
    }
    const maxSockets = NORMAL_MAX_SOCKETS[item.itemClass]
    if (maxSockets !== undefined && item.sockets !== null && item.sockets > maxSockets) {
      const sockets = prepared.equipment.find((e) => e.key === 'rune_sockets')
      if (sockets) sockets.enabled = true
    }

    // Affix/tier reconstruction needs the clean base name (the join key into the
    // mod pool's spawn tags). Resolve it against the pool's own base list so a
    // decorated name — magic affixes ("… of the Rainbow") or weapon/armour tier
    // words ("Expert Dualstring Bow") — maps to the real base. Uniques roll
    // unique-specific mods (not in the pool) and whites have no explicits.
    const reconBase =
      item.rarity === 'Rare' || item.rarity === 'Magic'
        ? extractBaseType(item.baseType, KNOWN_BASES) ?? item.baseType
        : null

    const { stats, unmatched } = buildStatRows(item, db, !isUnique, spread, reconBase)
    prepared.stats = stats
    prepared.unmatched = unmatched

    // Open-affix-slot counts (issue #22) only make sense where slots can be
    // empty — a rolled rare or magic item. Uniques have fixed mods, whites none.
    if (item.rarity === 'Rare' || item.rarity === 'Magic') {
      prepared.modCounts = modCountFilters()
    }
  }

  return prepared
}
