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
})
