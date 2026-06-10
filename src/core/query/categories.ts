/**
 * Clipboard "Item Class:" -> trade2 category filter option.
 * Option ids verified against /api/trade2/data/filters (2026-06-10).
 * Classes with no trade category (e.g. Charms) search by stats alone.
 */
const CATEGORY_BY_ITEM_CLASS: Record<string, string> = {
  Helmets: 'armour.helmet',
  'Body Armours': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Shields: 'armour.shield',
  Foci: 'armour.focus',
  Bucklers: 'armour.buckler',
  Quivers: 'armour.quiver',

  Amulets: 'accessory.amulet',
  Belts: 'accessory.belt',
  Rings: 'accessory.ring',

  Claws: 'weapon.claw',
  Daggers: 'weapon.dagger',
  'One Hand Swords': 'weapon.onesword',
  'One Hand Axes': 'weapon.oneaxe',
  'One Hand Maces': 'weapon.onemace',
  Spears: 'weapon.spear',
  Flails: 'weapon.flail',
  'Two Hand Swords': 'weapon.twosword',
  'Two Hand Axes': 'weapon.twoaxe',
  'Two Hand Maces': 'weapon.twomace',
  Quarterstaves: 'weapon.warstaff',
  Bows: 'weapon.bow',
  Crossbows: 'weapon.crossbow',
  Wands: 'weapon.wand',
  Sceptres: 'weapon.sceptre',
  Staves: 'weapon.staff',
  Talismans: 'weapon.talisman',
  'Fishing Rods': 'weapon.rod',

  'Skill Gems': 'gem.activegem',
  'Support Gems': 'gem.supportgem',
  'Meta Gems': 'gem.metagem',

  Jewels: 'jewel',
  'Life Flasks': 'flask.life',
  'Mana Flasks': 'flask.mana',

  Waystones: 'map.waystone',
  'Map Fragments': 'map.fragment',
  Logbooks: 'map.logbook',
  Breachstones: 'map.breachstone',
  'Pinnacle Keys': 'map.bosskey',
  Tablet: 'map.tablet',
  Tablets: 'map.tablet',

  Relics: 'sanctum.relic',
  Omens: 'currency.omen',
  Runes: 'currency.rune',
  'Soul Cores': 'currency.soulcore',
  Idols: 'currency.idol'
}

export function categoryForItemClass(itemClass: string): string | null {
  return CATEGORY_BY_ITEM_CLASS[itemClass] ?? null
}
