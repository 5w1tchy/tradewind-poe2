import { useEffect, useState } from 'react'
import { formatAmount, toDenominations, type UniqueQuote } from '../../../core/exchange'
import styles from './UniqueQuoteBanner.module.css'

const UNIT_LABEL = { exalted: 'ex', divine: 'div', chaos: 'chaos' } as const
type Unit = keyof typeof UNIT_LABEL

// Rarity → its canonical PoE color var. The banner bends this hue through its
// whole surface (spine, wash, border, label) so the price reads as a sliver of
// that rarity's own tooltip. Only Unique reaches here today (#80), but keying it
// this way keeps the artifact reusable if rares ever gain an aggregate banner.
const RARITY_ACCENT: Record<string, string> = {
  Unique: 'var(--tw-rarity-unique)',
  Rare: 'var(--tw-rarity-rare)',
  Magic: 'var(--tw-rarity-magic)'
}

/**
 * Compact poe2scout aggregate-price banner shown on top of the Price tab for a
 * Unique (#80). The quote is the same flat snapshot that prices currency, so
 * it's free — fetched on mount via getUniqueQuote (the main hot path is
 * unchanged) and joined on Name+Type. It's a *rough* anchor, not the order book
 * (poe2scout's aggregate is noisy for cheap/thin uniques), so it reads as a
 * ballpark and the live search below remains the precise, per-roll truth. A
 * snapshot miss renders nothing — the Search button still works.
 */
export default function UniqueQuoteBanner({
  rarity,
  name,
  type,
  league,
  currencyIcons
}: {
  rarity: string
  name: string
  type: string
  league: string
  currencyIcons: Record<string, string>
}): React.JSX.Element | null {
  const [quote, setQuote] = useState<UniqueQuote | null>(null)
  // Drop the art frame if the CDN image 404s/fails — a broken-image glyph would
  // look worse than no icon. Reset per item so a later good icon can still show.
  const [artFailed, setArtFailed] = useState(false)

  useEffect(() => {
    let live = true
    setQuote(null)
    setArtFailed(false)
    void window.tradewind.getUniqueQuote(league, name, type).then((q) => {
      if (live) setQuote(q)
    })
    return () => {
      live = false
    }
  }, [league, name, type])

  if (!quote) return null

  const denom = toDenominations(quote.priceExalted, quote.rates)
  // Lead with the largest denomination that reads as a whole-ish number.
  const primary: Unit = denom.divine >= 1 ? 'divine' : 'exalted'
  const secondary: Unit[] = (['exalted', 'divine', 'chaos'] as Unit[]).filter((u) => u !== primary)

  const orb = (u: Unit, cls: string): React.JSX.Element | null =>
    currencyIcons[u] ? <img src={currencyIcons[u]} alt="" className={cls} /> : null

  return (
    <div
      className={styles.banner}
      style={{ ['--accent' as string]: RARITY_ACCENT[rarity] ?? 'var(--tw-rarity-unique)' }}
      title="rough poe2scout aggregate — the live search below is the precise, per-roll price"
    >
      {quote.iconUrl && !artFailed && (
        <span className={styles.art}>
          <img
            src={quote.iconUrl}
            alt=""
            className={styles.icon}
            onError={() => setArtFailed(true)}
          />
        </span>
      )}
      <div className={styles.body}>
        <div className={styles.eyebrow}>
          <span className={styles.tag}>{rarity}</span>
          <span className={styles.dot}>◆</span>
          <span className={styles.source}>poe2scout aggregate</span>
        </div>
        <div className={styles.prices}>
          <span className={styles.primary}>
            {orb(primary, styles.orbBig)}
            <span className={styles.amount}>{formatAmount(denom[primary])}</span>
            <span className={styles.unit}>{UNIT_LABEL[primary]}</span>
          </span>
          {secondary.map((u) => (
            <span key={u} className={styles.alt}>
              {orb(u, styles.orb)}
              {formatAmount(denom[u])}
              <span className={styles.unitSm}>{UNIT_LABEL[u]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
