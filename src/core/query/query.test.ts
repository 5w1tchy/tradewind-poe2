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

    expect(q.category).toBe('armour.gloves')
    expect(q.rarityOption).toBe('nonunique')
    expect(q.name).toBeNull()
    expect(q.type).toBeNull()
    expect(q.corrupted).toEqual({ value: false, enabled: true })
    expect(q.ilvl).toMatchObject({ value: 83, enabled: false })
    expect(q.unmatched).toEqual([])

    const enabled = q.stats.filter((s) => s.enabled)
    expect(enabled).toHaveLength(6) // six explicit mod lines

    const life = q.stats.find((s) => s.label.includes('maximum Life'))!
    expect(life.enabled).toBe(true)
    expect(life.value).toBe(102)
    expect(life.min).toBe(91) // floor(102 * 0.9)
    expect(life.max).toBeNull()

    // rune line present but unchecked
    const rune = q.stats.find((s) => s.source === 'rune')!
    expect(rune.enabled).toBe(false)
  })

  it('unique: exact name+type, mods unchecked', () => {
    const q = prepareFixture('02-belts--mageblood-e7e9e4df.txt')

    expect(q.name).toBe('Mageblood')
    expect(q.type).toBe('Utility Belt')
    expect(q.rarityOption).toBe('unique')
    expect(q.category).toBeNull()
    expect(q.stats.every((s) => !s.enabled)).toBe(true)
  })

  it('waystone: exact tier pre-checked, explicits checked', () => {
    const q = prepareFixture('14-waystones--painful-waystone-tier-15-of-erosion-d59c5af4.txt')

    expect(q.category).toBe('map.waystone')
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

  it('stackable currency: exact type only', () => {
    const q = prepareFixture('10-stackable-currency--greater-orb-of-augmentation-a4de8d25.txt')

    expect(q.type).toBe('Greater Orb of Augmentation')
    expect(q.stats).toEqual([])
    expect(q.corrupted).toBeNull()
  })

  it('magic charm (no trade category): stats-only search', () => {
    const q = prepareFixture('20-charms--sunny-thawing-charm-of-the-copious-58a4ca81.txt')

    expect(q.category).toBeNull()
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
    expect(body.query.status).toEqual({ option: 'online' })
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
    expect(stats.filters).toHaveLength(6)
    for (const f of stats.filters) {
      expect(f.id).toMatch(/^[a-z]+\.stat_\d+$/)
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
