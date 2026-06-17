import { useEffect, useState } from 'react'
import {
  formatAmount,
  formatTrend,
  liquidityOf,
  priceTrend,
  toDenominations,
  type CurrencyPoint,
  type CurrencyQuote
} from '../../../core/exchange'
import PriceChart from './PriceChart'
import styles from './CurrencyView.module.css'

const UNIT_LABEL = { exalted: 'ex', divine: 'div', chaos: 'chaos' } as const
type Unit = keyof typeof UNIT_LABEL

/** Span of the history in a coarse human label: "(18h)", "(2d)". */
function spanLabel(history: CurrencyPoint[]): string {
  if (history.length < 2) return ''
  const ms = new Date(history[history.length - 1].time).getTime() - new Date(history[0].time).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const hours = Math.round(ms / 3_600_000)
  return hours >= 48 ? `(${Math.round(hours / 24)}d)` : `(${hours}h)`
}

/**
 * Currency-exchange view: an item that trades on the in-game Currency Exchange
 * has one aggregate price (no rolls, no live order book), so instead of the
 * search UI we show the price in all three denominations plus a price/volume
 * chart. History streams in after mount so the price shows instantly.
 */
export default function CurrencyView({
  quote: seed,
  league,
  currencyIcons
}: {
  quote: CurrencyQuote
  league: string
  currencyIcons: Record<string, string>
}): React.JSX.Element {
  // Seeded from the payload quote (resolved for the original league) so the
  // price paints instantly; re-resolved when the user switches league.
  const [quote, setQuote] = useState<CurrencyQuote>(seed)
  const [history, setHistory] = useState<CurrencyPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setQuote(seed)
  }, [seed])

  useEffect(() => {
    let live = true
    setLoading(true)
    setHistory([])
    // Refresh the quote for this league (seed already covers the first paint),
    // then stream in the chart history.
    void window.tradewind.getCurrencyQuote(league, seed.apiId).then((q) => {
      if (live && q) setQuote(q)
    })
    window.tradewind
      .getCurrencyHistory(league, seed.apiId)
      .then((points) => {
        if (live) setHistory(points)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [league, seed.apiId])

  const denom = toDenominations(quote.priceExalted, quote.rates)
  // Lead with the largest denomination that reads as a whole-ish number.
  const primary: Unit = denom.divine >= 1 ? 'divine' : 'exalted'
  const secondary: Unit[] = (['exalted', 'divine', 'chaos'] as Unit[]).filter((u) => u !== primary)

  const trend = priceTrend(history)
  const trendCls = trend > 0 ? styles.up : trend < 0 ? styles.down : styles.flat
  const liquidity = liquidityOf(history)

  const formatChartValue = (exalted: number): string =>
    primary === 'divine' ? formatAmount(exalted / quote.rates.divine) : formatAmount(exalted)

  return (
    <div className={styles.view}>
      <div className={styles.head}>
        <div className={styles.primary}>
          {currencyIcons[primary] && <img src={currencyIcons[primary]} alt="" className={styles.orbBig} />}
          <span className={styles.amount}>{formatAmount(denom[primary])}</span>
          <span className={styles.unit}>{UNIT_LABEL[primary]}</span>
        </div>
        {history.length >= 2 && (
          <div className={`${styles.trend} ${trendCls}`}>
            <span className={styles.arrow}>{trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}</span>
            {formatTrend(trend)} <span className={styles.span}>{spanLabel(history)}</span>
          </div>
        )}
      </div>

      <div className={styles.secondary}>
        {secondary.map((u) => (
          <span key={u} className={styles.alt}>
            {currencyIcons[u] && <img src={currencyIcons[u]} alt="" className={styles.orb} />}
            {formatAmount(denom[u])} {UNIT_LABEL[u]}
          </span>
        ))}
      </div>

      {loading && history.length === 0 ? (
        <div className={styles.loading}>loading history…</div>
      ) : (
        <PriceChart points={history} formatValue={formatChartValue} />
      )}

      <div className={styles.foot}>
        <span className={`${styles.liq} ${styles['liq-' + liquidity]}`}>
          liquidity: {liquidity}
        </span>
        <span className={styles.dot}>·</span>
        <span>6h aggregate</span>
        <span className={styles.dot}>·</span>
        <span>poe2scout</span>
      </div>
    </div>
  )
}
