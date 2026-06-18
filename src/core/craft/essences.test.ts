import { describe, expect, it } from 'vitest'
import { essencesForItem } from './essences'

describe('essencesForItem', () => {
  it('magic boots: only Greater essences, each with boots-applicable mod text', () => {
    const { applicable, note } = essencesForItem('Boots', 'Magic')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/upgrade/i)
    expect(applicable.every((e) => e.tier === 'greater')).toBe(true)
    // Life rolls on boots — and at the boots-specific (not belt/body) range.
    const body = applicable.find((e) => e.name === 'Greater Essence of the Body')
    expect(body?.modText).toBe('+(85–99) to maximum Life')
    // Attack-speed essences target weapons only — never boots.
    expect(applicable.some((e) => e.family === 'Haste')).toBe(false)
  })

  it('rare boots: only Perfect & corrupted essences', () => {
    const { applicable, note } = essencesForItem('Boots', 'Rare')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/Perfect/)
    expect(applicable.every((e) => e.tier === 'perfect' || e.tier === 'corrupted')).toBe(true)
  })

  it('rare with an open crafted slot still offers Perfect & corrupted (issue #24)', () => {
    const { applicable } = essencesForItem('Boots', 'Rare', { used: 0, cap: 1 })
    expect(applicable.length).toBeGreaterThan(0)
  })

  it('rare at the crafted-mod cap hides Perfect & corrupted with a reason (issue #24)', () => {
    const { applicable, note } = essencesForItem('Boots', 'Rare', { used: 1, cap: 1 })
    expect(applicable).toEqual([])
    expect(note).toMatch(/already has a crafted modifier/i)
    expect(note).toMatch(/can't be applied/i)
  })

  it("Astrid's Creativity raises the cap to 2 before blocking (issue #24)", () => {
    // One crafted mod, cap 2 → still room for an essence.
    expect(essencesForItem('Boots', 'Rare', { used: 1, cap: 2 }).applicable.length).toBeGreaterThan(0)
    // Two crafted mods, cap 2 → blocked, note names the raised cap and Astrid.
    const full = essencesForItem('Boots', 'Rare', { used: 2, cap: 2 })
    expect(full.applicable).toEqual([])
    expect(full.note).toMatch(/2 crafted modifiers/i)
    expect(full.note).toMatch(/Astrid/i)
  })

  it('normal item: Greater essences with a transmute hint', () => {
    const { applicable, note } = essencesForItem('Rings', 'Normal')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/Transmute/i)
    expect(applicable.every((e) => e.tier === 'greater')).toBe(true)
  })

  it('unique item: nothing applies, with an explanation', () => {
    const { applicable, note } = essencesForItem('Rings', 'Unique')
    expect(applicable).toEqual([])
    expect(note).toMatch(/Unique/)
  })

  it('non-equipment class: empty without a note', () => {
    const { applicable, note } = essencesForItem('Waystones', 'Normal')
    expect(applicable).toEqual([])
    expect(note).toBeNull()
  })

  it('weapon-targeted families resolve per-class mod text', () => {
    const bow = essencesForItem('Bows', 'Magic')
    const haste = bow.applicable.filter((e) => e.family === 'Haste')
    expect(haste.length).toBeGreaterThan(0)
    expect(haste.every((e) => /Attack Speed/.test(e.modText))).toBe(true)
  })

  it('lesser and regular tiers are never offered', () => {
    for (const rarity of ['Normal', 'Magic', 'Rare']) {
      const { applicable } = essencesForItem('Body Armours', rarity)
      expect(applicable.some((e) => e.tier === 'lesser' || e.tier === 'normal')).toBe(false)
    }
  })

  it('every offered essence carries its bundled icon', () => {
    const { applicable } = essencesForItem('Boots', 'Rare')
    expect(applicable.every((e) => e.icon !== null && e.icon.endsWith('.webp'))).toBe(true)
  })

  it('without item mods, nothing is flagged blocked', () => {
    const { applicable } = essencesForItem('Rings', 'Rare', { used: 0, cap: 1 })
    expect(applicable.length).toBeGreaterThan(0)
    expect(applicable.every((e) => e.blockedBy === null)).toBe(true)
  })

  it('rare: an augment essence is blocked by a same-group mod (issue #72)', () => {
    // Perfect Essence of the Mind grants "% increased maximum Mana"
    // (group MaximumManaIncreasePercent); a Rare already carrying that group
    // mod blocks it, while same-list essences stay usable.
    const existing = [{ label: '8% increased maximum Mana', groups: ['MaximumManaIncreasePercent'] }]
    const { applicable } = essencesForItem('Rings', 'Rare', { used: 0, cap: 1 }, existing)
    const mind = applicable.find((e) => e.name === 'Perfect Essence of the Mind')
    expect(mind?.blockedBy).toBe('8% increased maximum Mana')
    expect(applicable.filter((e) => e.name !== 'Perfect Essence of the Mind').every((e) => e.blockedBy === null)).toBe(true)
  })

  it('greater: a Magic→Rare essence is blocked by a same-group mod (issue #72)', () => {
    // The user's case: a Magic item with a Rarity suffix can't take Greater
    // Essence of Opulence (group ItemFoundRarityIncrease).
    const existing = [{ label: '14% increased Rarity of Items found', groups: ['ItemFoundRarityIncrease'] }]
    const { applicable } = essencesForItem('Rings', 'Magic', undefined, existing)
    const opulence = applicable.find((e) => e.name === 'Greater Essence of Opulence')
    expect(opulence?.blockedBy).toBe('14% increased Rarity of Items found')
  })

  it('a prefix-rarity mod does NOT block the suffix-rarity Opulence (issue #72)', () => {
    // The whole point of resolving affix-split groups: prefix rarity and suffix
    // rarity are different groups, so a prefix-rarity item leaves Opulence usable.
    const existing = [
      { label: '14% increased Rarity of Items found', groups: ['ItemFoundRarityIncreasePrefix'] }
    ]
    const { applicable } = essencesForItem('Rings', 'Magic', undefined, existing)
    const opulence = applicable.find((e) => e.name === 'Greater Essence of Opulence')
    expect(opulence?.blockedBy).toBeNull()
  })

  it('a mod in a different group never blocks (issue #72)', () => {
    const existing = [{ label: '+25 to Strength', groups: ['Strength'] }]
    const { applicable } = essencesForItem('Rings', 'Rare', { used: 0, cap: 1 }, existing)
    expect(applicable.every((e) => e.blockedBy === null)).toBe(true)
  })
})
