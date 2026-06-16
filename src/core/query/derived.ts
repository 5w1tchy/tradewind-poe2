import type { ParsedItem } from '../parser/types'
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

/**
 * The trade site indexes defences and physical damage normalized to 20%
 * quality; card values reflect current quality. In PoE2 quality is a
 * standalone multiplier on top of increased% mods (verified empirically:
 * 222 base, +97% +18% mods, 20q -> 222 * 2.15 * 1.2 = 573), so the Q20
 * value is simply card * 120/(100+q). Above 20q stays as-is.
 */
function q20(value: number, quality: number | null): number {
  const q = quality ?? 0
  if (q >= 20) return value
  return (value * 120) / (100 + q)
}

/**
 * Numbers the game computed for us, straight off the item card: defences and
 * per-second damage, quality-normalized the way trade listings are indexed.
 * These map to trade2 equipment_filters — the natural way to shop armour
 * bases and weapons.
 */
export function deriveEquipmentValues(item: ParsedItem): DerivedValue[] {
  const out: DerivedValue[] = []

  for (const spec of DEFENCE_PROPS) {
    const prop = item.properties.find((p) => p.name === spec.name)
    if (!prop) continue
    const raw = firstNumber(prop.raw)
    if (raw === null || raw <= 0) continue
    const value = Math.round(q20(raw, item.quality))
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

  if (item.sockets !== null && item.sockets > 0) {
    out.push({ key: 'rune_sockets', label: 'Sockets', value: item.sockets })
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
    const physQ20 = q20(phys, item.quality)
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

  // Attack speed and crit are weapon properties the trade site indexes directly
  // (not quality-normalized). Kept as fractional values — the trade aps/crit
  // filters accept decimals, and rounding a 1.30 aps to 1 would gut the filter.
  if (aps !== null && aps > 0) {
    out.push({ key: 'aps', label: 'Attacks/sec', value: aps })
  }
  const critProp = item.properties.find((p) => p.name === 'Critical Hit Chance')
  const critValue = critProp ? firstNumber(critProp.raw) : null
  if (critValue !== null && critValue > 0) {
    out.push({ key: 'crit', label: 'Crit Chance %', value: critValue })
  }

  return out
}
