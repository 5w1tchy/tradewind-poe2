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

describe('chat-link affix/tier reconstruction', () => {
  // Badge a reconstructed stat the way the popup does: P#/S# (blank tier omitted).
  const badge = (q: PreparedQuery, match: string): string | undefined => {
    const s = q.stats.find((st) => st.label.includes(match))
    if (!s || !s.affix) return undefined
    return `${s.affix === 'prefix' ? 'P' : 'S'}${s.tier ?? ''}`
  }
  const chatItem = (rarity: string, name: string, base: string, mods: string[]): PreparedQuery =>
    prepareQuery(
      parseItem(
        `Item Class: Rings\nRarity: ${rarity}\n${name}\n${base}\n--------\nItem Level: 80\n--------\n${mods.join('\n')}`
      ),
      db
    )

  it('reconstructs unambiguous prefixes and suffixes with tiers', () => {
    const q = chatItem('Rare', 'Foo', 'Sapphire Ring', [
      '+90 to maximum Life',
      '15% increased Cast Speed'
    ])
    expect(badge(q, 'maximum Life')).toBe('P2')
    expect(badge(q, 'Cast Speed')).toBe('S4')
  })

  it('leaves a prefix/suffix-ambiguous roll unbadged when slots are open', () => {
    const q = chatItem('Rare', 'Foo', 'Sapphire Ring', [
      '+90 to maximum Life',
      '9% increased Rarity of Items found',
      '+30% to Fire Resistance'
    ])
    // 1 prefix + 1 suffix + the ambiguous one — could be either, so no badge.
    expect(badge(q, 'Rarity of Items')).toBeUndefined()
  })

  it('forces the ambiguous roll to the open slot once one affix fills (rare 3+3)', () => {
    const q = chatItem('Rare', 'Foo', 'Sapphire Ring', [
      '+90 to maximum Life',
      '+90 to maximum Mana',
      'Adds 10 to 20 Fire damage to Attacks',
      '9% increased Rarity of Items found'
    ])
    // 3 prefixes fill the prefix slots -> rarity must be a suffix.
    expect(badge(q, 'Rarity of Items')).toBe('S3')
  })

  it('forces the ambiguous roll on a magic item (1 prefix fills the slot)', () => {
    const q = chatItem('Magic', 'Foo of Bar', 'Sapphire Ring', [
      '+90 to maximum Life',
      '9% increased Rarity of Items found'
    ])
    expect(badge(q, 'Rarity of Items')).toBe('S3')
  })

  it('badges a fractured + desecrated mod of the same stat (issue #53)', () => {
    // A fractured "increased Physical Damage" and a desecrated one legitimately
    // co-exist on one item (desecrated is a separate pool), so the same-group
    // guard must not drop the pair — both badge as the prefixes they are.
    const q = prepareQuery(
      parseItem(
        [
          'Item Class: Crossbows',
          'Rarity: Rare',
          'Foo',
          'Desolate Crossbow',
          '--------',
          'Item Level: 82',
          '--------',
          '178% increased Physical Damage (fractured)',
          '74% increased Physical Damage (desecrated)',
          '--------',
          'Fractured Item'
        ].join('\n')
      ),
      db
    )
    const phys = q.stats.filter((s) => /increased Physical Damage$/.test(s.label) && !s.summed)
    expect(phys).toHaveLength(2)
    expect(phys.every((s) => s.affix === 'prefix')).toBe(true)
  })

  it('advanced-copy fractured mod badges from its header, not as a pseudo (issue #53)', () => {
    // Inventory copy qualifies the fractured mod in its "{ ... }" header; the
    // affix/tier come straight off it (no reconstruction) and it must group with
    // the real prefixes/suffixes, not fall into the affix-less pseudo block.
    const q = prepareQuery(
      parseItem(
        [
          'Item Class: Amulets',
          'Rarity: Rare',
          'Foo',
          'Solar Amulet',
          '--------',
          'Item Level: 81',
          '--------',
          '{ Fractured Prefix Modifier "Of the Underground" (Tier: 1) — Attribute }',
          '+50 to Spirit',
          '--------',
          'Fractured Item'
        ].join('\n')
      ),
      db
    )
    const spirit = q.stats.find((s) => s.label.includes('Spirit'))
    expect(spirit?.affix).toBe('prefix')
    expect(spirit?.tier).toBe(1)
  })
})

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

    // Exact base leads by default (issue #23); category is the opt-out scope.
    expect(q.categoryFilter).toEqual({ value: 'armour.gloves', label: 'Gloves', enabled: false })
    expect(q.baseTypeFilter).toEqual({ value: 'Refined Bracers', enabled: true })
    expect(q.rarityOption).toBe('rare')
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

  it('captures tier floor, smart default, and the smart quick-mode (issue #16)', () => {
    const item = [
      'Item Class: Body Armours',
      'Rarity: Rare',
      'Test Plate',
      'Plate',
      '--------',
      'Item Level: 82',
      '--------',
      '{ Prefix Modifier "Hale" (Tier: 3) — Life }',
      '+80(70-90) to maximum Life'
    ].join('\n')
    const q = prepareQuery(parseItem(item), db)
    const life = q.stats.find((s) => s.label.includes('maximum Life'))!
    expect(life.value).toBe(80)
    expect(life.tierMin).toBe(70) // tier floor from the (70-90) range
    expect(life.smartMin).toBe(72) // floor(80 * 0.9)
    expect(life.min).toBe(72) // pre-fills at the smart default
    expect(life.quickMode).toBe('smart')
  })

  it('flat damage with a fixed low + ranged high still gets a tier floor (issue #16)', () => {
    // "Adds 1 to 22(16-22)": the 1 is fixed (no roll), the high rolled 22 of 16-22.
    // Trade indexes added damage by the average, so the tier floor is the worst
    // average: floor((1 fixed + 16 high-floor) / 2) = 8.
    const item = [
      'Item Class: Gloves',
      'Rarity: Rare',
      'Beast Vise',
      'Test Gloves',
      '--------',
      'Item Level: 80',
      '--------',
      '{ Prefix Modifier "Test" (Tier: 7) — Lightning, Attack, Damage }',
      'Adds 1 to 22(16-22) Lightning damage to Attacks'
    ].join('\n')
    const q = prepareQuery(parseItem(item), db)
    const flat = q.stats.find((s) => s.label.includes('Lightning damage to Attacks'))!
    expect(flat.value).toBe(11.5) // (1 + 22) / 2
    expect(flat.tierMin).toBe(8) // floor((1 + 16) / 2)
    expect(flat.smartMin).toBe(10) // floor(11.5 * 0.9)
  })

  it('cliff stats default to the roll quick-mode; no range means no tier floor', () => {
    const q = prepareFixture('03-boots--rune-spur-f39b212f.txt')
    const ms = q.stats.find((s) => s.label.includes('Movement Speed'))!
    // No spread, so the pre-filled min is the full roll and the cycle starts on roll.
    expect(ms.quickMode).toBe('roll')
    expect(ms.smartMin).toBe(35)
  })

  it('summed totals and folded pseudos expose no single tier floor', () => {
    const q = prepareFixture('37-helmets--blight-crown-screenshot.txt')
    const total = q.stats.find((s) => s.summed)!
    expect(total.tierMin).toBeNull()
    expect(total.quickMode).toBe('smart')

    const pseudo = prepareFixture('01-gloves--rapture-caress-8cdf3ae5.txt').stats.find(
      (s) => s.source === 'pseudo'
    )!
    expect(pseudo.tierMin).toBeNull()
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

  it('derives weapon aps/crit, keeping fractional smart mins', () => {
    const bow = prepareFixture('22-bows--infusing-obliterator-bow-of-the-skilled-b8aaca45.txt')
    // "Attacks per Second: 1.10" -> 1.1, smart min floor(0.99 * 1.10... ) = 0.99
    expect(bow.equipment).toContainEqual(
      expect.objectContaining({ key: 'aps', value: 1.1, smartMin: 0.99, quickMode: 'smart' })
    )
    // "Critical Hit Chance: 5.00%" -> 5, smart min floor(4.5) = 4.5
    expect(bow.equipment).toContainEqual(
      expect.objectContaining({ key: 'crit', value: 5, smartMin: 4.5 })
    )
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

  it('keeps each mod of a summed stat clickable, with one searchable total', () => {
    // Rarity rolls as prefix AND suffix, ES as two prefixes — the trade site
    // indexes each stat once (summed). Each mod stays as its own searchable row
    // (off by default), and a "(total)" row sums them and is on by default.
    const q = prepareFixture('37-helmets--blight-crown-screenshot.txt')

    const rarity = q.stats.filter((s) => s.label.includes('Rarity of Items found'))
    const rarityTotal = rarity.find((s) => s.summed)!
    expect(rarityTotal).toMatchObject({
      label: '36% increased Rarity of Items found (total)',
      value: 36,
      min: 32, // floor(36 * 0.9)
      affix: null,
      tier: null,
      enabled: true
    })
    // The two individual mods stay clickable (affix-tagged) but off by default.
    const rarityMods = rarity.filter((s) => !s.summed)
    expect(rarityMods).toHaveLength(2)
    expect(rarityMods.every((s) => s.affix !== null && !s.enabled)).toBe(true)

    const es = q.stats.filter(
      (s) => s.label.includes('increased Energy Shield') && s.source === 'explicit'
    )
    expect(es.find((s) => s.summed)).toMatchObject({
      label: '130% increased Energy Shield (total)',
      value: 130,
      min: 117,
      affix: null,
      tier: null
    })
    expect(es.filter((s) => !s.summed)).toHaveLength(2)

    // The search body carries no duplicate stat ids by default...
    const ids = buildSearchBody(q)
      .query.stats.flatMap((g) => g.filters)
      .map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)

    // ...and stays deduped (tightest min wins) if a mod and its total are both on.
    const mod = rarityMods[0]
    mod.enabled = true
    mod.min = 10
    const merged = buildSearchBody(q)
      .query.stats.flatMap((g) => g.filters)
      .filter((f) => f.id === rarityTotal.statId)
    expect(merged).toHaveLength(1)
    expect(merged[0].value).toMatchObject({ min: 32 }) // max(10, 32)
  })

  it('groups a hybrid mod (Energy Shield + Mana) into one node', () => {
    // The "Sacred" prefix grants two stats under one modifier — they share a
    // group id (so the UI shows one node) and one enabled state. (The helmet
    // also has a separate "Fearless" ES prefix, which must NOT join the group.)
    const q = prepareFixture('11-helmets--phoenix-horn-9c69bdfb.txt')

    const mana = q.stats.find((s) => s.label.includes('to maximum Mana'))!
    expect(mana.group).toBeDefined()
    expect(mana.affix).toBe('prefix')

    // The Sacred prefix's ES line shares mana's group, and the group is just
    // those two hybrid lines.
    const groupLines = q.stats.filter((s) => s.group === mana.group)
    expect(groupLines).toHaveLength(2)
    expect(groupLines.some((s) => s.label.includes('Energy Shield'))).toBe(true)
    // The in-place hybrid node is off by default (its stats default on in pseudo).
    expect(groupLines.every((s) => !s.enabled)).toBe(true)

    // Mana isn't summed elsewhere, so it's surfaced as a standalone pseudo row
    // (affix-less, no group), and is the default-on search target.
    const manaSingle = q.stats.find(
      (s) => s.label.includes('to maximum Mana') && s.affix === null && s.group === undefined
    )!
    expect(manaSingle).toBeDefined()
    expect(manaSingle.enabled).toBe(true)
    // ES already has a summed "(total)", so it is NOT duplicated into pseudo.
    const esPseudo = q.stats.filter(
      (s) => s.label.includes('Energy Shield') && s.affix === null && !s.summed
    )
    expect(esPseudo).toHaveLength(0)
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

  it('magic item: base recovered from the items DB, on by default', () => {
    const item = parseItem(
      readFileSync(join(fixturesDir, '20-charms--sunny-thawing-charm-of-the-copious-58a4ca81.txt'), 'utf8')
    )
    const q = prepareQuery(item, db, { baseTypes: ['Thawing Charm', 'Charm'] })
    expect(q.baseTypeFilter).toEqual({ value: 'Thawing Charm', enabled: true })
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

  it('rare base type is on by default, see-saws with category', () => {
    const q = prepareFixture('04-rings--rift-grip-7bdd59f9.txt')
    expect(q.baseTypeFilter).toEqual({ value: 'Amethyst Ring', enabled: true })
    expect(q.categoryFilter?.enabled).toBe(false)

    let body = buildSearchBody(q)
    expect(body.query.type).toBe('Amethyst Ring')

    // Opt back out to the whole category.
    q.baseTypeFilter!.enabled = false
    if (q.categoryFilter) q.categoryFilter.enabled = true
    body = buildSearchBody(q)
    expect(body.query.type).toBeUndefined()
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
    expect(q.rarityOption).toBe('magic')
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
    // Base leads by default, so the search pins the exact base and drops the
    // (now unchecked) category from type_filters.
    expect(body.query.type).toBe('Refined Bracers')
    expect(body.query.filters?.type_filters?.filters).toEqual({
      rarity: { option: 'rare' }
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
