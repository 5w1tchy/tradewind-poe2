import type { ParsedItem } from '../parser/types'
import type { EquipmentFilterKey } from './types'

export interface DerivedValue {
  key: EquipmentFilterKey
  label: string
  value: number
}

const DEFENCE_PROPS: Array<{ name: string; key: EquipmentFilterKey; label: string }> = [
  { name: 'Armour', key: 'ar', label: 'Armour' },
  { name: 'Evasion Rating', key: 'ev', label: 'Evasion' },
  { name: 'Energy Shield', key: 'es', label: 'Energy Shield' },
  { name: 'Spirit', key: 'spirit', label: 'Spirit' },
  { name: 'Block chance', key: 'block', label: 'Block %' }
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
 * Numbers the game computed for us, straight off the item card: defences and
 * per-second damage. These map to trade2 equipment_filters (ar/ev/es/spirit/
 * block/dps/pdps/edps) — the natural way to shop armour bases and weapons.
 */
export function deriveEquipmentValues(item: ParsedItem): DerivedValue[] {
  const out: DerivedValue[] = []

  for (const spec of DEFENCE_PROPS) {
    const prop = item.properties.find((p) => p.name === spec.name)
    if (!prop) continue
    const value = firstNumber(prop.raw)
    if (value !== null && value > 0) out.push({ key: spec.key, label: spec.label, value })
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
    const round = (n: number): number => Math.round(n)
    if (phys > 0) out.push({ key: 'pdps', label: 'Phys DPS', value: round(phys * aps) })
    if (ele > 0) out.push({ key: 'edps', label: 'Ele DPS', value: round(ele * aps) })
    out.push({ key: 'dps', label: 'DPS', value: round((phys + ele + chaos) * aps) })
  }

  return out
}
