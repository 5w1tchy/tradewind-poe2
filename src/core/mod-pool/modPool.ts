import type { ParsedStatLine } from '../parser/types'
import { normalizeStatText } from '../stats-db/statsDb'
import poolData from './pool.json'
import basesData from './bases.json'

/**
 * Reconstructs a mod's affix (prefix/suffix) and tier from its rolled value,
 * for items copied in the *basic* clipboard form — chat-linked items, which
 * carry no "{ Prefix … (Tier: N) }" headers (see src/core/parser/parse.ts).
 * The advanced (inventory) copy already states both, so this only fills the
 * gaps the basic copy leaves null.
 *
 * Data is the committed src/core/mod-pool/pool.json (run scripts/gen-mod-pool
 * after PoE2 patches). A roll alone is sometimes ambiguous — the same value can
 * sit in two different tiers' (or a prefix's and a suffix's) brackets — and the
 * answer is then null: no badge beats a wrong one.
 */
export interface ReconstructedAffix {
  affix: 'prefix' | 'suffix'
  tier: number
  /** Lowest roll of this tier (avg of the bracket mins) — the "Match Tier" floor. */
  tierMin: number
  /** Mod group — callers use it to detect an impossible same-group collision. */
  group: string
}

interface PoolEntry {
  /** normalizeStatText'd mod text (numbers -> '#'), the match key. */
  t: string
  /** Group name — reroll-exclusivity; tiers number within a group + stat. */
  g: string
  /** Affix: 'p' prefix, 's' suffix. */
  a: 'p' | 's'
  /** Required level — the ladder sorts by it ascending. */
  r: number
  /** Stat brackets [[min,max], …], parallel to the line's roll values. */
  b: [number, number][]
  /** Ordered spawn rule (see spawnsOn): a "!"-prefixed tag has weight 0. */
  w: string[]
}

const ENTRIES = (poolData as unknown as { entries: PoolEntry[] }).entries
const BASE_TAGS = (basesData as { baseTags: Record<string, string[]> }).baseTags

/** Every known base name — callers resolve a decorated item name against this
 *  (weapon/armour bases carry "Advanced"/"Expert" tier words the data omits). */
export const KNOWN_BASES = Object.keys(BASE_TAGS)

// Match key -> entries. Built once; the pool is ~1.6k entries.
const byText = new Map<string, PoolEntry[]>()
for (const entry of ENTRIES) {
  const existing = byText.get(entry.t)
  if (existing) existing.push(entry)
  else byText.set(entry.t, [entry])
}

/**
 * Can this mod roll on a base with these tags? PoE evaluates spawn_weights in
 * order — the FIRST listed tag the base has decides it (a "!"-prefixed tag is
 * weight 0, i.e. blocked). No tag matching means it can't spawn. This ordering
 * matters: a "!crossbow" before "weapon" blocks crossbows from a weapon mod,
 * which a naive "any positive tag" test would miss and overcount tiers.
 *
 * An empty rule marks an essence-only mod (no random spawn weights): it's
 * applied deliberately, so for a mod the item already carries we treat it as
 * matching any base.
 */
function spawnsOn(entry: PoolEntry, baseTags: Set<string>): boolean {
  if (entry.w.length === 0) return true
  for (const tag of entry.w) {
    if (tag[0] === '!') {
      if (baseTags.has(tag.slice(1))) return false
    } else if (baseTags.has(tag)) {
      return true
    }
  }
  return false
}

const EPSILON = 1e-9

function bracketsContain(entry: PoolEntry, values: number[]): boolean {
  if (entry.b.length !== values.length) return false
  return entry.b.every(([min, max], i) => values[i] >= min - EPSILON && values[i] <= max + EPSILON)
}

/**
 * Tier of a matched mod: GGG numbers the highest-requirement tier T1, counting
 * only the tiers of *this same stat* that can roll on this base. Restricting to
 * the same group + stat text is essential — a group can lump distinct stats
 * (every per-element "+# to Level of X Spell Skills" shares one group), and
 * spawnsOn drops base-inapplicable tiers — so the ladder is exactly the family
 * the game tiers.
 */
function tierOf(matched: PoolEntry, ladderEntries: PoolEntry[]): number {
  // Count within the same kind: essence-only tiers (empty rule) and randomly
  // rolled tiers are separate ladders, so an essence mod doesn't inflate a
  // regular stat's tier count and vice versa.
  const essence = matched.w.length === 0
  const ladder = ladderEntries.filter(
    (e) => e.g === matched.g && (e.w.length === 0) === essence
  )
  ladder.sort((a, b) => a.r - b.r || a.b[0][1] - b.b[0][1])
  return ladder.length - ladder.indexOf(matched)
}

/** The tier's lowest roll: the average of its bracket minimums. */
function tierFloor(entry: PoolEntry): number {
  return entry.b.reduce((sum, [min]) => sum + min, 0) / entry.b.length
}

/**
 * Candidate entries for a stat on a base: the normally-rolled (tagged) tiers if
 * the base has any, otherwise the essence/applied-only ones (empty rule). Using
 * essence mods only as a fallback keeps a regular stat — which an essence
 * variant often shares text with — from being made ambiguous.
 */
function candidatesOnBase(key: string, baseTags: Set<string>): PoolEntry[] {
  const sameStat = byText.get(key)
  if (!sameStat) return []
  const rolled = sameStat.filter((e) => e.w.length > 0 && spawnsOn(e, baseTags))
  return rolled.length > 0 ? rolled : sameStat.filter((e) => e.w.length === 0)
}

/**
 * Affix only (no tier) for a stat on a base. Used for crafted/desecrated mods:
 * they live in their own mod pools with different values (so their tier can't be
 * read from the explicit pool, and repoe-fork's crafted pool is incomplete), but
 * a mod always occupies the slot of its stat's normal affix — cast speed is
 * always a suffix, life always a prefix. Null when the base doesn't roll the
 * stat or it rolls as both affixes (e.g. Rarity of Items found).
 */
export function affixForStat(baseType: string, line: ParsedStatLine): 'prefix' | 'suffix' | null {
  const tags = BASE_TAGS[baseType]
  if (!tags) return null
  const onBase = candidatesOnBase(normalizeStatText(line.raw), new Set(tags))
  if (onBase.length === 0) return null
  const affixes = new Set(onBase.map((e) => e.a))
  if (affixes.size !== 1) return null
  return onBase[0].a === 'p' ? 'prefix' : 'suffix'
}

/**
 * One reconstruction per affix the roll could be. Each entry is a confident
 * answer *for that affix* — its tier within the affix's family is unique.
 * Returns:
 *   []  no stat/bracket match;
 *   [x] confident (one affix fits);
 *   [p, s] ambiguous — the roll fits both a prefix and a suffix bracket, which
 *          the value alone can't separate (the caller may use the item's free
 *          affix slots to pick one).
 * An affix whose fitting tiers overlap (value in two tiers of the same family)
 * yields no entry for that affix — the tier is genuinely undecidable.
 */
export function reconstructCandidates(baseType: string, line: ParsedStatLine): ReconstructedAffix[] {
  const tags = BASE_TAGS[baseType]
  if (!tags) return []
  const onBase = candidatesOnBase(normalizeStatText(line.raw), new Set(tags))
  if (onBase.length === 0) return []
  const values = line.values.map((v) => v.value)
  const fits = onBase.filter((e) => bracketsContain(e, values))

  const out: ReconstructedAffix[] = []
  for (const a of ['p', 's'] as const) {
    const ofAffix = fits.filter((e) => e.a === a)
    if (ofAffix.length === 0) continue
    const tiers = new Set(ofAffix.map((e) => tierOf(e, onBase)))
    if (tiers.size !== 1) continue
    const matched = ofAffix[0]
    out.push({
      affix: a === 'p' ? 'prefix' : 'suffix',
      tier: tierOf(matched, onBase),
      tierMin: tierFloor(matched),
      group: matched.g
    })
  }
  return out
}

export function reconstructAffix(
  baseType: string,
  line: ParsedStatLine
): ReconstructedAffix | null {
  const candidates = reconstructCandidates(baseType, line)
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Every repoe mod-group a stat line could belong to on a base — for the
 * group-conflict gate (#72/#51), which needs only the *group*, not the tier.
 * Unlike reconstruct*, this stays deliberately loose: a mod's group is intrinsic
 * to its stat, so it returns all candidate groups and a conflict is caught even
 * when the exact tier is ambiguous. Base tags narrow the candidates when known;
 * an unknown base falls back to every entry with that text. Empty when the stat
 * isn't in the pool.
 *
 * `affix` (from an advanced copy's prefix/suffix header) disambiguates the few
 * stats that roll as *both* a prefix and a suffix under different groups — most
 * notably Rarity of Items found (suffix `ItemFoundRarityIncrease` vs prefix
 * `ItemFoundRarityIncreasePrefix`), so a suffix-rarity mod doesn't collide with
 * a prefix-rarity essence and vice versa. Null/absent (a basic chat-link copy,
 * which carries no affix) keeps both — the conservative "don't guess" default.
 */
export function groupsForLine(
  baseType: string,
  line: ParsedStatLine,
  affix?: 'prefix' | 'suffix' | null
): string[] {
  const sameStat = byText.get(normalizeStatText(line.raw))
  if (!sameStat) return []
  let pool = sameStat
  const a = affix === 'prefix' ? 'p' : affix === 'suffix' ? 's' : null
  if (a) {
    const byAffix = sameStat.filter((e) => e.a === a)
    if (byAffix.length) pool = byAffix
  }
  const tags = BASE_TAGS[baseType]
  const onBase = tags ? pool.filter((e) => spawnsOn(e, new Set(tags))) : []
  pool = onBase.length > 0 ? onBase : pool
  return [...new Set(pool.map((e) => e.g))]
}
