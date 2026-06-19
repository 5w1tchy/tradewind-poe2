import { useEffect, useState } from 'react'
import { formatAmount, toDenominations, type UniqueQuote } from '../../../core/exchange'
import styles from './UniqueCandidatesBanner.module.css'

const UNIT_LABEL = { exalted: 'ex', divine: 'div', chaos: 'chaos' } as const
type Unit = keyof typeof UNIT_LABEL

// Rarity → its canonical PoE color var, bent through the whole surface so the
// banner reads as a sliver of that rarity's tooltip (mirrors UniqueQuoteBanner).
const RARITY_ACCENT: Record<string, string> = {
  Unique: 'var(--tw-rarity-unique)',
  Rare: 'var(--tw-rarity-rare)',
  Magic: 'var(--tw-rarity-magic)'
}

// Cap the entrance stagger so a long list doesn't take seconds to finish
// unfurling — past this many rows they all share the last delay.
const MAX_STAGGER = 8

/** One candidate row's price: lead denomination + a single faint alternate. */
function rowPrice(quote: UniqueQuote, orb: (u: Unit, cls: string) => React.JSX.Element | null) {
  const denom = toDenominations(quote.priceExalted, quote.rates)
  // Lead with the largest denomination that reads as a whole-ish number.
  const primary: Unit = denom.divine >= 1 ? 'divine' : 'exalted'
  // The most informative alternate: chaos when leading in ex, else ex.
  const alt: Unit = primary === 'divine' ? 'exalted' : 'chaos'
  return (
    <span className={styles.price}>
      {orb(primary, styles.orb)}
      <span className={styles.amount}>{formatAmount(denom[primary])}</span>
      <span className={styles.unit}>{UNIT_LABEL[primary]}</span>
      <span className={styles.alt}>
        {formatAmount(denom[alt])}
        {UNIT_LABEL[alt]}
      </span>
    </span>
  )
}

/**
 * Candidate-list banner for an *unidentified* Unique (#88). An unidentified
 * unique copies with no name — only its decorated base — so we can't join a
 * single quote (the #80 path). But it can only be one of the handful of uniques
 * that drop on that base, so we list them all with their poe2scout aggregate
 * prices (price-descending) and let the user spot the relevant one. Same soft
 * dependency as the single banner: a snapshot miss / empty result renders
 * nothing, and the live search below stays the precise per-roll truth.
 */
export default function UniqueCandidatesBanner({
  rarity,
  type,
  league,
  currencyIcons
}: {
  rarity: string
  type: string
  league: string
  currencyIcons: Record<string, string>
}): React.JSX.Element | null {
  const [candidates, setCandidates] = useState<UniqueQuote[]>([])
  // Track per-row art failures so a 404'd CDN image falls back to the rune glyph
  // instead of a broken-image box. Keyed by row index; reset per item.
  const [artFailed, setArtFailed] = useState<Set<number>>(new Set())

  useEffect(() => {
    let live = true
    setCandidates([])
    setArtFailed(new Set())
    void window.tradewind.getUniqueCandidates(league, type).then((c) => {
      if (live) setCandidates(c)
    })
    return () => {
      live = false
    }
  }, [league, type])

  if (candidates.length === 0) return null

  const accent = RARITY_ACCENT[rarity] ?? 'var(--tw-rarity-unique)'
  const orb = (u: Unit, cls: string): React.JSX.Element | null =>
    currencyIcons[u] ? <img src={currencyIcons[u]} alt="" className={cls} /> : null

  return (
    <div
      className={styles.banner}
      style={{ ['--accent' as string]: accent }}
      title="unidentified — one of these uniques drop on this base; rough poe2scout aggregates, the live search below is precise"
    >
      <div className={styles.head}>
        <span className={styles.tag}>Unidentified</span>
        <span className={styles.dot}>◆</span>
        <span className={styles.source}>poe2scout aggregate</span>
        <span className={styles.count}>
          {candidates.length} on <span className={styles.base}>{type}</span>
        </span>
      </div>
      <ul className={styles.list}>
        {candidates.map((c, i) => (
          <li
            key={`${c.name}|${c.itemId}`}
            className={styles.row}
            style={{ animationDelay: `${Math.min(i, MAX_STAGGER) * 38}ms` }}
          >
            <span className={styles.thumb}>
              {c.iconUrl && !artFailed.has(i) ? (
                <img
                  src={c.iconUrl}
                  alt=""
                  className={styles.icon}
                  onError={() => setArtFailed((s) => new Set(s).add(i))}
                />
              ) : (
                <span className={styles.glyph}>◈</span>
              )}
            </span>
            <span className={styles.name}>{c.name}</span>
            {rowPrice(c, orb)}
          </li>
        ))}
      </ul>
    </div>
  )
}
