import type { ParsedStatLine, RollValue } from './types'

const UNSCALABLE_SUFFIX = ' — Unscalable Value'

// Matches "102", "9.3", "3,30" (some locales use comma decimals) with an
// optional roll range "(100-119)" attached.
const NUMERIC_TOKEN =
  /(?<![\d#])(-?\d+(?:[.,]\d+)?)(?:\((-?\d+(?:[.,]\d+)?)-(-?\d+(?:[.,]\d+)?)\))?/g

const toNumber = (s: string): number => Number(s.replace(',', '.'))

export interface NumericToken {
  /** Display value as written, e.g. "102" or "9.3". */
  text: string
  roll: RollValue
}

/**
 * Replace every numeric token (value + optional advanced-copy range) in a mod
 * line via `replacer`. Shared by the parser (templating) and the stats DB
 * (literal-restore match variants).
 */
export function replaceNumericTokens(
  text: string,
  replacer: (token: NumericToken, index: number) => string
): string {
  let index = 0
  return text.replace(NUMERIC_TOKEN, (_m, value, min, max) => {
    const roll: RollValue = { value: toNumber(value) }
    if (min !== undefined && max !== undefined) {
      roll.min = toNumber(min)
      roll.max = toNumber(max)
    }
    return replacer({ text: value, roll }, index++)
  })
}

export function stripUnscalable(text: string): { text: string; unscalable: boolean } {
  if (text.endsWith(UNSCALABLE_SUFFIX)) {
    return { text: text.slice(0, -UNSCALABLE_SUFFIX.length), unscalable: true }
  }
  return { text, unscalable: false }
}

/**
 * Normalize a mod stat line: extract roll values (with min/max from advanced
 * copy ranges) and produce a '#'-templated string for stat-ID matching.
 */
export function parseStatLine(rawLine: string): ParsedStatLine {
  const { text, unscalable } = stripUnscalable(rawLine)

  const values: RollValue[] = []
  const template = replaceNumericTokens(text, ({ roll }) => {
    values.push(roll)
    return '#'
  })

  return { raw: rawLine, template, values, unscalable }
}
