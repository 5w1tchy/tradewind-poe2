import type { ParsedItem, ParsedStatLine } from '../parser/types'
import type { EquipmentFilterKey } from './types'

export interface DerivedValue {
  key: EquipmentFilterKey
  label: string
  value: number
}

const DEFENCE_PROPS: Array<{ name: string; key: 'ar' | 'ev' | 'es'; label: string }> = [
  { name: 'Armour', key: 'ar', label: 'Armour' },
  { name: 'Evasion Rating', key: 'ev', label: 'Evasion' },
  { name: 'Energy Shield', key: 'es', label: 'Energy Shield' }
]

function firstNumber(raw: string): number | null {
  const m = raw.match(/:\s*([\d.]+)/)
  return m ? Number(m[1]) : null
}

/** Average damage over every "lo-hi" range in a property line. */
function rangeAverage(raw: string): number {
  let sum = 0
  for (const m of raw.matchAll(/(\d+)-(\d+)/g)) {
    sum += (Number(m[1]) + Number(m[2])) / 2
  }
  return sum
}

function allStatLines(item: ParsedItem): ParsedStatLine[] {
  const lines: ParsedStatLine[] = []
  for (const mod of [...item.implicits, ...item.explicits, ...item.enhancements]) {
    lines.push(...mod.lines)
  }
  lines.push(...item.runeMods, ...item.enchantMods)
  return lines
}

type IncKey = 'ar' | 'ev' | 'es' | 'phys'

const INC_TOKENS: Record<string, IncKey> = {
  Armour: 'ar',
  Evasion: 'ev',
  'Evasion Rating': 'ev',
  'Energy Shield': 'es',
  'Physical Damage': 'phys'
}

/**
 * Sum the item's local "#% increased <defence/damage>" lines (incl. hybrid
 * lists and runes — they're all in the card value). Needed to undo quality
 * correctly: quality is additive with increased%, not multiplicative.
 */
function increasedTotals(item: ParsedItem): Record<IncKey, number> {
  const totals: Record<IncKey, number> = { ar: 0, ev: 0, es: 0, phys: 0 }
  for (const line of allStatLines(item)) {
    const m = line.template.match(/^#% increased (.+)$/)
    if (!m || line.values.length === 0) continue
    for (const token of m[1].split(/,\s*|\s+and\s+/)) {
      const key = INC_TOKENS[token.trim()]
      if (key) totals[key] += line.values[0].value
    }
  }
  return totals
}

/**
 * The trade site indexes defences and physical damage normalized to 20%
 * quality; card values reflect current quality. card = base*(100+q+inc)/100,
 * so the Q20 value is card*(120+inc)/(100+q+inc). Above 20q stays as-is.
 */
function q20(value: number, quality: number | null, inc: number): number {
  const q = quality ?? 0
  if (q >= 20) return value
  return (value * (120 + inc)) / (100 + q + inc)
}

/**
 * Numbers the game computed for us, straight off the item card: defences and
 * per-second damage, quality-normalized the way trade listings are indexed.
 * These map to trade2 equipment_filters — the natural way to shop armour
 * bases and weapons.
 */
export function deriveEquipmentValues(item: ParsedItem): DerivedValue[] {
  const out: DerivedValue[] = []
  const inc = increasedTotals(item)

  for (const spec of DEFENCE_PROPS) {
    const prop = item.properties.find((p) => p.name === spec.name)
    if (!prop) continue
    const raw = firstNumber(prop.raw)
    if (raw === null || raw <= 0) continue
    const value = Math.round(q20(raw, item.quality, inc[spec.key]))
    const label = value !== raw ? `${spec.label} (Q20)` : spec.label
    out.push({ key: spec.key, label, value })
  }

  const spirit = item.properties.find((p) => p.name === 'Spirit')
  const spiritValue = spirit ? firstNumber(spirit.raw) : null
  if (spiritValue !== null && spiritValue > 0) {
    out.push({ key: 'spirit', label: 'Spirit', value: spiritValue })
  }
  const block = item.properties.find((p) => p.name === 'Block chance')
  const blockValue = block ? firstNumber(block.raw) : null
  if (blockValue !== null && blockValue > 0) {
    out.push({ key: 'block', label: 'Block %', value: blockValue })
  }

  let phys = 0
  let ele = 0
  let chaos = 0
  let aps: number | null = null
  for (const p of item.properties) {
    if (!p.name) continue
    if (p.name === 'Attacks per Second') {
      aps = firstNumber(p.raw)
    } else if (p.name === 'Physical Damage') {
      phys += rangeAverage(p.raw)
    } else if (p.name === 'Chaos Damage') {
      chaos += rangeAverage(p.raw)
    } else if (/^(Fire|Cold|Lightning|Elemental) Damage$/.test(p.name)) {
      ele += rangeAverage(p.raw)
    }
  }

  if (aps !== null && phys + ele + chaos > 0) {
    // Standard quality boosts physical damage only.
    const physQ20 = q20(phys, item.quality, inc.phys)
    const normalized = physQ20 !== phys
    if (phys > 0) {
      out.push({
        key: 'pdps',
        label: normalized ? 'Phys DPS (Q20)' : 'Phys DPS',
        value: Math.round(physQ20 * aps)
      })
    }
    if (ele > 0) out.push({ key: 'edps', label: 'Ele DPS', value: Math.round(ele * aps) })
    out.push({
      key: 'dps',
      label: normalized ? 'DPS (Q20)' : 'DPS',
      value: Math.round((physQ20 + ele + chaos) * aps)
    })
  }

  return out
}
