import { isModHeader, parseModHeader } from './modHeader'
import { parseStatLine } from './statLine'
import type { ItemProperty, ParsedItem, ParsedMod } from './types'

const SECTION_SEPARATOR = /^-{4,}$/

// A section directly after the name block is the property block only if at
// least one line looks property-ish (PoE2 property lines don't always have a
// colon, e.g. "Lasts 3 Seconds" on charms).
const PROPERTY_STARTS = [
  'Quality',
  'Armour',
  'Evasion Rating',
  'Energy Shield',
  'Ward',
  'Block chance',
  'Spirit',
  'Physical Damage',
  'Fire Damage',
  'Cold Damage',
  'Lightning Damage',
  'Chaos Damage',
  'Elemental Damage',
  'Critical Hit Chance',
  'Attacks per Second',
  'Reload Time',
  'Stack Size',
  'Radius',
  'Limited to',
  'Lasts ',
  'Consumes ',
  'Currently has ',
  'Grants Immunity',
  'Recovers ',
  'Level:',
  'Cost:',
  'Waystone',
  'Item Rarity',
  'Monster ',
  'Revives Available',
  'Minimum Modifier Level'
]

function splitSections(text: string): string[][] {
  const sections: string[][] = []
  let current: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (SECTION_SEPARATOR.test(line.trim())) {
      sections.push(current)
      current = []
    } else {
      current.push(line.trimEnd())
    }
  }
  sections.push(current)

  return sections
    .map((section) => {
      let start = 0
      let end = section.length
      while (start < end && section[start] === '') start++
      while (end > start && section[end - 1] === '') end--
      return section.slice(start, end)
    })
    .filter((section) => section.length > 0)
}

function isPropertyLine(line: string): boolean {
  return line.includes(': ') || PROPERTY_STARTS.some((p) => line.startsWith(p))
}

// Basic (non-advanced) copy has no "{ ... }" headers; each mod line instead
// carries its origin inline, e.g. "+50 to Spirit (fractured)". A chat-linked
// item always copies in this form even though its tooltip shows tier badges.
const ORIGIN_TAG = /\s*\((implicit|fractured|desecrated|crafted)\)$/

function parseBasicModLine(line: string): ParsedMod {
  const tag = line.match(ORIGIN_TAG)
  const origin = tag?.[1]
  const body = tag ? line.slice(0, tag.index) : line
  return {
    // Basic copy gives no prefix/suffix split — best we can say is "explicit".
    generation: origin === 'implicit' ? 'implicit' : 'explicit',
    crafted: origin === 'crafted',
    desecrated: origin === 'desecrated',
    name: null,
    tier: null,
    tags: [],
    qualityIncrease: null,
    lines: [parseStatLine(body)]
  }
}

/**
 * A headerless block is a basic-copy mod block (not flavour text or a
 * description) when no line reads as a sentence and every line looks like a
 * stat. Property blocks are excluded so "Quality: ..." isn't mistaken for mods.
 */
function looksLikeStatLine(line: string): boolean {
  if (ORIGIN_TAG.test(line)) return true
  if (line.startsWith('"') || /[.!?]$/.test(line)) return false
  // Almost every mod carries a number; a wordless mod is too rare to tell from
  // prose without one, so we don't risk swallowing a description line for it.
  return /\d/.test(line)
}

function isBasicModSection(section: string[]): boolean {
  if (section.some(isPropertyLine)) return false
  return section.every(looksLikeStatLine)
}

function parseModSection(section: string[]): ParsedMod[] {
  const mods: ParsedMod[] = []
  let headered: ParsedMod | null = null
  for (const line of section) {
    if (isModHeader(line)) {
      headered = parseModHeader(line)
      mods.push(headered)
    } else if (headered) {
      // A stat line trailing an advanced-copy header — a hybrid mod's 2nd line.
      headered.lines.push(parseStatLine(line))
    } else {
      // No header in front: basic copy, one mod per line (no way to group).
      mods.push(parseBasicModLine(line))
    }
  }
  return mods
}

export function parseItem(text: string): ParsedItem {
  const sections = splitSections(text)
  if (sections.length === 0 || !sections[0][0]?.startsWith('Item Class:')) {
    throw new Error('not an item: missing "Item Class:" header')
  }

  const header = sections[0]
  const itemClass = header[0].slice('Item Class:'.length).trim()
  const rarity = header[1]?.startsWith('Rarity:')
    ? header[1].slice('Rarity:'.length).trim()
    : 'Unknown'
  const nameLines = header.slice(2)
  const name = nameLines.length >= 2 ? nameLines[0] : null
  const baseType = nameLines.length >= 2 ? nameLines[1] : (nameLines[0] ?? '')

  const item: ParsedItem = {
    itemClass,
    rarity,
    name,
    baseType,
    itemLevel: null,
    requiredLevel: null,
    requirements: null,
    quality: null,
    waystoneTier: null,
    sockets: null,
    properties: [],
    grantedSkills: [],
    runeMods: [],
    enchantMods: [],
    implicits: [],
    explicits: [],
    enhancements: [],
    corrupted: false,
    unidentified: false,
    note: null,
    unknownSections: []
  }

  let propertiesSeen = false
  // Only gear rolls prefix/suffix mods; gating basic-mod detection on a gear
  // rarity keeps a gem's headerless skill-stat block out of the explicit list.
  const gearRarity = rarity === 'Normal' || rarity === 'Magic' || rarity === 'Rare' || rarity === 'Unique'

  for (const section of sections.slice(1)) {
    const first = section[0]

    if (section.length === 1 && first === 'Corrupted') {
      item.corrupted = true
    } else if (section.length === 1 && first === 'Unidentified') {
      item.unidentified = true
    } else if (first.startsWith('Item Level:')) {
      item.itemLevel = Number(first.slice('Item Level:'.length).trim())
    } else if (first.startsWith('Requires:')) {
      item.requirements = section.join('; ')
      const level = item.requirements.match(/Level (\d+)/)
      if (level) item.requiredLevel = Number(level[1])
    } else if (first.startsWith('Sockets:')) {
      item.sockets = first.slice('Sockets:'.length).trim().split(/\s+/).filter(Boolean).length
    } else if (first.startsWith('Note:')) {
      item.note = first.slice('Note:'.length).trim()
    } else if (section.every((l) => l.endsWith('(rune)'))) {
      item.runeMods = section.map((l) => parseStatLine(l.slice(0, -' (rune)'.length)))
    } else if (section.every((l) => l.endsWith('(enchant)'))) {
      item.enchantMods = section.map((l) => parseStatLine(l.slice(0, -' (enchant)'.length)))
    } else if (section.every((l) => l.startsWith('Grants Skill'))) {
      item.grantedSkills.push(...section.map((l) => l.slice(l.indexOf(':') + 1).trim()))
    } else if (section.some((l) => isModHeader(l)) || (gearRarity && isBasicModSection(section))) {
      for (const mod of parseModSection(section)) {
        if (mod.generation === 'implicit') item.implicits.push(mod)
        else if (mod.generation === 'enhancement') item.enhancements.push(mod)
        else item.explicits.push(mod)
      }
    } else if (!propertiesSeen && section.some((l) => isPropertyLine(l))) {
      propertiesSeen = true
      item.properties = section.map((raw): ItemProperty => {
        const colon = raw.indexOf(': ')
        return { name: colon > 0 ? raw.slice(0, colon) : null, raw }
      })
    } else {
      item.unknownSections.push(section)
    }
  }

  for (const prop of item.properties) {
    const quality = prop.raw.match(/^Quality[^:]*: \+(\d+)%/)
    if (quality) item.quality = Number(quality[1])
    const tier = prop.raw.match(/^Waystone Tier: (\d+)/)
    if (tier) item.waystoneTier = Number(tier[1])
  }
  // Waystone tier also appears in magic/normal item names: "Painful Waystone (Tier 15) of Erosion"
  if (item.waystoneTier === null) {
    const inName = (item.name ?? item.baseType).match(/\(Tier (\d+)\)/)
    if (inName) item.waystoneTier = Number(inName[1])
  }

  return item
}
