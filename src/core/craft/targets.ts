/**
 * Shared target→item-class resolution for the essence-like rare-item crafting
 * currencies (essences #24, Verisium Alloys #51). Both essences.json and the
 * Alloy rows it also carries describe their guaranteed mods as a small
 * `target → mod text` table; this module maps a poe2db target keyword to the
 * clipboard "Item Class:" values and finds the mod that applies to an item.
 */

/**
 * poe2db target keyword -> clipboard "Item Class:" values (the vocabulary of
 * PreparedQuery.itemClass). Keep in sync with the "Target tokens" output of
 * gen-essences.mjs. Classes not in PoE2 yet (claws, daggers…) are omitted.
 */
const MELEE_ONE_HAND = ['One Hand Maces', 'Spears', 'Flails']
const MELEE_TWO_HAND = ['Two Hand Maces', 'Quarterstaves']
const MELEE = [...MELEE_ONE_HAND, ...MELEE_TWO_HAND]
const RANGED = ['Bows', 'Crossbows']
const CASTER = ['Wands', 'Staves', 'Sceptres']
const MARTIAL = [...MELEE, ...RANGED]
const WEAPONS = [...MARTIAL, ...CASTER]
const ARMOUR = ['Body Armours', 'Helmets', 'Gloves', 'Boots', 'Shields', 'Bucklers', 'Foci']
const JEWELLERY = ['Rings', 'Amulets']
const EQUIPMENT = [...WEAPONS, ...ARMOUR, ...JEWELLERY, 'Belts', 'Quivers']

export const CLASSES_BY_TARGET: Record<string, string[]> = {
  Equipment: EQUIPMENT,
  Any: EQUIPMENT,
  Weapons: WEAPONS,
  'Martial Weapon': MARTIAL,
  'Melee Weapon': MELEE,
  'One Handed Melee Weapon': MELEE_ONE_HAND,
  'Two Handed Melee Weapon': MELEE_TWO_HAND,
  'Caster Weapon': CASTER,
  Mace: ['One Hand Maces', 'Two Hand Maces'],
  Bow: ['Bows'],
  Crossbow: ['Crossbows'],
  Quarterstaff: ['Quarterstaves'],
  Spear: ['Spears'],
  Wand: ['Wands'],
  Staff: ['Staves'],
  Sceptre: ['Sceptres'],
  Armour: ARMOUR,
  'Body Armour': ['Body Armours'],
  Helmet: ['Helmets'],
  Gloves: ['Gloves'],
  Boots: ['Boots'],
  Shield: ['Shields', 'Bucklers'],
  Focus: ['Foci'],
  Quiver: ['Quivers'],
  Jewellery: JEWELLERY,
  Ring: ['Rings'],
  Amulet: ['Amulets'],
  Belt: ['Belts'],
  Talisman: ['Talismans']
}

/** One guaranteed-mod row of an essence/alloy: a target list and its mod. */
export interface RawCraftMod {
  targets: string[]
  text: string
  /**
   * Mod-group(s) of this guaranteed mod (joined from repoe-fork by
   * gen-essences.mjs). Two mods can't share a group, so an "augment a Rare"
   * essence/alloy is blocked when the item already has a mod in any of these —
   * the basis for the crafting-conflict gate (#72/#51). Empty when the mod has
   * no normal group (e.g. "Mark of the Abyssal Lord") or didn't match.
   */
  groups: string[]
  /** Affix slot the mod occupies; null when ambiguous/unmatched. */
  affix: 'prefix' | 'suffix' | null
}

/** A raw essence/alloy row as stored in essences.json. */
export interface RawCraftCurrency {
  id: string
  name: string
  behavior: string
  mods: RawCraftMod[]
  icon?: string
}

/** The guaranteed mod this currency gives on an item class, or null if none. */
export function modForClass(mods: RawCraftMod[], itemClass: string): RawCraftMod | null {
  for (const mod of mods) {
    for (const target of mod.targets) {
      if (CLASSES_BY_TARGET[target]?.includes(itemClass)) return mod
    }
  }
  return null
}
