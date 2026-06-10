// Coverage/quality report: how every fixture mod line resolves to a trade stat.
// Run with: npx tsx scripts/match-report.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseItem } from '../src/core/parser/parse'
import type { ParsedMod } from '../src/core/parser/types'
import { StatsDb } from '../src/core/stats-db/statsDb'
import type { StatsPayload } from '../src/core/stats-db/types'

const root = join(__dirname, '..')
const db = new StatsDb(
  JSON.parse(readFileSync(join(root, 'data/trade-api-cache/stats.json'), 'utf8')) as StatsPayload
)

const preferFor = (mod: ParsedMod): string[] => {
  if (mod.generation === 'implicit') return ['implicit', 'explicit']
  if (mod.desecrated) return ['desecrated', 'explicit']
  if (mod.crafted) return ['crafted', 'explicit']
  if (mod.generation === 'enhancement') return ['enchant', 'sanctum', 'explicit', 'skill']
  return ['explicit']
}

let total = 0
const byCategory = new Map<string, number>()
const ambiguous: string[] = []
const negated: string[] = []
const unmatched: string[] = []

const fixturesDir = join(root, 'fixtures/items')
for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.txt'))) {
  const item = parseItem(readFileSync(join(fixturesDir, file), 'utf8'))

  const cases: { prefer: string[]; raw: string; line: Parameters<StatsDb['match']>[0] }[] = []
  for (const mod of [...item.implicits, ...item.explicits, ...item.enhancements]) {
    for (const line of mod.lines) cases.push({ prefer: preferFor(mod), raw: line.raw, line })
  }
  for (const line of item.runeMods)
    cases.push({ prefer: ['rune', 'enchant', 'explicit'], raw: line.raw, line })
  for (const line of item.enchantMods)
    cases.push({ prefer: ['enchant', 'explicit'], raw: line.raw, line })

  for (const { prefer, raw, line } of cases) {
    total++
    const candidates = db.match(line, { preferCategories: prefer })
    const top = candidates[0]
    if (!top) {
      unmatched.push(`${file} | ${raw}`)
      continue
    }
    byCategory.set(top.category, (byCategory.get(top.category) ?? 0) + 1)
    if (top.negated) negated.push(`${raw}  ->  ${top.id}`)
    const sameRank = candidates.filter((c) => c.category === top.category)
    if (sameRank.length > 1) {
      ambiguous.push(`${raw}\n    ${sameRank.map((c) => `${c.id} "${c.text}"`).join('\n    ')}`)
    }
  }
}

console.log(`total lines: ${total}`)
console.log(`unmatched: ${unmatched.length}`)
for (const u of unmatched) console.log(`  ${u}`)
console.log('top-candidate category distribution:')
for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) console.log(`  ${cat}: ${n}`)
console.log(`\nnegated (increased<->reduced) matches: ${negated.length}`)
for (const n of negated) console.log(`  ${n}`)
console.log(`\nambiguous within top category: ${ambiguous.length}`)
for (const a of ambiguous) console.log(`  ${a}`)
