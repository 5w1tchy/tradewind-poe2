import type { ParsedStatLine } from '../parser/types'
import { replaceNumericTokens, stripUnscalable } from '../parser/statLine'
import type { StatCandidate, StatsPayload } from './types'

/** Most lines have 1-3 numbers; cap literal-restore variant explosion. */
const MAX_VARIANT_TOKENS = 6

/**
 * Shared normalization for both trade stat texts and clipboard templates:
 * numbers -> '#', strip '+' before '#' (trade texts carry no sign), trim.
 */
export function normalizeStatText(text: string): string {
  return replaceNumericTokens(text, () => '#')
    .replace(/\+#/g, '#')
    .trim()
}

// Word pairs the game renders as opposites of a single signed stat; matching
// across a pair means the query value must be negated.
const ANTONYM_PAIRS: [string, string][] = [
  ['increased', 'reduced'],
  ['more', 'less'],
  ['fewer', 'additional'],
  ['faster', 'slower']
]

function antonymKeys(text: string): string[] {
  const out: string[] = []
  for (const [a, b] of ANTONYM_PAIRS) {
    if (new RegExp(`\\b${a}\\b`).test(text)) out.push(text.replace(new RegExp(`\\b${a}\\b`, 'g'), b))
    else if (new RegExp(`\\b${b}\\b`).test(text)) out.push(text.replace(new RegExp(`\\b${b}\\b`, 'g'), a))
  }
  return out
}

// "Has # Charm Slots" (display, pluralized) vs "Has # Charm Slot" (trade text).
// One variant per candidate word, singularized.
function singularVariants(key: string): string[] {
  const words = key.split(' ')
  const out: string[] = []
  words.forEach((word, i) => {
    if (/^[A-Za-z]{4,}s$/.test(word) && !word.endsWith('ss')) {
      const copy = [...words]
      copy[i] = word.slice(0, -1)
      out.push(copy.join(' '))
    }
  })
  return out
}

/**
 * All match keys for a clipboard line, in priority order:
 *  1. everything templated ("Pierces # targets")
 *  2. variants with subsets of numbers restored as literals
 *     ("Pierces 5 targets" — for stats where a number is fixed text)
 */
function candidateKeys(rawLine: string): string[] {
  const { text } = stripUnscalable(rawLine)

  const tokens: string[] = []
  replaceNumericTokens(text, ({ text: t }) => {
    tokens.push(t)
    return '#'
  })

  const main = normalizeStatText(text)
  const keys = [main]
  const n = tokens.length
  if (n > 0 && n <= MAX_VARIANT_TOKENS) {
    for (let mask = 1; mask < 1 << n; mask++) {
      const variant = replaceNumericTokens(text, ({ text: t }, i) =>
        mask & (1 << i) ? t : '#'
      )
      keys.push(
        variant
          .replace(/\+#/g, '#')
          .trim()
      )
    }
  }
  keys.push(...singularVariants(main))
  return [...new Set(keys)]
}

export interface MatchOptions {
  /** Stat categories to rank first, in order (e.g. ['rune', 'explicit']). */
  preferCategories?: string[]
}

export class StatsDb {
  private readonly byText = new Map<string, StatCandidate[]>()

  constructor(payload: StatsPayload) {
    for (const group of payload.result) {
      for (const entry of group.entries) {
        const candidate: StatCandidate = {
          id: entry.id,
          category: group.id,
          text: entry.text,
          negated: false
        }
        this.index(normalizeStatText(entry.text), candidate)
        // Trailing parenthetical qualifiers — "(Local)", "(Global)",
        // "(Tablets)" — don't appear in clipboard text; index an alias
        // without them. Colliding aliases simply join the candidate list.
        const unqualified = entry.text.replace(/ \([A-Za-z ]+\)$/, '')
        if (unqualified !== entry.text) {
          this.index(normalizeStatText(unqualified), candidate)
        }
        // Multi-line stats are also indexed per line so a single clipboard
        // line can still find them.
        if (entry.text.includes('\n')) {
          for (const line of entry.text.split('\n')) {
            this.index(normalizeStatText(line), candidate)
          }
        }
      }
    }
  }

  private index(key: string, candidate: StatCandidate): void {
    if (!key) return
    const existing = this.byText.get(key)
    if (existing) existing.push(candidate)
    else this.byText.set(key, [candidate])
  }

  /**
   * Find trade stat candidates for a parsed mod line. Tries exact template
   * match first, then literal-restore variants, then an increased<->reduced
   * swap (candidates from the swap are flagged `negated`).
   */
  match(line: ParsedStatLine, options: MatchOptions = {}): StatCandidate[] {
    const prefer = options.preferCategories ?? ['explicit']

    let found: StatCandidate[] | null = null
    for (const key of candidateKeys(line.raw)) {
      const hit = this.byText.get(key)
      if (hit) {
        found = hit
        break
      }
      for (const swapped of antonymKeys(key)) {
        const swappedHit = this.byText.get(swapped)
        if (swappedHit) {
          found = swappedHit.map((c) => ({ ...c, negated: true }))
          break
        }
      }
      if (found) break
    }
    if (!found) return []

    const rank = (c: StatCandidate): number => {
      const i = prefer.indexOf(c.category)
      return i === -1 ? prefer.length : i
    }
    return [...found].sort((a, b) => rank(a) - rank(b))
  }
}
