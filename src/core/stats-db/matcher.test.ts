import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseItem } from '../parser/parse'
import { parseStatLine } from '../parser/statLine'
import type { ParsedItem, ParsedMod, ParsedStatLine } from '../parser/types'
import { StatsDb } from './statsDb'
import type { StatsPayload } from './types'

const root = join(__dirname, '../../..')
const fixturesDir = join(root, 'fixtures/items')

let db: StatsDb

beforeAll(() => {
  const payload = JSON.parse(
    readFileSync(join(root, 'data/trade-api-cache/stats.json'), 'utf8')
  ) as StatsPayload
  db = new StatsDb(payload)
})

function preferFor(mod: ParsedMod): string[] {
  if (mod.generation === 'implicit') return ['implicit', 'explicit']
  if (mod.desecrated) return ['desecrated', 'explicit']
  if (mod.crafted) return ['crafted', 'explicit']
  if (mod.generation === 'enhancement') return ['enchant', 'sanctum', 'explicit', 'skill']
  return ['explicit']
}

interface LineCase {
  context: string
  prefer: string[]
  line: ParsedStatLine
}

function matchableLines(item: ParsedItem): LineCase[] {
  const cases: LineCase[] = []
  for (const mod of [...item.implicits, ...item.explicits, ...item.enhancements]) {
    for (const line of mod.lines) {
      cases.push({ context: mod.generation, prefer: preferFor(mod), line })
    }
  }
  for (const line of item.runeMods) {
    cases.push({ context: 'rune', prefer: ['rune', 'enchant', 'explicit'], line })
  }
  for (const line of item.enchantMods) {
    cases.push({ context: 'enchant', prefer: ['enchant', 'explicit'], line })
  }
  return cases
}

describe('matcher coverage over all fixtures', () => {
  it('matches the vast majority of mod lines to trade stat ids', () => {
    const unmatched: string[] = []
    let total = 0

    for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.txt'))) {
      const item = parseItem(readFileSync(join(fixturesDir, file), 'utf8'))
      for (const { context, prefer, line } of matchableLines(item)) {
        total++
        const candidates = db.match(line, { preferCategories: prefer })
        if (candidates.length === 0) {
          unmatched.push(`${file} | ${context} | ${line.raw}`)
        }
      }
    }

    if (unmatched.length > 0) {
      console.log(`\nUNMATCHED ${unmatched.length}/${total}:\n` + unmatched.join('\n'))
    }
    expect(total).toBeGreaterThan(80)
    // Only Mageblood's dynamic unique-flavour lines ("Legacy of X(Y-Z)")
    // are expected to miss — uniques are searched by name, not mod text.
    expect(unmatched.length).toBeLessThanOrEqual(4)
  })
})

describe('targeted matches', () => {
  const match = (raw: string, prefer?: string[]) =>
    db.match(parseStatLine(raw), { preferCategories: prefer })

  it('maximum life maps to the known stat hash', () => {
    const candidates = match('+102(100-119) to maximum Life')
    expect(candidates[0].id).toBe('explicit.stat_3299347043')
    expect(candidates[0].negated).toBe(false)
  })

  it('desecrated context prefers the desecrated twin of the same stat', () => {
    const candidates = match('+74 to maximum Life', ['desecrated', 'explicit'])
    expect(candidates[0].id).toBe('desecrated.stat_3299347043')
    expect(candidates.some((c) => c.id === 'explicit.stat_3299347043')).toBe(true)
  })

  it('resistance line with + sign matches signless trade text', () => {
    const candidates = match('+45(41-45)% to Lightning Resistance')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].category).toBe('explicit')
  })

  it('hybrid second line (accuracy) matches independently', () => {
    const candidates = match('+117(98-123) to Accuracy Rating')
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('no-number line matches exactly', () => {
    const candidates = match('Loads an additional bolt', ['implicit', 'explicit'])
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('pluralized display text matches singular trade text', () => {
    const candidates = match('Has 3(1-3) Charm Slots', ['implicit', 'explicit'])
    expect(candidates[0].id).toBe('implicit.stat_1416292992')
  })

  it('fewer/additional antonym pair matches with negation', () => {
    const candidates = match('Require 4(4-2) fewer enemies to be Surrounded')
    expect(candidates[0].id).toBe('explicit.stat_2267564181')
    expect(candidates[0].negated).toBe(true)
  })

  it('parenthetical-qualified trade stats match via alias', () => {
    const candidates = match('10 uses remaining')
    expect(candidates.some((c) => c.id === 'pseudo.pseudo_number_of_uses_remaining')).toBe(true)
  })
})
