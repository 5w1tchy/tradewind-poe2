// Splits fixtures/inbox.txt (items pasted from the game, separated by ===-lines)
// into one deduplicated file per item under fixtures/items/.
// Rerunnable: regenerates the whole directory from the inbox.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const inbox = readFileSync(join(root, 'fixtures', 'inbox.txt'), 'utf8')
const outDir = join(root, 'fixtures', 'items')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

const chunks = inbox
  .replace(/\r/g, '')
  .split(/^\s*={3,}\s*$/m)
  .map((c) => c.trim())
  .filter((c) => c.includes('Item Class:'))

const seen = new Set()
let written = 0
let dupes = 0

for (const chunk of chunks) {
  const hash = createHash('sha1').update(chunk).digest('hex').slice(0, 8)
  if (seen.has(hash)) {
    dupes++
    continue
  }
  seen.add(hash)

  const cls = chunk.match(/^Item Class: (.+)$/m)?.[1] ?? 'unknown'
  const name = chunk.split('\n')[2]?.trim() || 'item'
  written++
  const file = `${String(written).padStart(2, '0')}-${slug(cls)}--${slug(name)}-${hash}.txt`
  writeFileSync(join(outDir, file), chunk + '\n')
}

console.log(`wrote ${written} fixtures (${dupes} duplicates skipped) to fixtures/items/`)
