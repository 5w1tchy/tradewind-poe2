export type ModGeneration =
  | 'prefix'
  | 'suffix'
  | 'implicit'
  // Basic (non-advanced) copy gives no prefix/suffix split — the in-game
  // tooltip from a chat link, or a user without the advanced-copy keybind.
  | 'explicit'
  | 'unique'
  | 'enhancement'
  | 'unknown'

export interface RollValue {
  value: number
  min?: number
  max?: number
}

/** One stat line of a mod, normalized for matching against trade stat IDs. */
export interface ParsedStatLine {
  raw: string
  /** Text with every numeric token replaced by '#', e.g. "+# to maximum Life". */
  template: string
  values: RollValue[]
  /** Line carried the "— Unscalable Value" marker. */
  unscalable: boolean
}

export interface ParsedMod {
  generation: ModGeneration
  crafted: boolean
  desecrated: boolean
  /** Affix name from the header, e.g. "Virile". Empty string occurs in game data. */
  name: string | null
  tier: number | null
  /** Tag list from the header, e.g. ["Elemental", "Fire", "Resistance"]. */
  tags: string[]
  /** "— 20% Increased" quality boost annotation, if present. */
  qualityIncrease: number | null
  lines: ParsedStatLine[]
}

export interface ItemProperty {
  /** Text before ':' when the line has one (e.g. "Energy Shield"), else null. */
  name: string | null
  raw: string
}

export interface ParsedItem {
  itemClass: string
  rarity: string
  /** Given name for rare/unique items; null when the first block has one name line. */
  name: string | null
  baseType: string
  itemLevel: number | null
  requiredLevel: number | null
  requirements: string | null
  quality: number | null
  waystoneTier: number | null
  sockets: number | null
  properties: ItemProperty[]
  grantedSkills: string[]
  runeMods: ParsedStatLine[]
  enchantMods: ParsedStatLine[]
  implicits: ParsedMod[]
  explicits: ParsedMod[]
  enhancements: ParsedMod[]
  corrupted: boolean
  unidentified: boolean
  /** Seller note ("Note: ~b/o 1 divine"). */
  note: string | null
  /** Sections the parser didn't classify — kept verbatim so nothing is lost. */
  unknownSections: string[][]
}
