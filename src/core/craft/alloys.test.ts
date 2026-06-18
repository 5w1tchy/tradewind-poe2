import { describe, expect, it } from 'vitest'
import { alloysForItem } from './alloys'

describe('alloysForItem', () => {
  it('rare ring: lists alloys with the ring-applicable guaranteed mod', () => {
    const { applicable, note } = alloysForItem('Rings', 'Rare')
    expect(applicable.length).toBeGreaterThan(0)
    expect(note).toMatch(/Rare/i)
    const runic = applicable.find((a) => a.name === 'Runic Alloy')
    expect(runic?.modText).toBe('+(37–49) to maximum Runic Ward')
    expect(runic?.affix).toBe('prefix')
  })

  it('resolves per-class mod text (a wand differs from a ring)', () => {
    const wand = alloysForItem('Wands', 'Rare').applicable.find((a) => a.name === 'Celestial Alloy')
    expect(wand?.modText).toMatch(/maximum Mana/)
  })

  it('non-Rare item: empty with the Rare-only note', () => {
    for (const rarity of ['Normal', 'Magic', 'Unique']) {
      const { applicable, note } = alloysForItem('Rings', rarity)
      expect(applicable).toEqual([])
      expect(note).toMatch(/only be used on Rare/i)
    }
  })

  it('class with no alloys: empty without a note', () => {
    const { applicable, note } = alloysForItem('Waystones', 'Rare')
    expect(applicable).toEqual([])
    expect(note).toBeNull()
  })

  it('rare at the crafted-mod cap is blocked with a reason (issue #24)', () => {
    const { applicable, note } = alloysForItem('Rings', 'Rare', { used: 1, cap: 1 })
    expect(applicable).toEqual([])
    expect(note).toMatch(/Runic Alloys can't be applied/i)
  })

  it('rare with an open crafted slot still lists alloys (issue #24)', () => {
    const { applicable } = alloysForItem('Rings', 'Rare', { used: 0, cap: 1 })
    expect(applicable.length).toBeGreaterThan(0)
  })

  it('without item mods, nothing is flagged blocked', () => {
    const { applicable } = alloysForItem('Wands', 'Rare', { used: 0, cap: 1 })
    expect(applicable.every((a) => a.blockedBy === null)).toBe(true)
  })

  it('an alloy is blocked by a same-group mod (issue #51)', () => {
    // Celestial Alloy grants a +max Mana mod (group IncreasedMana) on a wand; a
    // wand already carrying that group blocks it, others stay usable.
    const existing = [{ label: '+80 to maximum Mana', groups: ['IncreasedMana'] }]
    const { applicable } = alloysForItem('Wands', 'Rare', { used: 0, cap: 1 }, existing)
    const celestial = applicable.find((a) => a.name === 'Celestial Alloy')
    expect(celestial?.blockedBy).toBe('+80 to maximum Mana')
    expect(applicable.filter((a) => a.name !== 'Celestial Alloy').every((a) => a.blockedBy === null)).toBe(true)
  })

  it('a mod in a different group never blocks (issue #51)', () => {
    const existing = [{ label: '+25 to Strength', groups: ['Strength'] }]
    const { applicable } = alloysForItem('Wands', 'Rare', { used: 0, cap: 1 }, existing)
    expect(applicable.every((a) => a.blockedBy === null)).toBe(true)
  })

  it('every offered alloy carries its bundled icon', () => {
    const { applicable } = alloysForItem('Rings', 'Rare')
    expect(applicable.every((a) => a.icon !== null && a.icon!.endsWith('.webp'))).toBe(true)
  })

  it('lists alloys alphabetically by name', () => {
    const names = alloysForItem('Rings', 'Rare').applicable.map((a) => a.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})
