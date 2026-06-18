import { describe, expect, it } from 'vitest'
import { conflictingMod, itemMods } from './conflict'
import { parseItem } from '../parser/parse'

describe('conflictingMod', () => {
  const mods = [
    { label: '+127 to maximum Mana', groups: ['IncreasedMana'] },
    { label: '+38% to Cold Resistance', groups: ['ColdResistance'] }
  ]

  it('returns the mod sharing a group', () => {
    expect(conflictingMod(['IncreasedMana'], mods)?.label).toBe('+127 to maximum Mana')
  })

  it('returns null when no group overlaps', () => {
    expect(conflictingMod(['SpellDamage'], mods)).toBeNull()
  })

  it('an empty group list never conflicts (mods without a normal group)', () => {
    expect(conflictingMod([], mods)).toBeNull()
  })

  it('matches when any of several groups overlaps', () => {
    expect(conflictingMod(['Foo', 'ColdResistance'], mods)?.label).toBe('+38% to Cold Resistance')
  })
})

describe('itemMods', () => {
  it('reads each explicit mod with its resolved groups, skipping implicits', () => {
    // Advanced-copy Sapphire Ring: one explicit max-Mana prefix + an implicit.
    const text = [
      'Item Class: Rings',
      'Rarity: Rare',
      'Storm Whorl',
      'Sapphire Ring',
      '--------',
      'Requirements:',
      'Level: 40',
      '--------',
      'Item Level: 81',
      '--------',
      '+30% to Cold Resistance (implicit)',
      '--------',
      '{ Prefix Modifier "Paramount" (Tier: 1) }',
      '+125 to maximum Mana',
      '--------'
    ].join('\n')
    const item = parseItem(text)
    const mods = itemMods(item, item.baseType)
    expect(mods).toHaveLength(1)
    expect(mods[0].label).toBe('+125 to maximum Mana')
    expect(mods[0].groups).toContain('IncreasedMana')
  })

  // A stat that rolls as both a prefix and a suffix under different groups must
  // resolve by the copied affix, so suffix-rarity and prefix-rarity don't cross-
  // block (issue #72 — the Greater Essence of Opulence case).
  function ringWithRarity(slot: 'Prefix' | 'Suffix'): string {
    return [
      'Item Class: Rings',
      'Rarity: Rare',
      'Glyph Knuckle',
      'Sapphire Ring',
      '--------',
      'Item Level: 81',
      '--------',
      `{ ${slot} Modifier "Shining" (Tier: 3) }`,
      '16% increased Rarity of Items found',
      '--------'
    ].join('\n')
  }

  it('suffix rarity resolves to the suffix group only', () => {
    const [m] = itemMods(parseItem(ringWithRarity('Suffix')), 'Sapphire Ring')
    expect(m.groups).toContain('ItemFoundRarityIncrease')
    expect(m.groups).not.toContain('ItemFoundRarityIncreasePrefix')
  })

  it('prefix rarity resolves to the prefix group only', () => {
    const [m] = itemMods(parseItem(ringWithRarity('Prefix')), 'Sapphire Ring')
    expect(m.groups).toContain('ItemFoundRarityIncreasePrefix')
    expect(m.groups).not.toContain('ItemFoundRarityIncrease')
  })

  // A jewel's mods live in a different mod domain than gear; itemMods resolves
  // them against the jewel group table (issue #78).
  it('a jewel mod resolves against the jewel group table', () => {
    const text = [
      'Item Class: Jewels',
      'Rarity: Rare',
      'Glittering Rapture',
      'Emerald',
      '--------',
      'Item Level: 80',
      '--------',
      '{ Prefix Modifier "Sturdy" (Tier: 2) }',
      '15% increased Evasion Rating',
      '--------'
    ].join('\n')
    const item = parseItem(text)
    const [m] = itemMods(item, 'Emerald')
    expect(m.label).toBe('15% increased Evasion Rating')
    expect(m.groups).toContain('EvasionRatingPercent')
  })
})
