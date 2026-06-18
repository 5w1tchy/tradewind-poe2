import { describe, expect, it } from 'vitest'
import { liquidsForItem } from './liquids'

describe('liquidsForItem', () => {
  it('rare basic jewel: base emotions resolve the gem-specific mod, no Ancient ones', () => {
    const { applicable, note } = liquidsForItem('Jewels', 'Emerald', 'Rare')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/Rare jewel/i)
    // Emerald reads the Emerald line off each liquid (Ire → Evasion).
    const ire = applicable.find((l) => l.name === 'Diluted Liquid Ire')
    expect(ire?.mods).toEqual([
      { affix: 'prefix', text: '(10–20)% increased Evasion Rating', blockedBy: null }
    ])
    // Ancient (Time-Lost) liquids never apply to a basic jewel.
    expect(applicable.some((l) => l.name.startsWith('Ancient'))).toBe(false)
  })

  it('rare Time-Lost jewel: only Ancient liquids, with radius mod text', () => {
    const { applicable, note } = liquidsForItem('Jewels', 'Time-Lost Sapphire', 'Rare')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/Time-Lost/i)
    expect(applicable.every((l) => l.name.startsWith('Ancient'))).toBe(true)
    const ire = applicable.find((l) => l.name === 'Ancient Diluted Liquid Ire')
    expect(ire?.mods[0].text).toMatch(/Passive Skills in Radius/i)
  })

  it('an attribute gem (Emerald) gets only its own deterministic mod', () => {
    const { applicable } = liquidsForItem('Jewels', 'Emerald', 'Rare')
    const ire = applicable.find((l) => l.name === 'Diluted Liquid Ire')
    expect(ire?.mods).toEqual([
      { affix: 'prefix', text: '(10–20)% increased Evasion Rating', blockedBy: null }
    ])
  })

  it('Diamond rolls any attribute variant when the liquid has no Diamond column', () => {
    const { applicable } = liquidsForItem('Jewels', 'Diamond', 'Rare')
    // Ire has no Diamond column, yet applies — it can roll any attribute variant.
    const ire = applicable.find((l) => l.name === 'Diluted Liquid Ire')
    expect(ire?.mods.map((m) => m.text)).toEqual([
      '(10–20)% increased Armour',
      '(10–20)% increased maximum Energy Shield',
      '(10–20)% increased Evasion Rating'
    ])
  })

  it('Diamond takes only its own column when the liquid has a Diamond line', () => {
    const { applicable } = liquidsForItem('Jewels', 'Diamond', 'Rare')
    // Isolation has a dedicated Diamond line, so a Diamond gets ONLY chaos res.
    const iso = applicable.find((l) => l.name === 'Concentrated Liquid Isolation')
    expect(iso?.mods).toEqual([
      { affix: 'suffix', text: '+1% to Maximum Chaos Resistance', blockedBy: null }
    ])
  })

  it('Potent Ferocity on Diamond dedupes to a single prefix/suffix pair', () => {
    const { applicable } = liquidsForItem('Jewels', 'Diamond', 'Rare')
    const fero = applicable.find((l) => l.name === 'Potent Liquid Ferocity')
    // Eight raw lines (4 gems × P/S) collapse to the two distinct outcomes.
    expect(fero?.mods).toHaveLength(2)
    expect(fero?.mods.map((m) => m.affix).sort()).toEqual(['prefix', 'suffix'])
  })

  it('Potent liquids offer both a prefix and a suffix option, sorted last', () => {
    const { applicable } = liquidsForItem('Jewels', 'Ruby', 'Rare')
    const fero = applicable.find((l) => l.name === 'Potent Liquid Ferocity')
    expect(fero?.potent).toBe(true)
    expect(fero?.mods.map((m) => m.affix).sort()).toEqual(['prefix', 'suffix'])
    // Potent liquids sort after the base emotions.
    const firstPotent = applicable.findIndex((l) => l.potent)
    expect(applicable.slice(firstPotent).every((l) => l.potent)).toBe(true)
  })

  it('magic / normal jewel: nothing applies, Rare-only hint', () => {
    for (const rarity of ['Magic', 'Normal']) {
      const { applicable, note } = liquidsForItem('Jewels', 'Emerald', rarity)
      expect(applicable).toEqual([])
      expect(note).toMatch(/only apply to Rare/i)
    }
  })

  it('unique jewel: nothing applies, with an explanation', () => {
    const { applicable, note } = liquidsForItem('Jewels', 'Time-Lost Diamond', 'Unique')
    expect(applicable).toEqual([])
    expect(note).toMatch(/cannot be used on Unique/i)
  })

  it('rare jewel at the crafted-mod cap hides liquids with a reason (issue #24)', () => {
    const { applicable, note } = liquidsForItem('Jewels', 'Emerald', 'Rare', { used: 1, cap: 1 })
    expect(applicable).toEqual([])
    expect(note).toMatch(/already has a crafted modifier/i)
    expect(note).toMatch(/Liquid Emotions can't be applied/i)
  })

  it('rare jewel with an open crafted slot still offers liquids', () => {
    expect(
      liquidsForItem('Jewels', 'Emerald', 'Rare', { used: 0, cap: 1 }).applicable.length
    ).toBeGreaterThan(0)
  })

  it('non-jewel item: empty without a note', () => {
    const { applicable, note } = liquidsForItem('Boots', 'Refined Bracers', 'Rare')
    expect(applicable).toEqual([])
    expect(note).toBeNull()
  })

  it('unrecognized jewel base: empty without a note', () => {
    const { applicable, note } = liquidsForItem('Jewels', 'Cobalt', 'Rare')
    expect(applicable).toEqual([])
    expect(note).toBeNull()
  })

  it('every offered liquid carries its bundled icon', () => {
    const { applicable } = liquidsForItem('Jewels', 'Emerald', 'Rare')
    expect(applicable.every((l) => l.icon !== null && l.icon.endsWith('.webp'))).toBe(true)
  })

  it('without item mods, no liquid outcome is flagged blocked (issue #78)', () => {
    const { applicable } = liquidsForItem('Jewels', 'Emerald', 'Rare', { used: 0, cap: 1 })
    expect(applicable.every((l) => l.mods.every((m) => m.blockedBy === null))).toBe(true)
  })

  it('a same-group jewel mod blocks the matching liquid outcome (issue #78)', () => {
    // Diluted Liquid Ire on Emerald grants increased Evasion Rating
    // (group EvasionRatingPercent); a jewel already carrying that group blocks it.
    const existing = [{ label: '15% increased Evasion Rating', groups: ['EvasionRatingPercent'] }]
    const { applicable } = liquidsForItem('Jewels', 'Emerald', 'Rare', { used: 0, cap: 1 }, existing)
    const ire = applicable.find((l) => l.name === 'Diluted Liquid Ire')
    expect(ire?.mods[0].blockedBy).toBe('15% increased Evasion Rating')
    // A liquid in an unrelated group stays usable.
    const guilt = applicable.find((l) => l.name === 'Diluted Liquid Guilt')
    expect(guilt?.mods.every((m) => m.blockedBy === null)).toBe(true)
  })

  it('only the conflicting outcome of a "rolls one of" liquid is blocked (issue #78)', () => {
    // Diamond Ire rolls one of armour / ES / evasion; an existing Evasion mod
    // blocks only the evasion outcome, leaving the others usable.
    const existing = [{ label: '15% increased Evasion Rating', groups: ['EvasionRatingPercent'] }]
    const { applicable } = liquidsForItem('Jewels', 'Diamond', 'Rare', { used: 0, cap: 1 }, existing)
    const ire = applicable.find((l) => l.name === 'Diluted Liquid Ire')
    const blocked = ire?.mods.filter((m) => m.blockedBy !== null) ?? []
    expect(blocked).toHaveLength(1)
    expect(blocked[0].text).toMatch(/Evasion Rating/)
  })

  it('Time-Lost liquids never block (their mods are absent from the dump) (issue #78)', () => {
    // Even with item mods present, Ancient (Time-Lost) outcomes carry no groups.
    const existing = [{ label: 'anything', groups: ['EvasionRatingPercent', 'AreaOfEffect'] }]
    const { applicable } = liquidsForItem(
      'Jewels',
      'Time-Lost Emerald',
      'Rare',
      { used: 0, cap: 1 },
      existing
    )
    expect(applicable.every((l) => l.mods.every((m) => m.blockedBy === null))).toBe(true)
  })
})
