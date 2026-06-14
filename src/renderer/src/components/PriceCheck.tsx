import { useEffect, useReducer, useRef, useState } from 'react'
import { anchorDiverges, formatEstimateRange, formatExalted } from '../../../core/pricing'
import type { ListingStatus, PreparedQuery, PreparedRange } from '../../../core/query/types'
import type { SearchOutcome } from '../../../core/trade/types'
import type { TradeListing } from '../../../core/trade/types'
import type { ItemPayload } from '../../../shared/ipc'
import ListingTooltip, { type TooltipAnchor } from './ListingTooltip'
import styles from './PriceCheck.module.css'

const SALE_OPTIONS: Array<[ListingStatus, string]> = [
  ['securable', 'Instant Buyout'],
  ['available', 'Instant + In Person'],
  ['online', 'In Person (Online)'],
  ['any', 'Any']
]

const RARITY_OPTIONS: Array<[string, string]> = [
  ['nonunique', 'Any Non-Unique'],
  ['normal', 'Normal'],
  ['magic', 'Magic'],
  ['rare', 'Rare']
]

interface Bounded {
  min: number | null
  max: number | null
  enabled: boolean
}

interface ToggleRow {
  label: string
  model: { enabled: boolean }
  /** Present when the row has editable min/max bounds. */
  range?: PreparedRange
  /** Extra behavior after the checkbox flips (e.g. base/category see-saw). */
  onToggle?: () => void
}

function age(iso: string): string {
  const mins = Math.max(0, (Date.now() - Date.parse(iso)) / 60000)
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

export default function PriceCheck({ payload }: { payload: ItemPayload }): React.JSX.Element {
  // The popup deep-mutates this editable doc in place (checkboxes, bounds, the
  // base/category see-saw) and ships a clone over IPC; a ref + forceUpdate keeps
  // those mutation handlers a faithful port of the Vue `prepared` ref.
  const prepared = useRef<PreparedQuery | null>(null)
  const searchToken = useRef(0)
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  const [league, setLeague] = useState('')
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)
  const [rarityOpen, setRarityOpen] = useState(false)
  /** Filters changed since the last search — results on screen are stale. */
  const [dirty, setDirty] = useState(false)
  /** The listing whose item tooltip is showing (null when nothing hovered). */
  const [hover, setHover] = useState<TooltipAnchor | null>(null)
  /** Grace timer so the cursor can travel from a row onto its tooltip. */
  const hideTimer = useRef<number | null>(null)

  function cancelHide(): void {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  /** Hide after a beat — cancelled if the cursor lands on the tooltip or a row. */
  function scheduleHide(): void {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setHover(null), 140)
  }

  useEffect(() => cancelHide, [])

  /** Edits never auto-search (rate-limit budget is precious) — they arm the Search button. */
  function markDirty(): void {
    setDirty(true)
  }

  async function runSearch(): Promise<void> {
    if (!prepared.current) return
    const token = ++searchToken.current
    setSearching(true)
    setDirty(false)
    setError(null)
    cancelHide()
    setHover(null)
    try {
      const result = await window.tradewind.search(
        JSON.parse(JSON.stringify(prepared.current)) as PreparedQuery
      )
      if (token !== searchToken.current) return
      setOutcome(result)
    } catch (err) {
      if (token !== searchToken.current) return
      setOutcome(null)
      // Strip Electron's IPC wrapper ("Error invoking remote method 'tw:search': ...").
      setError(
        (err instanceof Error ? err.message : String(err)).replace(
          /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
          ''
        )
      )
    } finally {
      if (token === searchToken.current) setSearching(false)
    }
  }

  useEffect(() => {
    // Deep-copy: the popup edits filters freely, IPC needs a plain object anyway.
    prepared.current = payload.prepared
      ? (JSON.parse(JSON.stringify(payload.prepared)) as PreparedQuery)
      : null
    setLeague(payload.league)
    setOutcome(null)
    setError(null)
    setDirty(false)
    cancelHide()
    setHover(null)
    setLeagueOpen(false)
    setSaleOpen(false)
    setRarityOpen(false)
    // Auto-search only when the query pins the item by name/type (uniques,
    // gems, currency, white bases) — those defaults are reliable. A rare with
    // every mod pre-checked rarely has market matches; arm Search instead.
    if (prepared.current) {
      if (prepared.current.name || prepared.current.type || prepared.current.exchangeId) {
        void runSearch()
      } else {
        setDirty(true)
      }
    } else {
      forceUpdate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // Opening one dropdown closes the others; clicking the button again toggles it.
  function openLeague(): void {
    setSaleOpen(false)
    setRarityOpen(false)
    setLeagueOpen((o) => !o)
  }

  function openSale(): void {
    setLeagueOpen(false)
    setRarityOpen(false)
    setSaleOpen((o) => !o)
  }

  function openRarity(): void {
    setLeagueOpen(false)
    setSaleOpen(false)
    setRarityOpen((o) => !o)
  }

  // Click anywhere outside an open dropdown dismisses it.
  useEffect(() => {
    if (!leagueOpen && !saleOpen && !rarityOpen) return
    function onDown(e: MouseEvent): void {
      if ((e.target as HTMLElement).closest('[data-picker]')) return
      setLeagueOpen(false)
      setSaleOpen(false)
      setRarityOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [leagueOpen, saleOpen, rarityOpen])

  function pickSale(id: ListingStatus): void {
    setSaleOpen(false)
    if (!prepared.current || prepared.current.status === id) return
    prepared.current.status = id
    markDirty()
    forceUpdate()
  }

  function pickRarity(id: string): void {
    setRarityOpen(false)
    if (!prepared.current || prepared.current.rarityOption === id) return
    prepared.current.rarityOption = id
    markDirty()
    forceUpdate()
  }

  function pickLeague(id: string): void {
    setLeagueOpen(false)
    if (id === league) return
    setLeague(id)
    void window.tradewind.setLeague(id)
    markDirty()
  }

  /** Typing a bound checks the row; clearing both bounds unchecks it. */
  function setBound(range: Bounded, key: 'min' | 'max', event: React.ChangeEvent<HTMLInputElement>): void {
    const raw = event.target.value
    const num = raw === '' ? null : Number(raw)
    range[key] = num !== null && Number.isFinite(num) ? num : null
    range.enabled = range.min !== null || range.max !== null
    markDirty()
    forceUpdate()
  }

  /**
   * The overlay window is non-focusable until an input is clicked, so typing
   * works without ordinary clicks ever stealing focus from the game. Focus the
   * input again once the window can actually hold it.
   */
  function armFocus(event: React.MouseEvent<HTMLInputElement>): void {
    window.tradewind.requestFocus()
    const el = event.currentTarget
    window.setTimeout(() => el.focus(), 80)
  }

  function openOnTradeSite(): void {
    if (outcome) window.tradewind.openUrl(outcome.webUrl)
  }

  /** Anchor the item tooltip beside the hovered row — left of the popup when
   *  there's room, otherwise to its right. */
  function onRowEnter(event: React.MouseEvent<HTMLDivElement>, l: TradeListing): void {
    cancelHide()
    if (!l.item) return setHover(null)
    const r = event.currentTarget.getBoundingClientRect()
    // Prefer the right of the popup; flip left only when the panel won't fit.
    const PANEL = 288
    const placeLeft = window.innerWidth - r.right < PANEL && r.left >= PANEL
    setHover({
      item: l.item,
      top: r.top,
      edge: placeLeft ? window.innerWidth - r.left + 8 : r.right + 8,
      placeLeft
    })
  }

  const q = prepared.current

  const saleLabel = SALE_OPTIONS.find(([id]) => id === q?.status)?.[1] ?? 'Any'
  const rarityLabel = RARITY_OPTIONS.find(([id]) => id === q?.rarityOption)?.[1] ?? 'Any'
  /** Shown for equipment searches so a base can be checked across rarities. */
  const rarityEditable = q?.rarityOption != null && q.rarityOption !== 'unique'

  const baseLabel = q && q.type && q.type !== q.displayName ? q.type : null

  const propertyRows: ToggleRow[] = []
  if (q) {
    // Base and category are two scopes for the same search — exactly one stays
    // on: checking one unchecks the other, unchecking one re-checks the other.
    const base = q.baseTypeFilter
    const cat = q.categoryFilter
    if (base) {
      propertyRows.push({
        label: `Base: ${base.value}`,
        model: base,
        onToggle: () => {
          if (cat) cat.enabled = !base.enabled
        }
      })
    }
    if (cat) {
      propertyRows.push({
        label: `Category: ${cat.label}`,
        model: cat,
        onToggle: () => {
          if (base) base.enabled = !cat.enabled
        }
      })
    }
    const add = (name: string, r: PreparedRange | null): void => {
      if (r) propertyRows.push({ label: name, model: r, range: r })
    }
    add('Waystone Tier', q.mapTier)
    add('Gem Level', q.gemLevel)
    for (const row of q.equipment) add(row.label, row)
    add('Item Level', q.ilvl)
    add('Quality %', q.quality)
    if (q.corrupted) {
      propertyRows.push({
        label: q.corrupted.value ? 'Corrupted' : 'Not Corrupted',
        model: q.corrupted
      })
    }
  }

  const est = outcome?.estimate
  let estimateDetail = ''
  if (est) {
    const parts = [
      `${est.confidence} confidence`,
      `${est.sampleSize} of ${est.total}${outcome?.inexact ? '+' : ''}`
    ]
    if (est.excludedLowball > 0) {
      parts.push(`${est.excludedLowball} lowball${est.excludedLowball > 1 ? 's' : ''} skipped`)
    }
    estimateDetail = parts.join(' · ')
  }

  return (
    <div className={styles['price-check']}>
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={`${styles.name} ${styles['rarity-' + (q?.rarity ?? 'Unknown').toLowerCase()] ?? ''}`}>
            {q?.displayName ?? 'Item'}
          </span>
          {baseLabel && <span className={styles.base}>{baseLabel}</span>}
          <span className={styles['item-class']}>{q?.itemClass}</span>
        </div>
        <div className={styles.picker} data-picker>
          <button className="tw-btn" onClick={openLeague}>{league} ▾</button>
          {leagueOpen && (
            <ul className="tw-menu">
              {payload.leagues.map((id) => (
                <li key={id}>
                  <button className={id === league ? 'active' : ''} onClick={() => pickLeague(id)}>
                    {id}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {q ? (
        <>
          <div className={`${styles['filter-row']} ${styles['sale-row']}`}>
            <span className="tw-label">Listed</span>
            <div className={styles.picker} data-picker>
              <button className="tw-btn" onClick={openSale}>{saleLabel} ▾</button>
              {saleOpen && (
                <ul className="tw-menu">
                  {SALE_OPTIONS.map(([id, label]) => (
                    <li key={id}>
                      <button className={id === q.status ? 'active' : ''} onClick={() => pickSale(id)}>
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {rarityEditable && (
              <>
                <span className={`tw-label ${styles['rarity-label']}`}>Rarity</span>
                <div className={styles.picker} data-picker>
                  <button className="tw-btn" onClick={openRarity}>
                    {rarityLabel} ▾
                  </button>
                  {rarityOpen && (
                    <ul className="tw-menu">
                      {RARITY_OPTIONS.map(([id, label]) => (
                        <li key={id}>
                          <button
                            className={id === q.rarityOption ? 'active' : ''}
                            onClick={() => pickRarity(id)}
                          >
                            {label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          <div className={styles.filters}>
            {propertyRows.map((row) => (
              <label key={row.label} className={styles['filter-row']}>
                <input
                  type="checkbox"
                  checked={row.model.enabled}
                  onChange={(e) => {
                    row.model.enabled = e.target.checked
                    row.onToggle?.()
                    markDirty()
                    forceUpdate()
                  }}
                />
                <span className={styles.property}>{row.label}</span>
                {row.range && <span className={styles.val}>{row.range.value}</span>}
                {row.range && (
                  <span className={styles.bounds}>
                    <input
                      className={styles.num}
                      type="number"
                      placeholder="min"
                      value={row.range.min ?? ''}
                      onMouseDown={armFocus}
                      onChange={(e) => setBound(row.range!, 'min', e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runSearch()
                      }}
                    />
                    <input
                      className={styles.num}
                      type="number"
                      placeholder="max"
                      value={row.range.max ?? ''}
                      onMouseDown={armFocus}
                      onChange={(e) => setBound(row.range!, 'max', e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runSearch()
                      }}
                    />
                  </span>
                )}
              </label>
            ))}
            {q.stats.map((stat) => (
              <label key={stat.statId + stat.label} className={styles['filter-row']}>
                <input
                  type="checkbox"
                  checked={stat.enabled}
                  onChange={(e) => {
                    stat.enabled = e.target.checked
                    markDirty()
                    forceUpdate()
                  }}
                />
                {stat.tier !== null && (
                  <span
                    className={`${styles.tier} ${stat.tier === 1 ? styles.top : ''} ${
                      stat.tier === 2 ? styles.good : ''
                    }`}
                  >
                    T{stat.tier}
                  </span>
                )}
                <span className={`${styles.stat} ${styles['source-' + stat.source] ?? ''}`}>
                  {stat.label}
                </span>
                <span className={styles.bounds}>
                  <input
                    className={styles.num}
                    type="number"
                    placeholder="min"
                    value={stat.min ?? ''}
                    onMouseDown={armFocus}
                    onChange={(e) => setBound(stat, 'min', e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch()
                    }}
                  />
                  <input
                    className={styles.num}
                    type="number"
                    placeholder="max"
                    value={stat.max ?? ''}
                    onMouseDown={armFocus}
                    onChange={(e) => setBound(stat, 'max', e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch()
                    }}
                  />
                </span>
              </label>
            ))}
            {q.unmatched.map((line) => (
              <div key={line} className={`${styles['filter-row']} ${styles.unmatched}`}>
                <span className={styles.badge}>?</span>
                <span>{line}</span>
              </div>
            ))}
          </div>

          {outcome?.estimate && !searching && (
            <div className={`${styles.estimate} ${dirty ? styles.stale : ''}`}>
              {anchorDiverges(outcome.estimate) ? (
                <>
                  {/* Every ask is far from the going rate — the rate is the honest headline. */}
                  <span className={styles['est-range']}>
                    ≈ {formatExalted(outcome.estimate.anchorExalted!, outcome.estimate.divineRate)}
                  </span>
                  <span className={styles['est-market']} title="aggregate market rate (poe2scout)">
                    market rate
                  </span>
                  <span className={`${styles['est-conf']} ${styles['conf-' + outcome.estimate.confidence]}`}>
                    ◆
                  </span>
                  <span className={styles['est-detail']}>
                    asks here {formatEstimateRange(outcome.estimate)} · {estimateDetail}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles['est-range']}>≈ {formatEstimateRange(outcome.estimate)}</span>
                  <span className={`${styles['est-conf']} ${styles['conf-' + outcome.estimate.confidence]}`}>
                    ◆
                  </span>
                  <span className={styles['est-detail']}>{estimateDetail}</span>
                  {/* Site asks and the aggregate bracket the true price from
                      opposite sides — show both, the reader triangulates. */}
                  {outcome.estimate.anchorExalted !== undefined && (
                    <span
                      className={styles['est-market']}
                      title="aggregate market rate (poe2scout) — real trades usually land between this and the asks"
                    >
                      ref ~{formatExalted(outcome.estimate.anchorExalted, outcome.estimate.divineRate)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          <div className={styles.status}>
            {searching ? (
              <span className={styles.busy}>searching…</span>
            ) : error ? (
              <span className={styles.error}>{error}</span>
            ) : dirty && !outcome ? (
              <span className={styles.none}>pick filters, then Search</span>
            ) : dirty ? (
              <span className={styles.none}>filters changed</span>
            ) : outcome ? (
              outcome.total === 0 ? (
                <span className={styles.none}>No listings match — try unchecking filters</span>
              ) : (
                <span>
                  {outcome.total}
                  {outcome.inexact ? '+' : ''} listed · showing {outcome.listings.length}
                </span>
              )
            ) : null}
            <span className={styles.actions}>
              {!searching && (
                <button
                  className={`tw-btn ${styles['search-btn']} ${dirty ? styles.armed : ''}`}
                  onClick={runSearch}
                >
                  Search
                </button>
              )}
              {outcome && !searching && (
                <button className="tw-btn" onClick={openOnTradeSite}>
                  trade site ↗
                </button>
              )}
            </span>
          </div>

          {outcome && outcome.listings.length > 0 && (
            <div className={styles.listings}>
              {outcome.listings.map((l) => (
                <div
                  key={l.id}
                  className={`${styles.listing} ${l.item ? styles.hoverable : ''} ${
                    l.unpriceable ? styles.unpriceable : ''
                  } ${l.lowball ? styles.lowball : ''}`}
                  title={
                    l.lowball
                      ? 'far below the going rate — likely bait, not in the estimate'
                      : l.unpriceable
                        ? 'currency not in the estimate'
                        : undefined
                  }
                  onMouseEnter={(e) => onRowEnter(e, l)}
                  onMouseLeave={scheduleHide}
                >
                  <span className={styles.price}>
                    {l.price ? `${l.price.amount} ${l.price.currency}` : '—'}
                  </span>
                  {l.stock !== undefined && <span className={styles.stock}>×{l.stock}</span>}
                  <span className={styles.seller}>{l.accountName}</span>
                  <span className={styles.age}>{age(l.indexed)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <pre className={styles.raw}>{payload.text}</pre>
          <div className={styles['no-item']}>stat database still loading — raw view</div>
        </>
      )}

      {hover && (
        <ListingTooltip anchor={hover} onMouseEnter={cancelHide} onMouseLeave={scheduleHide} />
      )}
    </div>
  )
}
