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
})
