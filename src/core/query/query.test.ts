import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseItem } from '../parser/parse'
import { StatsDb } from '../stats-db/statsDb'
import type { StatsPayload } from '../stats-db/types'
import { extractBaseType } from './baseType'
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

describe('extractBaseType', () => {
  const bases = ['Stalking Spear', 'Spear', 'Thawing Charm', 'Spearfield']

  it('prefers the longest whole-word match', () => {
    expect(extractBaseType('Exceptional Stalking Spear', bases)).toBe('Stalking Spear')
    expect(extractBaseType('Sunny Thawing Charm of the Copious', bases)).toBe('Thawing Charm')
  })

  it('matches whole words only, including exact names', () => {
    expect(extractBaseType('Spearfield', bases)).toBe('Spearfield')
    expect(extractBaseType('Whisperfield', bases)).toBeNull()
  })

  it('null when nothing matches', () => {
    expect(extractBaseType('Totally Unknown Thing', bases)).toBeNull()
    expect(extractBaseType('Stalking Spear', [])).toBeNull()
  })
})

describe('prepareQuery', () => {
  it('rare gloves: category + checked explicits with spread mins', () => {
    const q = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')

    expect(q.categoryFilter).toEqual({ value: 'armour.gloves', label: 'Gloves', enabled: true })
    expect(q.rarityOption).toBe('nonunique')
    expect(q.name).toBeNull()
    expect(q.type).toBeNull()
    // Equipment exposes the full flag set, all defaulting to "any".
    expect(q.flags.map((f) => f.key)).toEqual([
      'corrupted',
      'mirrored',
      'sanctified',
      'crafted',
      'fractured_item',
      'desecrated',
      'identified'
    ])
    expect(q.flags.every((f) => f.state === 'any')).toBe(true)
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

  it('ignores fixed literals in stat text when computing the roll min', () => {
    // "per 100 maximum Mana" carries a literal 100 the parser also templates;
    // the min must come from the roll (4), not the average of 4 and 100.
    const item = [
      'Item Class: Staves',
      'Rarity: Rare',
      'Phoenix Call',
      'Mage Staff',
      '--------',
      'Item Level: 82',
      '--------',
      '{ Prefix Modifier "Test" (Tier: 1) — Mana }',
      '4(4-5)% increased Spell Damage per 100 maximum Mana'
    ].join('\n')
    const q = prepareQuery(parseItem(item), db)
    const mana = q.stats.find((s) => s.label.includes('per 100 maximum Mana'))!
    expect(mana.value).toBe(4)
    expect(mana.min).toBe(3) // floor(4 * 0.9), not floor(52 * 0.9) = 46
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

  it('folds hybrid elemental+chaos mods into both pseudo totals', () => {
    // Pandemonium Beads: +13% all-res and +16% "Fire and Chaos Resistances".
    const q = prepareFixture('05-amulets--pandemonium-beads-70198ee7.txt')

    // 13 all-res x3 + 16 fire (from the hybrid) = 55 total elemental
    const ele = q.stats.find((s) => s.statId === 'pseudo.pseudo_total_elemental_resistance')!
    expect(ele.value).toBe(55)

    // 16 chaos (from the hybrid) feeds the chaos total too
    const chaos = q.stats.find((s) => s.statId === 'pseudo.pseudo_total_chaos_resistance')!
    expect(chaos.value).toBe(16)

    // the hybrid row itself is folded away (unchecked)
    const hybrid = q.stats.find((s) => s.label.includes('Fire and Chaos Resistances'))!
    expect(hybrid.enabled).toBe(false)
  })

  it('accumulates a stat repeated across mods into one summed filter', () => {
    // Rarity rolls as prefix AND suffix, ES as two prefixes — the trade site
    // indexes each stat once (summed), so the query must carry one filter.
    const q = prepareFixture('37-helmets--blight-crown-screenshot.txt')

    const rarity = q.stats.filter((s) => s.label.includes('Rarity of Items found'))
    expect(rarity).toHaveLength(1)
    expect(rarity[0]).toMatchObject({
      label: '36% increased Rarity of Items found (total)',
      value: 36,
      min: 32, // floor(36 * 0.9)
      tier: null,
      enabled: true
    })

    const es = q.stats.filter(
      (s) => s.label.includes('increased Energy Shield') && s.source === 'explicit'
    )
    expect(es).toHaveLength(1)
    expect(es[0]).toMatchObject({
      label: '130% increased Energy Shield (total)',
      value: 130,
      min: 117,
      tier: null
    })

    // ...and the search body carries no duplicate stat ids.
    const ids = buildSearchBody(q)
      .query.stats.flatMap((g) => g.filters)
      .map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
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

  it('charm slots keep their full roll as min (price cliff, no spread)', () => {
    const q = prepareFixture('02-belts--mageblood-e7e9e4df.txt')
    const charm = q.stats.find((s) => s.label.includes('Charm Slot'))!
    expect(charm.value).toBe(3)
    expect(charm.min).toBe(3)
  })

  it('white item with display prefix: base extracted, on by default, see-saws with category', () => {
    const text = [
      'Item Class: Spears',
      'Rarity: Normal',
      'Exceptional Stalking Spear',
      '--------',
      'Item Level: 83'
    ].join('\n')
    const q = prepareQuery(parseItem(text), db, { baseTypes: ['Stalking Spear', 'Spear'] })
    expect(q.baseTypeFilter).toEqual({ value: 'Stalking Spear', enabled: true })
    expect(q.categoryFilter?.enabled).toBe(false)
    expect(q.type).toBeNull()
    expect(buildSearchBody(q).query.type).toBe('Stalking Spear')
  })

  it('magic item: base recovered from the items DB as an opt-in filter', () => {
    const item = parseItem(
      readFileSync(join(fixturesDir, '20-charms--sunny-thawing-charm-of-the-copious-58a4ca81.txt'), 'utf8')
    )
    const q = prepareQuery(item, db, { baseTypes: ['Thawing Charm', 'Charm'] })
    expect(q.baseTypeFilter).toEqual({ value: 'Thawing Charm', enabled: false })
  })

  it('weapon mods match (Local) stat ids; armour attack speed stays global', () => {
    const spear = [
      'Item Class: Spears',
      'Rarity: Magic',
      'Focused Seaglass Spear of the Mongoose',
      '--------',
      'Item Level: 79',
      '--------',
      '{ Prefix Modifier "Focused" (Tier: 7) — Attack }',
      '+66(61-84) to Accuracy Rating'
    ].join('\n')
    const q = prepareQuery(parseItem(spear), db)
    const accuracy = q.stats.find((s) => s.label.includes('Accuracy'))!
    expect(accuracy.statId).toBe('explicit.stat_691932474') // (Local)

    const gloves = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    const speed = gloves.stats.find((s) => s.label.includes('increased Attack Speed'))!
    expect(speed.statId).toBe('explicit.stat_681332047') // global
  })

  it('unidentified unique: decorated name line resolves to the real base', () => {
    const text = [
      'Item Class: Helmets',
      'Rarity: Unique',
      'Exceptional Fierce Greathelm',
      '--------',
      'Quality: +21% (augmented)',
      'Armour: 315 (augmented)',
      '--------',
      'Item Level: 82',
      '--------',
      'Unidentified'
    ].join('\n')
    const q = prepareQuery(parseItem(text), db, { baseTypes: ['Fierce Greathelm'] })
    expect(q.name).toBeNull()
    expect(q.type).toBe('Fierce Greathelm')
    expect(q.rarityOption).toBe('unique')
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
    expect(q.flags).toEqual([{ key: 'corrupted', label: 'Corrupted', state: 'yes' }])
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
    expect(q.flags).toEqual([])
  })

  it('unique: corrupted is the only flag offered', () => {
    const q = prepareFixture('02-belts--mageblood-e7e9e4df.txt')
    expect(q.flags).toEqual([{ key: 'corrupted', label: 'Corrupted', state: 'any' }])
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
    // All flags default to "any" — no misc_filters emitted.
    expect(body.query.filters?.misc_filters).toBeUndefined()

    const stats = body.query.stats[0]
    expect(stats.type).toBe('and')
    expect(stats.filters).toHaveLength(5) // 4 explicits + folded resist pseudo
    for (const f of stats.filters) {
      expect(f.id).toMatch(/^[a-z]+\.(stat_\d+|pseudo_\w+)$/)
      expect(f.value?.min).toBeTypeOf('number')
    }
  })

  it('flags emit into misc_filters only when not "any"', () => {
    const q = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    q.flags.find((f) => f.key === 'corrupted')!.state = 'no'
    q.flags.find((f) => f.key === 'mirrored')!.state = 'yes'
    const body = buildSearchBody(q)

    expect(body.query.filters?.misc_filters?.filters).toEqual({
      corrupted: { option: 'false' },
      mirrored: { option: 'true' }
    })
  })

  it('buyout price emits trade_filters; default emits nothing', () => {
    const base = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    expect(buildSearchBody(base).query.filters?.trade_filters).toBeUndefined()

    const priced = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    priced.buyout = { min: null, max: 5, option: 'divine' }
    expect(buildSearchBody(priced).query.filters?.trade_filters?.filters).toEqual({
      price: { max: 5, option: 'divine' }
    })

    // A currency choice alone (no bounds) still filters by unit.
    const unitOnly = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt')
    unitOnly.buyout = { min: null, max: null, option: 'chaos' }
    expect(buildSearchBody(unitOnly).query.filters?.trade_filters?.filters).toEqual({
      price: { option: 'chaos' }
    })
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
