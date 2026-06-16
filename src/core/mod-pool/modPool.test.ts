import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseItem } from '../parser/parse'
import { parseStatLine } from '../parser/statLine'
import { extractBaseType } from '../query/baseType'
import { affixForStat, reconstructAffix } from './modPool'
import basesData from './bases.json'

const badge = (base: string, raw: string): string | null => {
  const r = reconstructAffix(base, parseStatLine(raw))
  return r ? `${r.affix[0].toUpperCase()}${r.tier}` : null
}

describe('reconstructAffix', () => {
  // Ground truth from in-game advanced copies (the tier the inventory tooltip
  // shows). A roll in one bracket pins both the affix and the tier.
  it('reconstructs ring prefixes and suffixes from the roll', () => {
    expect(badge('Ruby Ring', '+43 to maximum Life')).toBe('P5')
    expect(badge('Ruby Ring', '+56 to maximum Mana')).toBe('P8')
    expect(badge('Ruby Ring', '15% increased Cast Speed')).toBe('S4')
    expect(badge('Ruby Ring', 'Gain 7 Mana per enemy killed')).toBe('S4')
  })

  it('matches text-unit brackets even when the stat is stored differently', () => {
    // Leech stats are stored permyriad (600-690) but display "6-6.9%".
    expect(badge('Ruby Ring', 'Leech 6.49% of Physical Attack Damage as Mana')).toBe('S1')
    // "reduced" displays positive but the stat is negative.
    expect(badge('Omen Sceptre', '35% reduced Attribute Requirements')).toBe('S1')
  })

  it('numbers tiers within the base-spawnable family only', () => {
    // crossbow attack-speed ladder is 5 tiers (a naive "any positive tag" test
    // would over-count via blocked weapon tiers).
    expect(badge('Makeshift Crossbow', '14% increased Attack Speed')).toBe('S2')
  })

  it('returns null when a roll fits both a prefix and a suffix bracket', () => {
    // Rarity of Items found exists as both affixes with overlapping brackets;
    // 9% sits in the prefix's 8-11 and the suffix's 6-10 — undecidable.
    expect(badge('Ruby Ring', '9% increased Rarity of Items found')).toBeNull()
  })

  it('returns null for an unknown base or unmatched stat', () => {
    expect(badge('Not A Real Base', '+43 to maximum Life')).toBeNull()
    expect(badge('Ruby Ring', 'Grants Eternal Youth')).toBeNull()
  })
})

describe('affixForStat (crafted/desecrated affix-only)', () => {
  const affix = (base: string, raw: string): string | null =>
    affixForStat(base, parseStatLine(raw))

  it('gives a stat its normal affix slot regardless of the rolled value', () => {
    // crafted/desecrated rolls fall outside the explicit brackets, but the slot
    // is fixed by the stat: cast speed/intelligence are suffixes here.
    expect(affix('Attuned Wand', '26% increased Cast Speed')).toBe('suffix')
    expect(affix('Attuned Wand', '+25 to Intelligence')).toBe('suffix')
    expect(affix('Ruby Ring', '+999 to maximum Life')).toBe('prefix')
  })

  it('is null when the stat rolls as both affixes', () => {
    expect(affix('Ruby Ring', '50% increased Rarity of Items found')).toBeNull()
  })
})

// Regression guard: replay every advanced-copy fixture as if it had been
// chat-copied (reconstruct affix/tier from the bare roll) and compare to the
// tier the advanced copy states. Precision (never a wrong badge) is the
// promise; coverage is tracked so it can't silently collapse.
describe('reconstruction accuracy vs. fixture ground truth', () => {
  const dir = join(__dirname, '../../../fixtures/items')
  const knownBases = Object.keys((basesData as { baseTags: Record<string, string[]> }).baseTags)

  let ok = 0
  let wrong = 0
  let missed = 0
  const wrongs: string[] = []

  for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
    const item = parseItem(readFileSync(join(dir, f), 'utf8'))
    if (item.rarity !== 'Rare' && item.rarity !== 'Magic') continue
    const base =
      item.rarity === 'Rare'
        ? item.baseType
        : (extractBaseType(item.baseType, knownBases) ?? item.baseType)

    const truthMods = item.explicits.filter(
      (m) =>
        !m.crafted &&
        !m.desecrated &&
        m.lines.length === 1 &&
        (m.generation === 'prefix' || m.generation === 'suffix') &&
        m.tier !== null
    )
    // Reconstruct all as if basic-copied, then drop same-group collisions, just
    // like prepareQuery does for a chat item.
    const recs = new Map<(typeof truthMods)[number], ReturnType<typeof reconstructAffix>>()
    const groupCount = new Map<string, number>()
    for (const mod of truthMods) {
      const r = reconstructAffix(base, mod.lines[0])
      if (!r) continue
      recs.set(mod, r)
      groupCount.set(r.group, (groupCount.get(r.group) ?? 0) + 1)
    }
    for (const mod of truthMods) {
      const r = recs.get(mod)
      if (!r || (groupCount.get(r.group) ?? 0) > 1) {
        missed++
        continue
      }
      const got = `${r.affix[0].toUpperCase()}${r.tier}`
      const truth = `${mod.generation[0]!.toUpperCase()}${mod.tier}`
      if (got === truth) ok++
      else {
        wrong++
        wrongs.push(`${base} :: ${mod.lines[0].raw} | got ${got} truth ${truth}`)
      }
    }
  }

  it('is essentially never wrong (precision)', () => {
    const precision = ok / (ok + wrong)
    // The lone known miss is a maximum-mana suffix family absent from the
    // upstream mod dump; everything else reconstructs correctly.
    expect(wrong, wrongs.join('\n')).toBeLessThanOrEqual(1)
    expect(precision).toBeGreaterThan(0.98)
  })

  it('covers most badge-able mods (coverage)', () => {
    expect(ok / (ok + wrong + missed)).toBeGreaterThan(0.7)
  })
})
