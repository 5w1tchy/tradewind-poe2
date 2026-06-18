/**
 * Which Verisium (Runic) Alloys can be used on a given item, and what guaranteed
 * mod each would stamp there (issue #51). Alloys are the flat, Rare-only sibling
 * of essences: "Removes a random modifier and augments a Rare item with a new
 * guaranteed modifier" — mechanically the corrupted-essence `rareOnly` path, but
 * with no tier ladder and no Magic→Rare upgrade. The guaranteed mod depends on
 * the item class.
 *
 * Data comes from essences.json (the poe2db page gen-essences.mjs scrapes lists
 * the Alloys alongside essences); shared target/group plumbing lives in
 * targets.ts and conflict.ts. Re-run scripts/gen-essences.mjs after game patches.
 */
import data from './essences.json'
import { craftedCapNote, type CraftedSlots } from './craftedSlots'
import { conflictingMod, type ItemMod } from './conflict'
import { modForClass, type RawCraftCurrency } from './targets'

export interface AlloyForItem {
  /** Base-item metadata id, e.g. "CurrencyVerisiumAlloy10". */
  id: string
  name: string
  /** The guaranteed mod this alloy gives on the asked-about item class. */
  modText: string
  /** Affix slot the guaranteed mod occupies (for the P/S badge), or null. */
  affix: 'prefix' | 'suffix' | null
  /**
   * Display text of the existing item mod that blocks this alloy by sharing the
   * guaranteed mod's group (issue #51), or null when nothing conflicts. An alloy
   * removes a *random* modifier, so the game can't promise it clears a colliding
   * mod and refuses the craft when the item already holds that group (e.g.
   * Celestial Alloy on a wand that already has a +max Mana mod). The alloy stays
   * listed (not hidden) so the UI can grey it with a reason.
   */
  blockedBy: string | null
  /** Bundled art filename (renderer asset under assets/essences/), if any. */
  icon: string | null
}

export interface AlloyAdvice {
  /** Alloys usable on this item, alphabetical by name. */
  applicable: AlloyForItem[]
  /**
   * Context for the header line: how the listed alloys apply, or why the list is
   * empty. Null when the class has no alloys at all.
   */
  note: string | null
}

// The poe2db essence page also lists the 13 Verisium Alloys; essences.ts keeps
// only the "Essence" rows, this module keeps only the "Alloy" rows.
const ALLOYS = (data.essences as RawCraftCurrency[]).filter((e) => e.name.includes('Alloy'))

export function alloysForItem(
  itemClass: string,
  rarity: string,
  crafted?: CraftedSlots,
  /** The item's existing explicit mods + groups, for the group-conflict gate
   *  (#51). Omitted (or empty) disables the gate — every alloy lists unblocked. */
  existing?: ItemMod[]
): AlloyAdvice {
  const onClass = ALLOYS.flatMap((a) => {
    const mod = modForClass(a.mods, itemClass)
    return mod === null ? [] : [{ alloy: a, mod }]
  })

  if (onClass.length === 0) {
    return { applicable: [], note: null }
  }

  // Alloys only work on Rare equipment — no tier ladder, no Magic→Rare upgrade.
  if (rarity !== 'Rare') {
    return { applicable: [], note: 'Runic Alloys can only be used on Rare items' }
  }

  // An alloy augments the single crafted slot with a guaranteed mod; if that
  // slot is full the game blocks it (issue #24, same as corrupted essences).
  if (crafted && crafted.used >= crafted.cap) {
    return { applicable: [], note: craftedCapNote(crafted, 'Runic Alloys') }
  }

  const applicable = onClass
    .map(({ alloy, mod }) => ({
      id: alloy.id,
      name: alloy.name,
      modText: mod.text,
      affix: mod.affix,
      // Refused when an existing mod already holds the guaranteed mod's group.
      blockedBy: existing ? (conflictingMod(mod.groups, existing)?.label ?? null) : null,
      icon: alloy.icon ?? null
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    applicable,
    note: 'Rare item — an Alloy replaces a random modifier with the listed guaranteed one'
  }
}
