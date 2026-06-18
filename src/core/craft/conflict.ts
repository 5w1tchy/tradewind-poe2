/**
 * Mod-group conflict gate for "augment a Rare" crafting (issues #72 / #51).
 *
 * Essences and Verisium Alloys with the "Removes a random modifier and augments
 * a Rare item…" behavior stamp a *guaranteed* mod after removing a random one.
 * Two mods can never share a mod `group`, and because the removal is random the
 * game can't promise it clears a colliding mod — so it blocks the craft outright
 * when the item already carries any mod in the guaranteed mod's group. This
 * module is the shared check; essences.ts (and a future alloys.ts for #51)
 * consume it. The guaranteed mod's `groups` are joined into essences.json by
 * scripts/gen-essences.mjs; the item's groups come from the mod pool below.
 */
import type { ParsedItem } from '../parser/types'
import { groupsForLine } from '../mod-pool/modPool'

/** An existing explicit mod of an item paired with its mod-group(s). */
export interface ItemMod {
  /** The mod's displayed line(s), shown in the "blocked by …" reason. */
  label: string
  /** repoe mod-group(s) the mod belongs to (best-effort, from the mod pool).
   *  Empty when the group can't be resolved — such a mod blocks nothing. */
  groups: string[]
}

/**
 * The item's explicit mods paired with their groups, for the conflict gate.
 * Only explicit prefix/suffix mods can collide with a guaranteed augment, so
 * implicits, runes and enchants are skipped. A mod whose group can't be resolved
 * (text absent from the pool — e.g. a unique-only or freshly added stat) carries
 * empty `groups` and so never blocks an essence.
 */
export function itemMods(item: ParsedItem, baseType: string): ItemMod[] {
  return item.explicits.map((mod) => {
    // An advanced copy tags each mod prefix/suffix; pass it through so a stat
    // that rolls as both under different groups (e.g. Rarity of Items found)
    // resolves to the right family. A basic chat-link copy has no affix
    // ('explicit'), so groups stay un-narrowed — the conservative default.
    const affix = mod.generation === 'prefix' || mod.generation === 'suffix' ? mod.generation : null
    return {
      label: mod.lines.map((l) => l.raw).join(', '),
      groups: [...new Set(mod.lines.flatMap((l) => groupsForLine(baseType, l, affix)))]
    }
  })
}

/**
 * The first existing item mod whose group collides with a guaranteed mod's
 * groups, or null when nothing conflicts. An empty `modGroups` (a guaranteed mod
 * with no normal group, e.g. "Mark of the Abyssal Lord") never conflicts.
 */
export function conflictingMod(modGroups: string[], mods: ItemMod[]): ItemMod | null {
  if (modGroups.length === 0) return null
  const want = new Set(modGroups)
  return mods.find((m) => m.groups.some((g) => want.has(g))) ?? null
}
