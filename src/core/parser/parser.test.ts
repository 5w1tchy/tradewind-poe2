import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseItem } from './parse'
import { parseModHeader } from './modHeader'

const fixturesDir = join(__dirname, '../../../fixtures/items')
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.txt'))

const load = (pattern: string): string => {
  const file = fixtures.find((f) => f.includes(pattern))
  if (!file) throw new Error(`no fixture matching "${pattern}"`)
  return readFileSync(join(fixturesDir, file), 'utf8')
}

describe('parseItem on every fixture', () => {
  it.each(fixtures)('%s', (file) => {
    const item = parseItem(readFileSync(join(fixturesDir, file), 'utf8'))

    expect(item.itemClass).toBeTruthy()
    expect(item.rarity).toBeTruthy()
    expect(item.baseType).toBeTruthy()
    // No mod header may fall through unparsed.
    for (const mod of [...item.implicits, ...item.explicits, ...item.enhancements]) {
      expect(mod.generation).not.toBe('unknown')
    }
    expect(item).toMatchSnapshot()
  })
})

describe('targeted parsing', () => {
  it('rare gloves: tiers, rolls, rune mod, quality', () => {
    const item = parseItem(load('rapture-caress'))
    expect(item.name).toBe('Rapture Caress')
    expect(item.baseType).toBe('Refined Bracers')
    expect(item.itemLevel).toBe(83)
    expect(item.quality).toBe(20)
    expect(item.sockets).toBe(1)
    expect(item.runeMods).toHaveLength(1)
    expect(item.runeMods[0].template).toBe('#% increased Armour, Evasion and Energy Shield')
    expect(item.explicits).toHaveLength(6)

    const life = item.explicits.find((m) => m.name === 'Virile')
    expect(life?.generation).toBe('prefix')
    expect(life?.tier).toBe(2)
    expect(life?.lines[0].template).toBe('+# to maximum Life')
    expect(life?.lines[0].values).toEqual([{ value: 102, min: 100, max: 119 }])
  })

  it('hybrid mod keeps both stat lines under one mod', () => {
    const item = parseItem(load('phoenix-horn'))
    const hybrid = item.explicits.find((m) => m.name === 'Sacred')
    expect(hybrid?.lines).toHaveLength(2)
    expect(hybrid?.tags).toEqual(['Mana', 'Energy Shield'])
  })

  it('desecrated and crafted mod variants', () => {
    const boots = parseItem(load('rune-spur'))
    const desecrated = boots.explicits.find((m) => m.desecrated)
    expect(desecrated?.name).toBe("Hellion's")
    expect(desecrated?.generation).toBe('prefix')

    const shield = parseItem(load('eagle-span'))
    const crafted = shield.explicits.find((m) => m.crafted)
    expect(crafted?.name).toBe('Virile')
    expect(shield.note).toBe('~b/o 1 divine')
  })

  it('advanced-copy Fractured header parses as a real prefix/suffix', () => {
    // Inventory (advanced) copy qualifies a fractured mod in the header the same
    // way it does Desecrated/Crafted — it must parse as the prefix/suffix it is,
    // not fall through to generation 'unknown' (issue #53).
    const mod = parseModHeader('{ Fractured Prefix Modifier "Of the Underground" (Tier: 1) — Attribute }')
    expect(mod.generation).toBe('prefix')
    expect(mod.fractured).toBe(true)
    expect(mod.tier).toBe(1)
    expect(mod.name).toBe('Of the Underground')
  })

  it('stacked Fractured Crafted header sets both flags (issue #24)', () => {
    // A crafted mod later locked by a Fracturing Orb copies with both keywords
    // stacked; it must parse as a real suffix and carry crafted + fractured, or
    // the essence crafted-mod cap under-counts it.
    const mod = parseModHeader('{ Fractured Crafted Suffix Modifier "of Archaeology" (Tier: 1) }')
    expect(mod.generation).toBe('suffix')
    expect(mod.crafted).toBe(true)
    expect(mod.fractured).toBe(true)
    expect(mod.name).toBe('of Archaeology')
    expect(mod.tier).toBe(1)
  })

  it('Astrid boots: two crafted mods (one Fractured Crafted) and the cap rune (issue #24)', () => {
    const item = parseItem(load('skull-goad'))
    expect(item.rarity).toBe('Rare')
    // Both crafted slots are filled; the fractured-crafted one must count.
    const crafted = item.explicits.filter((m) => m.crafted)
    expect(crafted.map((m) => m.name)).toEqual(['of Archaeology', 'of the Essence'])
    expect(crafted.find((m) => m.name === 'of Archaeology')?.fractured).toBe(true)
    // Astrid's Creativity surfaces as a rune line raising the crafted-mod cap.
    expect(item.runeMods.some((l) => l.raw === 'Can have 1 additional Crafted Modifier')).toBe(true)
  })

  it('Corruption Enhancement header parses as a corrupted enhancement (issue #54)', () => {
    // A corruption-added enhancement copies as `{ Corruption Enhancement }`,
    // parallel to a normal anoint's `{ Enhancement }` — both are enhancement
    // generation; only the corruption flag distinguishes them (→ CE vs E tag).
    const mod = parseModHeader('{ Corruption Enhancement — Evasion }')
    expect(mod.generation).toBe('enhancement')
    expect(mod.corrupted).toBe(true)
    expect(mod.tags).toEqual(['Evasion'])

    const anoint = parseModHeader('{ Enhancement }')
    expect(anoint.generation).toBe('enhancement')
    expect(anoint.corrupted).toBe(false)

    const item = parseItem(load('constricting-command-b2a788b0'))
    const enh = item.enhancements.find((m) => m.corrupted)
    expect(enh?.lines[0].template).toBe('#% increased Evasion Rating')
  })

  it('unique with empty desecrated mod name and unscalable lines', () => {
    const item = parseItem(load('the-unborn-lich'))
    expect(item.rarity).toBe('Unique')
    expect(item.grantedSkills).toEqual([
      'Level 18 Feast of Flesh',
      'Level 18 His Grave Command'
    ])
    const unnamed = item.explicits.find((m) => m.desecrated && m.name === '')
    expect(unnamed?.qualityIncrease).toBe(79)
    expect(unnamed?.lines).toHaveLength(2)
    const unscalable = item.explicits.find((m) => m.generation === 'unique')
    expect(unscalable?.lines[0].unscalable).toBe(true)
  })

  it('unique helmet with four rune lines and seven unique mods', () => {
    const item = parseItem(load('the-bringer-of-rain'))
    expect(item.runeMods).toHaveLength(4)
    expect(item.explicits).toHaveLength(7)
    expect(item.sockets).toBe(4)
    expect(item.corrupted).toBe(false)
  })

  it('corrupted skill gem', () => {
    const item = parseItem(load('permafrost-bolts'))
    expect(item.rarity).toBe('Gem')
    expect(item.corrupted).toBe(true)
    expect(item.sockets).toBe(5)
    expect(item.properties.some((p) => p.raw.startsWith('Level: 26'))).toBe(true)
  })

  it('waystone tier from name, charm with comma decimal', () => {
    const waystone = parseItem(load('painful-waystone'))
    expect(waystone.waystoneTier).toBe(15)

    const charm = parseItem(load('sunny-thawing-charm'))
    expect(charm.corrupted).toBe(true)
    expect(charm.quality).toBe(9)
    expect(charm.implicits).toHaveLength(1)
    expect(charm.implicits[0].lines[0].unscalable).toBe(true)
  })

  it('decimal roll values parse correctly', () => {
    const item = parseItem(load('sanguis-heroum'))
    const charges = item.explicits.find((m) => m.lines[0]?.raw.includes('Charges per Second'))
    expect(charges?.lines[0].values).toEqual([{ value: 0.17, min: 0.15, max: 0.2 }])
  })

  it('chat-linked item: basic copy with no advanced headers', () => {
    // A chat link copies without "{ ... }" headers, tiers, or roll ranges;
    // each mod tags its origin inline instead. The mods must still parse.
    const item = parseItem(load('agony-torc'))
    expect(item.name).toBe('Agony Torc')
    expect(item.baseType).toBe('Solar Amulet')
    expect(item.itemLevel).toBe(81)
    expect(item.quality).toBe(40)

    expect(item.implicits).toHaveLength(1)
    expect(item.implicits[0].generation).toBe('implicit')
    expect(item.implicits[0].lines[0].template).toBe('+# to Spirit')

    expect(item.explicits).toHaveLength(6)
    expect(item.explicits.every((m) => m.generation === 'explicit')).toBe(true)
    // Inline origin tags are stripped from the stat and mapped onto the mod.
    const fractured = item.explicits[0]
    expect(fractured.lines[0].template).toBe('+# to Spirit')
    expect(fractured.fractured).toBe(true)
    expect(item.explicits.find((m) => m.desecrated)?.lines[0].template).toBe(
      '+#% to Cold and Chaos Resistances'
    )
    expect(item.explicits.find((m) => m.crafted)?.lines[0].template).toBe(
      '#% increased Global Armour, Evasion and Energy Shield'
    )
    // The closing "Fractured Item" line is not a mod.
    expect(item.explicits.some((m) => m.lines[0].raw.includes('Fractured'))).toBe(false)
  })

  it('normal item with implicit only', () => {
    const item = parseItem(load('exceptional-corsair-coat'))
    expect(item.rarity).toBe('Normal')
    expect(item.name).toBeNull()
    expect(item.implicits).toHaveLength(1)
    expect(item.explicits).toHaveLength(0)
  })
})
