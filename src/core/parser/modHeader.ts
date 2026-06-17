import type { ParsedMod } from './types'

const HEADER_LINE = /^\{ (.+) \}$/
const DESCRIPTOR =
  /^(?:(Desecrated|Crafted|Veiled|Fractured) )?(Prefix|Suffix|Implicit|Unique) Modifier(?: "(.*)")?(?: \(Tier: (\d+)\))?$/
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

  if (descriptor === 'Enhancement') {
    mod.generation = 'enhancement'
    return mod
  }

  const m = descriptor.match(DESCRIPTOR)
  if (!m) {
    mod.name = inner
    return mod
  }

  const [, variant, generation, name, tier] = m
  mod.generation = generation.toLowerCase() as ParsedMod['generation']
  mod.crafted = variant === 'Crafted'
  mod.desecrated = variant === 'Desecrated'
  mod.fractured = variant === 'Fractured'
  mod.name = name ?? null
  mod.tier = tier !== undefined ? Number(tier) : null
  return mod
}
