import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseItem } from './parse'

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

  it('normal item with implicit only', () => {
    const item = parseItem(load('exceptional-corsair-coat'))
    expect(item.rarity).toBe('Normal')
    expect(item.name).toBeNull()
    expect(item.implicits).toHaveLength(1)
    expect(item.explicits).toHaveLength(0)
  })
})
