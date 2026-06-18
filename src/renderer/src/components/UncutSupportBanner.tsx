import { useEffect, useState } from 'react'
import { formatAmount, toDenominations, type UncutQuote } from '../../../core/exchange'
import styles from './UncutSupportBanner.module.css'

const UNIT_LABEL = { exalted: 'ex', divine: 'div', chaos: 'chaos' } as const
type Unit = keyof typeof UNIT_LABEL

// Uncut Support Gem levels (1–5) read as Roman numerals, matching the in-game
// gem-tier glyphs ("BLEED III") and avoiding the muddy "L1/L2/L3" the digits gave.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'] as const
const roman = (n: number): string => ROMAN[n] ?? String(n)

/**
 * "Cut it yourself" banner above a *cuttable* support gem's view (issue #58). A
 * regular support gem isn't traded on the currency exchange (only the lineage
 * supports are — those take the chart view), so the realistic way to obtain one
 * is to buy an Uncut Support Gem and engrave it. This lists the uncut levels'
 * aggregate poe2scout prices (the same snapshot that prices currency) so the
 * cut-vs-buy floor is instant. We don't know the required tier for this support
 * (no per-support data yet), so all available levels are shown plainly — we
 * deliberately don't highlight the cheapest, since a cheaper low level may be
 * too low to actually cut the gem.
 *
 * Soft dependency: quotes are fetched on mount via getUncutSupportQuotes (the
 * main hot path is unchanged); a miss renders nothing and the live finished-gem
 * search below stays the source of truth.
 */
export default function UncutSupportBanner({
  levels,
  league,
  currencyIcons
}: {
  levels: number[]
  league: string
  currencyIcons: Record<string, string>
}): React.JSX.Element | null {
  const [quotes, setQuotes] = useState<UncutQuote[]>([])

  useEffect(() => {
    let live = true
    setQuotes([])
    void window.tradewind.getUncutSupportQuotes(league, levels).then((qs) => {
      if (live) setQuotes(qs)
    })
    return () => {
      live = false
    }
    // levels is a stable [1..5] from prepare; key on its identity via join.
  }, [league, levels])

  if (quotes.length === 0) return null

  const orb = (u: Unit, cls: string): React.JSX.Element | null =>
    currencyIcons[u] ? <img src={currencyIcons[u]} alt="" className={cls} /> : null

  return (
    <div
      className={styles.banner}
      title="aggregate poe2scout price of the Uncut Support Gem you'd engrave — the live search below prices the finished gem"
    >
      <div className={styles.eyebrow}>
        <span className={styles.tag}>Uncut Support</span>
        <span className={styles.dot}>◆</span>
        <span className={styles.source}>poe2scout aggregate</span>
      </div>
      <ul className={styles.rows}>
        {quotes.map((q) => {
          const denom = toDenominations(q.priceExalted, q.rates)
          // Lead with divine once it reads as a whole-ish number, else exalted.
          const unit: Unit = denom.divine >= 1 ? 'divine' : 'exalted'
          return (
            <li key={q.apiId} className={styles.row}>
              <span className={styles.level}>{roman(q.level)}</span>
              <span className={styles.price}>
                {orb(unit, styles.orb)}
                <span className={styles.amount}>{formatAmount(denom[unit])}</span>
                <span className={styles.unit}>{UNIT_LABEL[unit]}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
