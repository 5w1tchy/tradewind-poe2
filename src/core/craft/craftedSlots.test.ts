import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseItem } from '../parser/parse'
import { craftedSlots } from './craftedSlots'

const fixturesDir = join(__dirname, '../../../fixtures/items')
const load = (pattern: string): string => {
  const file = readdirSync(fixturesDir).find((f) => f.includes(pattern))
  if (!file) throw new Error(`no fixture matching "${pattern}"`)
  return readFileSync(join(fixturesDir, file), 'utf8')
}

describe('craftedSlots', () => {
  it('counts both crafted mods and reads the Astrid cap from the rune line', () => {
    const item = parseItem(load('skull-goad'))
    // Two crafted mods (one of them Fractured Crafted) and Astrid socketed → 2/2.
    expect(craftedSlots(item)).toEqual({ used: 2, cap: 2 })
  })

  it('defaults to a cap of 1 with no Astrid rune', () => {
    const item = parseItem(load('rune-spur'))
    expect(craftedSlots(item).cap).toBe(1)
  })
})
