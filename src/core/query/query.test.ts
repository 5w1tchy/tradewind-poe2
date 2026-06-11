import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseItem } from '../parser/parse'
import { StatsDb } from '../stats-db/statsDb'
import type { StatsPayload } from '../stats-db/types'
import { buildSearchBody } from './build'
import { prepareQuery } from './prepare'
import type { PreparedQuery } from './types'

const root = join(__dirname, '../../..')
const fixturesDir = join(root, 'fixtures/items')

let db: StatsDb

beforeAll(() => {
  const payload = JSON.parse(
    readFileSync(join(root, 'data/trade-api-cache/stats.json'), 'utf8')
  ) as StatsPayload
  db = new StatsDb(payload)
})

function prepareFixture(file: string): PreparedQuery {
  return prepareQuery(parseItem(readFileSync(join(fixturesDir, file), 'utf8')), db)
}

describe('prepareQuery', () => {
  it('rare gloves: category + checked explicits with spread mins', () => {
    const q = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')

    expect(q.categoryFilter).toEqual({ value: 'armour.gloves', label: 'Gloves', enabled: true })
    expect(q.rarityOption).toBe('nonunique')
    expect(q.name).toBeNull()
    expect(q.type).toBeNull()
    expect(q.corrupted).toEqual({ value: false, enabled: true })
    expect(q.ilvl).toMatchObject({ value: 83, enabled: false })
    expect(q.unmatched).toEqual([])

    // six explicit lines, but the two resists fold into one pseudo total
    const enabled = q.stats.filter((s) => s.enabled)
    expect(enabled).toHaveLength(5)
    const pseudo = enabled.find((s) => s.source === 'pseudo')!
    expect(pseudo.statId).toBe('pseudo.pseudo_total_elemental_resistance')
    expect(pseudo.value).toBe(88) // 45 lightning + 43 cold

    const life = q.stats.find((s) => s.label.includes('maximum Life'))!
    expect(life.enabled).toBe(true)
    expect(life.value).toBe(102)
    expect(life.min).toBe(91) // floor(102 * 0.9)
    expect(life.max).toBeNull()
    expect(life.tier).toBe(2)

    // pseudo fold rows have no single tier
    expect(pseudo.tier).toBeNull()

    // rune line present but unchecked
    const rune = q.stats.find((s) => s.source === 'rune')!
    expect(rune.enabled).toBe(false)
  })

  it('derives defence filters from item properties, normalized to 20% quality', () => {
    // 0-quality shield, flat armour mods only: 482 * 120/100 = 578
    const shield = prepareFixture('32-shields--eagle-span-f24731e2.txt')
    expect(shield.equipment).toContainEqual(
      expect.objectContaining({ key: 'ar', label: 'Armour (Q20)', value: 578, min: 520 })
    )
    expect(shield.equipment).toContainEqual(
      expect.objectContaining({ key: 'block', value: 26 })
    )

    const sceptre = prepareFixture('12-sceptres--mazarine-omen-sceptre-of-the-proficient-2381aa67.txt')
    expect(sceptre.equipment).toContainEqual(
      expect.objectContaining({ key: 'spirit', value: 100 })
    )

    // 22% quality is above 20 — value stays as shown on the card
    const body = prepareFixture('13-body-armours--exceptional-corsair-coat-2590bdef.txt')
    expect(body.equipment).toContainEqual(
      expect.objectContaining({ key: 'ev', label: 'Evasion', value: 550, min: 495 })
    )
    // "Sockets: S S S" — exact count as min, no spread
    expect(body.equipment).toContainEqual(
      expect.objectContaining({ key: 'rune_sockets', value: 3, min: 3, enabled: false })
    )
  })

  it('derives weapon DPS from damage ranges and APS, phys normalized to Q20', () => {
    const bow = prepareFixture('22-bows--infusing-obliterator-bow-of-the-skilled-b8aaca45.txt')
    // (62+115)/2 = 88.5 avg phys, 0 quality, no increased-phys mod:
    // 88.5 * 120/100 * 1.10 aps = 116.8
    expect(bow.equipment).toContainEqual(
      expect.objectContaining({ key: 'pdps', label: 'Phys DPS (Q20)', value: 117 })
    )
    expect(bow.equipment).toContainEqual(expect.objectContaining({ key: 'dps', value: 117 }))
    expect(bow.equipment.some((e) => e.key === 'edps')).toBe(false)
  })

  it('folds resists into pseudo totals (all-res counts x3), folded rows unchecked', () => {
    const q = prepareFixture('04-rings--rift-grip-7bdd59f9.txt')

    // 38 fire + 15 all-res x3 = 83 total elemental
    const ele = q.stats.find((s) => s.statId === 'pseudo.pseudo_total_elemental_resistance')!
    expect(ele.value).toBe(83)
    expect(ele.min).toBe(74)
    expect(ele.enabled).toBe(true)

    // 13 chaos from the implicit
    const chaos = q.stats.find((s) => s.statId === 'pseudo.pseudo_total_chaos_resistance')!
    expect(chaos.value).toBe(13)

    const fire = q.stats.find((s) => s.label.includes('Fire Resistance'))!
    const allRes = q.stats.find((s) => s.label.includes('all Elemental Resistances'))!
    expect(fire.enabled).toBe(false)
    expect(allRes.enabled).toBe(false)
  })

  it('enabled equipment rows land in equipment_filters', () => {
    const q = prepareFixture('32-shields--eagle-span-f24731e2.txt')
    const ar = q.equipment.find((e) => e.key === 'ar')!
    ar.enabled = true
    const body = buildSearchBody(q)
    expect(body.query.filters?.equipment_filters?.filters.ar).toEqual({ min: 520 })
  })

  it('relic mods match sanctum stat ids, not regular explicits', () => {
    const q = prepareFixture('09-relics--swift-seal-relic-of-overflowing-094e1d88.txt')

    const ms = q.stats.find((s) => s.label.includes('Movement Speed'))!
    expect(ms.statId).toBe('sanctum.stat_1416455556')
    const fountains = q.stats.find((s) => s.label.includes('Sacred Water'))!
    expect(fountains.statId).toMatch(/^sanctum\./)
  })

  it('movement speed keeps its full roll as min (bracketed stat, no spread)', () => {
    const q = prepareFixture('03-boots--rune-spur-f39b212f.txt')
    const ms = q.stats.find((s) => s.label.includes('Movement Speed'))!
    expect(ms.value).toBe(35)
    expect(ms.min).toBe(35)
  })

  it('+to Level of skills keeps its full roll as min (price cliff, no spread)', () => {
    const q = prepareFixture('05-amulets--pandemonium-beads-70198ee7.txt')
    const lvl = q.stats.find((s) => s.label.includes('to Level of all Projectile Skills'))!
    expect(lvl.value).toBe(2)
    expect(lvl.min).toBe(2)
  })

  it('rare base type is an opt-in exact filter', () => {
    const q = prepareFixture('04-rings--rift-grip-7bdd59f9.txt')
    expect(q.baseTypeFilter).toEqual({ value: 'Amethyst Ring', enabled: false })

    let body = buildSearchBody(q)
    expect(body.query.type).toBeUndefined()

    q.baseTypeFilter!.enabled = true
    body = buildSearchBody(q)
    expect(body.query.type).toBe('Amethyst Ring')
  })

  it('essence-crafted mod searches the explicit stat id', () => {
    // Eagle Span's "+116 to maximum Life" is a Crafted (essence) prefix.
    const q = prepareFixture('32-shields--eagle-span-f24731e2.txt')
    const life = q.stats.find((s) => s.label.includes('maximum Life'))!
    expect(life.statId).toBe('explicit.stat_3299347043')
  })

  it('desecrated mod searches the explicit stat id (origin must not narrow pricing)', () => {
    const q = prepareFixture('04-rings--rift-grip-7bdd59f9.txt')

    const allRes = q.stats.find((s) => s.label.includes('all Elemental Resistances'))!
    expect(allRes.statId).toBe('explicit.stat_2901986750')
    // folded into the pseudo total, so unchecked by default
    expect(allRes.enabled).toBe(false)
  })

  it('unique: exact name+type, mods unchecked', () => {
    const q = prepareFixture('02-belts--mageblood-e7e9e4df.txt')

    expect(q.name).toBe('Mageblood')
    expect(q.type).toBe('Utility Belt')
    expect(q.rarityOption).toBe('unique')
    expect(q.categoryFilter).toBeNull()
    expect(q.stats.every((s) => !s.enabled)).toBe(true)
  })

  it('waystone: exact tier pre-checked, explicits checked', () => {
    const q = prepareFixture('14-waystones--painful-waystone-tier-15-of-erosion-d59c5af4.txt')

    expect(q.categoryFilter).toMatchObject({ value: 'map.waystone', enabled: true })
    expect(q.mapTier).toMatchObject({ min: 15, max: 15, enabled: true })
    expect(q.stats.some((s) => s.enabled)).toBe(true)
  })

  it('skill gem: exact type + level, corruption mirrored', () => {
    const q = prepareFixture('17-skill-gems--permafrost-bolts-0f10022c.txt')

    expect(q.type).toBe('Permafrost Bolts')
    expect(q.gemLevel).toMatchObject({ min: 26, enabled: true })
    expect(q.quality).toMatchObject({ value: 20, enabled: false })
    expect(q.corrupted).toEqual({ value: true, enabled: true })
    expect(q.stats).toEqual([])
  })

  it('uncut gem: type without the level suffix, exact gem level', () => {
    const q = prepareFixture('23-uncut-skill-gems--uncut-skill-gem-level-19-ecd62ed4.txt')

    expect(q.type).toBe('Uncut Skill Gem')
    expect(q.gemLevel).toMatchObject({ min: 19, max: 19, enabled: true })
  })

  it('currency with a bulk-exchange id prefers the exchange', () => {
    const item = parseItem(
      readFileSync(
        join(fixturesDir, '10-stackable-currency--greater-orb-of-augmentation-a4de8d25.txt'),
        'utf8'
      )
    )
    const q = prepareQuery(item, db, {
      exchangeIds: { 'Greater Orb of Augmentation': 'greater-orb-of-augmentation' }
    })

    expect(q.exchangeId).toBe('greater-orb-of-augmentation')
    expect(q.type).toBeNull()
  })

  it('stackable currency: exact type only', () => {
    const q = prepareFixture('10-stackable-currency--greater-orb-of-augmentation-a4de8d25.txt')

    expect(q.type).toBe('Greater Orb of Augmentation')
    expect(q.stats).toEqual([])
    expect(q.corrupted).toBeNull()
  })

  it('magic charm (no trade category): stats-only search', () => {
    const q = prepareFixture('20-charms--sunny-thawing-charm-of-the-copious-58a4ca81.txt')

    expect(q.categoryFilter).toBeNull()
    expect(q.rarityOption).toBe('nonunique')
    expect(q.stats.filter((s) => s.enabled).length).toBeGreaterThan(0)
  })

  it('prepares every fixture without throwing', () => {
    for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.txt'))) {
      const q = prepareFixture(file)
      expect(q.displayName.length).toBeGreaterThan(0)
    }
  })
})

describe('buildSearchBody', () => {
  it('rare gloves body has only enabled filters', () => {
    const q = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    const body = buildSearchBody(q)

    expect(body.sort).toEqual({ price: 'asc' })
    expect(body.query.status).toEqual({ option: 'securable' }) // instant buyout default
    expect(body.query.name).toBeUndefined()
    expect(body.query.filters?.type_filters?.filters).toEqual({
      category: { option: 'armour.gloves' },
      rarity: { option: 'nonunique' }
    })
    expect(body.query.filters?.misc_filters?.filters).toEqual({
      corrupted: { option: 'false' }
    })

    const stats = body.query.stats[0]
    expect(stats.type).toBe('and')
    expect(stats.filters).toHaveLength(5) // 4 explicits + folded resist pseudo
    for (const f of stats.filters) {
      expect(f.id).toMatch(/^[a-z]+\.(stat_\d+|pseudo_\w+)$/)
      expect(f.value?.min).toBeTypeOf('number')
    }
  })

  it('unique body searches by name+type with empty stat group', () => {
    const q = prepareFixture('02-belts--mageblood-e7e9e4df.txt')
    const body = buildSearchBody(q)

    expect(body.query.name).toBe('Mageblood')
    expect(body.query.type).toBe('Utility Belt')
    expect(body.query.stats[0].filters).toEqual([])
  })

  it('toggling a range on includes it; off drops it', () => {
    const q = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    q.ilvl!.enabled = true
    const body = buildSearchBody(q)
    expect(body.query.filters?.type_filters?.filters.ilvl).toEqual({ min: 83 })
  })

  it('unscalable lines become value-less stat filters when enabled', () => {
    const q = prepareFixture('14-waystones--painful-waystone-tier-15-of-erosion-d59c5af4.txt')
    const unscalable = q.stats.find((s) => s.value === null)
    if (unscalable) {
      unscalable.enabled = true
      const body = buildSearchBody(q)
      const spec = body.query.stats[0].filters.find((f) => f.id === unscalable.statId)!
      expect(spec.value).toBeUndefined()
    }
  })
})
