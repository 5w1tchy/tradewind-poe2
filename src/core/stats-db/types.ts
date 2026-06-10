/** Raw shape of GET /api/trade2/data/stats */
export interface StatsPayload {
  result: StatGroup[]
}

export interface StatGroup {
  /** Category: explicit, implicit, pseudo, rune, enchant, desecrated, fractured, crafted, sanctum, skill */
  id: string
  label?: string
  entries: TradeStatEntry[]
}

export interface TradeStatEntry {
  /** Trade filter id, e.g. "explicit.stat_3299347043" */
  id: string
  /** Display text with '#' placeholders, e.g. "# to maximum Life" */
  text: string
  type: string
}

/** A possible trade stat for a parsed mod line, ordered by context preference. */
export interface StatCandidate {
  id: string
  /** Stat group the candidate came from (explicit, rune, desecrated, ...) */
  category: string
  text: string
  /** Matched via increased<->reduced swap — roll values must be negated in queries. */
  negated: boolean
}
