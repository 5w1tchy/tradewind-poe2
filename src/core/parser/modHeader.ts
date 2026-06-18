import type { ParsedMod } from './types'

const HEADER_LINE = /^\{ (.+) \}$/
// A header can stack variant keywords, e.g. `Fractured Crafted Suffix Modifier`
// (a crafted mod later locked by a Fracturing Orb), so the variant prefix is a
// space-separated run, not a single keyword.
const DESCRIPTOR =
  /^((?:(?:Desecrated|Crafted|Veiled|Fractured) )*)(Prefix|Suffix|Implicit|Unique) Modifier(?: "(.*)")?(?: \(Tier: (\d+)\))?$/
const QUALITY_BOOST = /^(\d+)% Increased$/

export function isModHeader(line: string): boolean {
  return HEADER_LINE.test(line)
}

/**
 * Parse an advanced-copy mod header such as:
 *   { Prefix Modifier "Virile" (Tier: 2) — Life }
 *   { Desecrated Suffix Modifier "of Ulaman" (Tier: 1) — Caster — 79% Increased }
 *   { Unique Modifier — Armour, Evasion }
 *   { Implicit Modifier }
 *   { Enhancement }
 * Returns a mod with no stat lines yet; returns generation 'unknown' (with the
 * raw header preserved as name) rather than throwing on unrecognized shapes.
 */
export function parseModHeader(line: string): ParsedMod {
  const mod: ParsedMod = {
    generation: 'unknown',
    crafted: false,
    desecrated: false,
    fractured: false,
    corrupted: false,
    name: null,
    tier: null,
    tags: [],
    qualityIncrease: null,
    lines: []
  }

  const inner = line.match(HEADER_LINE)?.[1]
  if (!inner) {
    mod.name = line
    return mod
  }

  const [descriptor, ...rest] = inner.split(' — ')

  for (const part of rest) {
    const quality = part.match(QUALITY_BOOST)
    if (quality) mod.qualityIncrease = Number(quality[1])
    else mod.tags.push(...part.split(', '))
  }

  // Anoints/enchants copy as `{ Enhancement }`; a corruption-added enhancement
  // copies as `{ Corruption Enhancement }` (e.g. corrupted-implicit "increased
  // Evasion Rating"). Both are enhancement-generation; the corruption flag is
  // what later tags it CE rather than E.
  if (descriptor === 'Enhancement' || descriptor === 'Corruption Enhancement') {
    mod.generation = 'enhancement'
    mod.corrupted = descriptor === 'Corruption Enhancement'
    return mod
  }

  const m = descriptor.match(DESCRIPTOR)
  if (!m) {
    mod.name = inner
    return mod
  }

  const [, variants, generation, name, tier] = m
  mod.generation = generation.toLowerCase() as ParsedMod['generation']
  mod.crafted = variants.includes('Crafted')
  mod.desecrated = variants.includes('Desecrated')
  mod.fractured = variants.includes('Fractured')
  mod.name = name ?? null
  mod.tier = tier !== undefined ? Number(tier) : null
  return mod
}
