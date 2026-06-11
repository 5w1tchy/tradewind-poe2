/**
 * Recover the true base type from a decorated item name. White items can
 * carry display prefixes ("Exceptional Stalking Spear" is a Stalking Spear),
 * and magic names sandwich the base between affix words ("Sunny Thawing
 * Charm of the Copious" is a Thawing Charm). The longest whole-word match
 * against the live base list wins; null when nothing matches.
 */
export function extractBaseType(name: string, baseTypes: string[]): string | null {
  let best: string | null = null
  for (const base of baseTypes) {
    if (base.length <= (best?.length ?? 0)) continue
    const idx = name.indexOf(base)
    if (idx === -1) continue
    const end = idx + base.length
    const wordStart = idx === 0 || name[idx - 1] === ' '
    const wordEnd = end === name.length || name[end] === ' '
    if (wordStart && wordEnd) best = base
  }
  return best
}
