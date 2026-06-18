import type { ParsedItem } from '../parser/types'

/** Crafted-modifier usage on a Rare item, for essence-cap advice (issue #24). */
export interface CraftedSlots {
  /** Crafted modifiers already on the item (each occupies one crafted slot). */
  used: number
  /** Max crafted modifiers the item can hold. Base 1, raised by Astrid's
   *  Creativity (a socketed Soul Core). */
  cap: number
}

// Astrid's Creativity (a Soul Core) copies as a rune line reading
// "Can have N additional Crafted Modifier"; each socketed one raises the cap.
const ASTRID_RUNE = /(\d+) additional Crafted Modifier/i

/**
 * Count the crafted modifiers an item already carries and its crafted-mod cap.
 * A crafted mod (bench or essence-guaranteed) takes the single crafted slot;
 * Astrid's Creativity raises the cap. A mod that is both fractured and crafted
 * still occupies the crafted slot, so it counts (relies on `modHeader` parsing
 * the stacked `Fractured Crafted` header).
 */
export function craftedSlots(item: ParsedItem): CraftedSlots {
  const used = item.explicits.filter((m) => m.crafted).length
  let cap = 1
  for (const rune of item.runeMods) {
    const m = rune.raw.match(ASTRID_RUNE)
    if (m) cap += Number(m[1])
  }
  return { used, cap }
}

/**
 * Reason line shown when a Rare's crafted slot(s) are full (issue #24), so a
 * guaranteed-crafted-mod currency can't apply. `blocked` names that currency
 * ("Perfect & corrupted Essences", "Liquid Emotions") — both augment the single
 * crafted slot and so are gated the same way.
 */
export function craftedCapNote(crafted: CraftedSlots, blocked: string): string {
  const mods = crafted.used === 1 ? 'a crafted modifier' : `${crafted.used} crafted modifiers`
  const reason =
    crafted.cap > 1
      ? `the crafted-mod cap (${crafted.cap}, raised by Astrid's Creativity) is full`
      : 'an item holds only one crafted modifier'
  return `This item already has ${mods} — ${blocked} can't be applied (${reason}).`
}
