import { useEffect, useReducer, useRef, useState } from 'react'
import { anchorDiverges, formatEstimateRange, formatExalted } from '../../../core/pricing'
import type {
  ListingStatus,
  ModOrigin,
  PreparedEquipmentFilter,
  PreparedFlag,
  PreparedModCount,
  PreparedQuery,
  PreparedRange,
  PreparedStatFilter,
  QuickMode,
  TriState
} from '../../../core/query/types'
import type { SearchOutcome } from '../../../core/trade/types'
import type { TradeListing } from '../../../core/trade/types'
import type { ItemPayload } from '../../../shared/ipc'
import ListingTooltip, { type TooltipAnchor } from './ListingTooltip'
import CurrencyView from './CurrencyView'
import UniqueQuoteBanner from './UniqueQuoteBanner'
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
  ['rare', 'Rare'],
  ['unique', 'Unique']
]

const TRISTATE_OPTIONS: Array<[TriState, string]> = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['any', 'Any']
]

// Buyout-price currency: [trade option id (null = exalted equivalent), menu label].
const BUYOUT_OPTIONS: Array<[string | null, string]> = [
  [null, 'Exalted Orb Equivalent'],
  ['exalted_divine', 'Exalted or Divine Orbs'],
  ['divine', 'Divine Orb'],
  ['chaos', 'Chaos Orb']
]

// Single-orb buyout options → their currency icon id. The exalted-equivalent
// default ("~exalted") and exalted_divine ("exalted / divine") render specially.
// Resolved to GGG-CDN image URLs via payload.currencyIcons.
const BUYOUT_ICON_KEYS: Record<string, string[]> = {
  divine: ['divine'],
  chaos: ['chaos']
}

// Quick-set cycle (issue #16): the stat-row "=" button steps through these,
// writing the matching target into `min`. The glyph is the active-mode indicator;
// '•' marks a hand-typed value sitting off the cycle.
const QUICK_GLYPH: Record<QuickMode, string> = {
  roll: '=',
  tier: 'T',
  smart: '%',
  custom: '•'
}

const QUICK_TITLE: Record<QuickMode, string> = {
  roll: 'Match your roll',
  tier: 'Match tier floor',
  smart: 'Smart default',
  custom: 'Custom value'
}

// Origin tag shown after the affix badge (issue #54): a short glyph colored to
// match the mod's in-game origin color.
const ORIGIN_LABEL: Record<ModOrigin, string> = {
  crafted: 'C',
  desecrated: 'D',
  fractured: 'F',
  enhanced: 'E',
  corruption: 'CE'
}

const ORIGIN_TITLE: Record<ModOrigin, string> = {
  crafted: 'Crafted',
  desecrated: 'Desecrated',
  fractured: 'Fractured',
  enhanced: 'Enhanced',
  corruption: 'Corruption Enhanced'
}

/** Small colored origin tag rendered after a stat's affix badge, or null for an
 *  ordinary roll. */
function originTag(stat: PreparedStatFilter): React.JSX.Element | null {
  if (!stat.origin) return null
  return (
    <span
      className={`${styles.origin} ${styles['origin-' + stat.origin]}`}
      title={ORIGIN_TITLE[stat.origin]}
    >
      {ORIGIN_LABEL[stat.origin]}
    </span>
  )
}

/**
 * The cycling "=" button works on any row carrying the quick-set shape — matched
 * stat rows and derived equipment rows (DPS, defences, aps, crit) alike.
 */
interface QuickRow {
  value: number | null
  tierMin: number | null
  smartMin: number | null
  quickMode: QuickMode
  min: number | null
  max: number | null
  enabled: boolean
}

/** The min value a quick mode targets for this row (null when unavailable). */
function quickTarget(stat: QuickRow, mode: QuickMode): number | null {
  if (mode === 'roll') return stat.value
  if (mode === 'tier') return stat.tierMin
  if (mode === 'smart') return stat.smartMin
  return null
}

/** Next mode in the cycle, skipping "Match Tier" when there's no tier-floor data. */
function nextQuickMode(stat: QuickRow): QuickMode {
  const hasTier = stat.tierMin !== null
  switch (stat.quickMode) {
    case 'roll':
      return hasTier ? 'tier' : 'smart'
    case 'tier':
      return 'smart'
    case 'smart':
      return 'roll'
    default:
      return 'roll' // from a custom edit, restart the cycle
  }
}

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
  /** A derived equipment filter (DPS/defences/aps/crit): renders the cycling
   *  quick-set "=" button instead of the one-shot match-roll fill. */
  cycle?: PreparedEquipmentFilter
  /** Extra behavior after the checkbox flips (e.g. base/category see-saw). */
  onToggle?: () => void
}

/** Funnel glyph for the collapsible Filters header (PoE trade-site style). */
function FunnelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path fill="currentColor" d="M2 3h12L9.3 8v5L6.7 11.6V8z" />
    </svg>
  )
}

// Minimum heights (CSS px) kept for each list when the user drags the results
// resize handle, so neither the stats nor the results list can collapse away.
const MIN_RESULTS = 90
const MIN_STATS = 90

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
  /** Buyout-price popover revealed via the coin toggle (collapsed by default). */
  const [buyoutShown, setBuyoutShown] = useState(false)
  /** Filters changed since the last search — results on screen are stale. */
  const [dirty, setDirty] = useState(false)
  /** The collapsible tri-state flag group (corrupted, mirrored, …). */
  const [flagsOpen, setFlagsOpen] = useState(false)
  /** The collapsible "open modifier slots" count group (issue #22). */
  const [modsOpen, setModsOpen] = useState(false)
  /** The listing whose item tooltip is showing (null when nothing hovered). */
  const [hover, setHover] = useState<TooltipAnchor | null>(null)
  /** Grace timer so the cursor can travel from a row onto its tooltip. */
  const hideTimer = useRef<number | null>(null)

  // Results-list height (CSS px) — the stats list above it flex-fills the rest.
  // Seeded from the persisted value and dragged via the handle above the list.
  const [resultsHeight, setResultsHeight] = useState(payload.resultsHeight)
  // The stats and results lists share the popup's flexible vertical space; refs
  // let the resize clamp keep a minimum for each.
  const filtersRef = useRef<HTMLDivElement>(null)
  const listingsRef = useRef<HTMLDivElement>(null)
  // Resize gesture state, mirroring the window-resize plumbing.
  const resultsDrag = useRef<{ y: number; h: number; combined: number } | null>(null)
  const resultsTarget = useRef<number | null>(null)
  const resultsRaf = useRef<number | null>(null)

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
    setResultsHeight(payload.resultsHeight)
    setOutcome(null)
    setError(null)
    setDirty(false)
    setFlagsOpen(false)
    setModsOpen(false)
    cancelHide()
    setHover(null)
    setLeagueOpen(false)
    setSaleOpen(false)
    setRarityOpen(false)
    setBuyoutShown(false)
    // Currency-exchange items with a snapshot quote render the chart view and
    // never touch the live search path (no listings, no Search button).
    if (payload.currency) {
      forceUpdate()
      return
    }
    // Auto-search only when the query pins the item by name/type (gems,
    // currency, white bases) — those defaults are reliable. A rare with every
    // mod pre-checked rarely has market matches; arm Search instead. Uniques
    // are excluded too (#80): their instant poe2scout aggregate banner is the
    // ballpark, and the rate-limited live search is now a deliberate click.
    if (prepared.current) {
      const isUnique = prepared.current.rarity === 'Unique'
      if (
        !isUnique &&
        (prepared.current.name || prepared.current.type || prepared.current.exchangeId)
      ) {
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
    setBuyoutShown(false)
    setLeagueOpen((o) => !o)
  }

  function openSale(): void {
    setLeagueOpen(false)
    setRarityOpen(false)
    setBuyoutShown(false)
    setSaleOpen((o) => !o)
  }

  function openRarity(): void {
    setLeagueOpen(false)
    setSaleOpen(false)
    setBuyoutShown(false)
    setRarityOpen((o) => !o)
  }

  /** Coin toggle: reveal/hide the buyout-price popover (floats — no layout shift). */
  function toggleBuyout(): void {
    setLeagueOpen(false)
    setSaleOpen(false)
    setRarityOpen(false)
    setBuyoutShown((s) => !s)
  }

  // Click anywhere outside an open dropdown dismisses it.
  useEffect(() => {
    if (!leagueOpen && !saleOpen && !rarityOpen && !buyoutShown) return
    function onDown(e: MouseEvent): void {
      if ((e.target as HTMLElement).closest('[data-picker]')) return
      setLeagueOpen(false)
      setSaleOpen(false)
      setRarityOpen(false)
      setBuyoutShown(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [leagueOpen, saleOpen, rarityOpen, buyoutShown])

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

  function pickBuyout(option: string | null): void {
    if (!prepared.current || prepared.current.buyout.option === option) return
    prepared.current.buyout.option = option
    // Persist the choice (issue #20) so the next price check defaults to it.
    window.tradewind.setBuyoutCurrency(option)
    markDirty()
    forceUpdate()
  }

  /** Buyout min/max price input. */
  function setBuyoutBound(key: 'min' | 'max', event: React.ChangeEvent<HTMLInputElement>): void {
    if (!prepared.current) return
    const raw = event.target.value
    const num = raw === '' ? null : Number(raw)
    prepared.current.buyout[key] = num !== null && Number.isFinite(num) ? num : null
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

  /** Tri-state item flag (corrupted, mirrored, …): yes / no / any. */
  function setFlag(flag: PreparedFlag, state: TriState): void {
    if (flag.state === state) return
    flag.state = state
    markDirty()
    forceUpdate()
  }

  /** One-click "match my roll": write the item's actual value into min (100%
   *  vs the pre-filled spread default), checking the row. */
  function fillExact(target: { min: number | null; enabled: boolean }, value: number | null): void {
    if (value === null) return
    target.min = Math.round(value)
    target.enabled = true
    markDirty()
    forceUpdate()
  }

  /** Advance a row's quick-set mode and write that target into min, checking the
   *  row — the cycling counterpart to fillExact for stat and equipment rows
   *  (issue #16). Keeps two decimals so fractional rolls (aps 1.30, crit 5.00)
   *  survive; integer rolls round clean. */
  function cycleQuick(stat: QuickRow): void {
    const mode = nextQuickMode(stat)
    const target = quickTarget(stat, mode)
    if (target === null) return
    stat.min = Math.round(target * 100) / 100
    stat.quickMode = mode
    stat.enabled = true
    markDirty()
    forceUpdate()
  }

  /** Tooltip describing the active quick-set mode and what one more click does. */
  function quickTitle(stat: QuickRow): string {
    const here = `${QUICK_TITLE[stat.quickMode]}${stat.min !== null ? ` (min ${stat.min})` : ''}`
    const next = nextQuickMode(stat)
    const target = quickTarget(stat, next)
    return `${here} — click for ${QUICK_TITLE[next]}${target !== null ? ` (${Math.round(target)})` : ''}`
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

  /**
   * When a filter input loses focus to anything but another input — clicking the
   * popup body, a button, or back into the game — hand the window's keyboard
   * focus back so PoE2 reclaims it and the player can move again. Without this
   * the overlay keeps focus indefinitely and only Esc frees the game.
   */
  function releaseFocus(event: React.FocusEvent<HTMLInputElement>): void {
    const next = event.relatedTarget as HTMLElement | null
    if (next?.tagName === 'INPUT') return
    window.tradewind.releaseFocus()
  }

  function openOnTradeSite(): void {
    if (outcome) window.tradewind.openUrl(outcome.webUrl)
  }

  // Drag the handle above the results list to set its height; the stats list
  // (flex-fill) takes the rest. Anchored to the bottom — dragging up grows the
  // results — and clamped so both lists keep MIN_* px. Persisted on release
  // (issue #35).
  function onResultsResizeStart(e: React.PointerEvent): void {
    const lst = listingsRef.current
    if (!lst) return
    const combined = lst.offsetHeight + (filtersRef.current?.offsetHeight ?? 0)
    resultsDrag.current = { y: e.clientY, h: lst.offsetHeight, combined }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onResultsResizeMove(e: React.PointerEvent): void {
    const d = resultsDrag.current
    if (!d) return
    const max = Math.max(MIN_RESULTS, d.combined - MIN_STATS)
    const next = Math.min(Math.max(d.h - (e.clientY - d.y), MIN_RESULTS), max)
    resultsTarget.current = Math.round(next)
    if (resultsRaf.current === null) {
      resultsRaf.current = requestAnimationFrame(() => {
        resultsRaf.current = null
        if (resultsTarget.current !== null) setResultsHeight(resultsTarget.current)
      })
    }
  }

  function onResultsResizeEnd(e: React.PointerEvent): void {
    if (!resultsDrag.current) return
    resultsDrag.current = null
    if (resultsRaf.current !== null) {
      cancelAnimationFrame(resultsRaf.current)
      resultsRaf.current = null
    }
    if (resultsTarget.current !== null) {
      setResultsHeight(resultsTarget.current)
      window.tradewind.setResultsHeight(resultsTarget.current)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
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

  /** One checkbox filter row (identity scope or a bounded item property). */
  function renderToggleRow(row: ToggleRow): React.JSX.Element {
    return (
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
        {row.cycle ? (
          // DPS/defences/aps/crit cycle smart ↔ roll like the matched-stat rows.
          renderBounds(row.cycle)
        ) : row.range ? (
          <span className={styles.bounds}>
            <button
              type="button"
              className={styles.fill}
              title={`Match your roll (${Math.round(row.range.value)})`}
              onClick={(e) => {
                e.preventDefault()
                fillExact(row.range!, row.range!.value)
              }}
            >
              =
            </button>
            <input
              className={styles.num}
              type="number"
              placeholder="min"
              value={row.range.min ?? ''}
              onMouseDown={armFocus}
              onBlur={releaseFocus}
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
              onBlur={releaseFocus}
              onChange={(e) => setBound(row.range!, 'max', e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
            />
          </span>
        ) : null}
      </label>
    )
  }

  /** One "open modifier slots" count row (issue #22): a label plus min/max. No
   *  roll value, so no quick-set "=" button — just the bounds (setBound enables
   *  the row when a bound is typed, disables when both clear). */
  function renderModCountRow(m: PreparedModCount): React.JSX.Element {
    return (
      <div key={m.statId} className={`${styles['filter-row']} ${styles['flag-row']}`}>
        <span className={styles.property}>{m.label}</span>
        <span className={styles.bounds}>
          <input
            className={styles.num}
            type="number"
            placeholder="min"
            value={m.min ?? ''}
            onMouseDown={armFocus}
            onBlur={releaseFocus}
            onChange={(e) => setBound(m, 'min', e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
          />
          <input
            className={styles.num}
            type="number"
            placeholder="max"
            value={m.max ?? ''}
            onMouseDown={armFocus}
            onBlur={releaseFocus}
            onChange={(e) => setBound(m, 'max', e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
          />
        </span>
      </div>
    )
  }

  /** Left badge for a stat: P# (red) prefix, S# (blue) suffix, T# tier-only. */
  function statBadge(stat: PreparedStatFilter): { text: string; cls: string } | null {
    if (stat.affix === 'prefix') return { text: `P${stat.tier ?? ''}`, cls: styles.prefix }
    if (stat.affix === 'suffix') return { text: `S${stat.tier ?? ''}`, cls: styles.suffix }
    if (stat.tier !== null) {
      return {
        text: `T${stat.tier}`,
        cls: `${stat.tier === 1 ? styles.top : ''} ${stat.tier === 2 ? styles.good : ''}`
      }
    }
    return null
  }

  /** The "= min max" controls shared by stat rows, hybrid lines, and the derived
   *  equipment rows (DPS/defences/aps/crit). */
  function renderBounds(stat: QuickRow): React.JSX.Element {
    return (
      <span className={styles.bounds}>
        {stat.value !== null && (
          <button
            type="button"
            className={`${styles.fill} ${styles['quick-' + stat.quickMode]}`}
            title={quickTitle(stat)}
            onClick={() => cycleQuick(stat)}
          >
            {QUICK_GLYPH[stat.quickMode]}
          </button>
        )}
        <input
          className={styles.num}
          type="number"
          placeholder="min"
          value={stat.min ?? ''}
          onMouseDown={armFocus}
          onBlur={releaseFocus}
          onChange={(e) => {
            // A hand-typed min steps off the cycle — show the 'custom' dot.
            stat.quickMode = 'custom'
            setBound(stat, 'min', e)
          }}
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
          onBlur={releaseFocus}
          onChange={(e) => setBound(stat, 'max', e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
      </span>
    )
  }

  /** One matched stat filter row. */
  function renderStatRow(stat: PreparedStatFilter): React.JSX.Element {
    const badge = statBadge(stat)
    return (
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
        {badge && <span className={`${styles.tier} ${badge.cls}`}>{badge.text}</span>}
        {originTag(stat)}
        <span className={`${styles.stat} ${styles['source-' + stat.source] ?? ''}`}>
          {stat.label}
        </span>
        {renderBounds(stat)}
      </label>
    )
  }

  /** A hybrid mod (Spell Damage + Mana, …) — one badge and one checkbox toggling
   *  every line, each line keeping its own min/max (searched on its own id). */
  function renderHybridNode(lines: PreparedStatFilter[]): React.JSX.Element {
    const badge = statBadge(lines[0])
    const allOn = lines.every((l) => l.enabled)
    return (
      <label key={'hybrid-' + lines[0].group} className={styles['filter-row']}>
        <input
          type="checkbox"
          checked={allOn}
          onChange={(e) => {
            for (const l of lines) l.enabled = e.target.checked
            markDirty()
            forceUpdate()
          }}
        />
        {badge && <span className={`${styles.tier} ${badge.cls}`}>{badge.text}</span>}
        {originTag(lines[0])}
        <div className={styles['hybrid-lines']}>
          {lines.map((line) => (
            <div key={line.statId + line.label} className={styles['hybrid-line']}>
              <span className={`${styles.stat} ${styles['source-' + line.source] ?? ''}`}>
                {line.label}
              </span>
              {renderBounds(line)}
            </div>
          ))}
        </div>
      </label>
    )
  }

  /** Render an affix group, collapsing consecutive lines of one hybrid mod. */
  function renderRows(rows: PreparedStatFilter[]): React.JSX.Element[] {
    const out: React.JSX.Element[] = []
    for (let i = 0; i < rows.length; ) {
      const g = rows[i].group
      let j = i + 1
      if (g !== undefined) while (j < rows.length && rows[j].group === g) j++
      out.push(j - i > 1 ? renderHybridNode(rows.slice(i, j)) : renderStatRow(rows[i]))
      i = j
    }
    return out
  }

  const q = prepared.current

  const saleLabel = SALE_OPTIONS.find(([id]) => id === q?.status)?.[1] ?? 'Any'
  const rarityLabel = RARITY_OPTIONS.find(([id]) => id === q?.rarityOption)?.[1] ?? 'Any'
  /** A buyout filter is set (bounded or a non-default currency) — light the control. */
  const buyoutActive =
    q != null && (q.buyout.min !== null || q.buyout.max !== null || q.buyout.option !== null)
  /** Collapsed Trade-Filters label: the price summary once bounded, else the name. */
  const buyoutSummary = ((): string => {
    const b = q?.buyout
    if (!b) return 'Trade Filters'
    if (b.min !== null && b.max !== null) return `${b.min}-${b.max}`
    if (b.min !== null) return `Atleast ${b.min}`
    if (b.max !== null) return `Under ${b.max}`
    return 'Trade Filters'
  })()
  /** One buyout-currency orb icon (GGG CDN), or null until the static data loads. */
  const curIcon = (k: string): React.JSX.Element | null => {
    const src = payload.currencyIcons[k]
    return src ? <img key={k} className={styles['cur-icon']} src={src} alt="" /> : null
  }
  /** Shown for any equipment search (incl. uniques) so rarity can be retargeted. */
  const rarityEditable = q?.rarityOption != null

  const baseLabel = q && q.type && q.type !== q.displayName ? q.type : null

  // Identity (category / exact base) and item properties (defences, ilvl,
  // quality) are two visually divided groups; tri-state flags are a third.
  const identityRows: ToggleRow[] = []
  const propertyRows: ToggleRow[] = []
  if (q) {
    // Base and category are two scopes for the same search — exactly one stays
    // on: checking one unchecks the other, unchecking one re-checks the other.
    // Exact base leads (the item's own base); category is the opt-out to the
    // broader scope.
    const base = q.baseTypeFilter
    const cat = q.categoryFilter
    if (cat) {
      identityRows.push({
        label: `Category: ${cat.label}`,
        model: cat,
        onToggle: () => {
          if (base) base.enabled = !cat.enabled
        }
      })
    }
    if (base) {
      identityRows.push({
        label: `Base: ${base.value}`,
        model: base,
        onToggle: () => {
          if (cat) cat.enabled = !base.enabled
        }
      })
    }
    const add = (name: string, r: PreparedRange | null): void => {
      if (r) propertyRows.push({ label: name, model: r, range: r })
    }
    add('Waystone Tier', q.mapTier)
    add('Gem Level', q.gemLevel)
    for (const row of q.equipment) {
      propertyRows.push({ label: row.label, model: row, range: row, cycle: row })
    }
    add('Item Level', q.ilvl)
    add('Quality %', q.quality)
  }

  // Badge on the collapsed Filters header so set flags aren't hidden out of sight.
  const activeFlags = q ? q.flags.filter((f) => f.state !== 'any').length : 0
  // Same, for the bound "open modifier slots" count filters (issue #22).
  const activeModCounts = q ? q.modCounts.filter((m) => m.enabled).length : 0

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
            <ul className="tw-menu" data-overlay>
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

      {payload.currency ? (
        <CurrencyView
          quote={payload.currency}
          league={league}
          currencyIcons={payload.currencyIcons}
        />
      ) : q ? (
        <>
          {/* Uniques lead with an instant poe2scout aggregate ballpark (#80);
              the live search below is the precise, per-roll price. */}
          {q.rarity === 'Unique' && q.name && q.type && (
            <UniqueQuoteBanner
              rarity={q.rarity}
              name={q.name}
              type={q.type}
              league={league}
              currencyIcons={payload.currencyIcons}
            />
          )}
          <div className={`${styles['filter-row']} ${styles['sale-row']}`}>
            <span className="tw-label">Listed</span>
            <div className={styles.picker} data-picker>
              <button className="tw-btn" onClick={openSale}>{saleLabel} ▾</button>
              {saleOpen && (
                <ul className="tw-menu" data-overlay>
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
                    <ul className="tw-menu" data-overlay>
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

          <div className={styles.filters} ref={filtersRef}>
            {identityRows.map(renderToggleRow)}
            {identityRows.length > 0 && propertyRows.length > 0 && (
              <div className={styles.divider} />
            )}
            {propertyRows.map(renderToggleRow)}
            {q.flags.length > 0 && (
              <>
                <div className={styles.divider} />
                <button
                  type="button"
                  className={styles['flags-header']}
                  onClick={() => setFlagsOpen((o) => !o)}
                  aria-expanded={flagsOpen}
                >
                  <FunnelIcon />
                  <span className={styles['flags-title']}>Miscellaneous</span>
                  {activeFlags > 0 && <span className={styles['flags-count']}>{activeFlags}</span>}
                  <span className={styles.chevron}>{flagsOpen ? '▾' : '▸'}</span>
                </button>
                {flagsOpen &&
                  q.flags.map((flag) => (
                    <div key={flag.key} className={`${styles['filter-row']} ${styles['flag-row']}`}>
                      <span className={styles.property}>{flag.label}</span>
                      <span className={styles.tristate}>
                        {TRISTATE_OPTIONS.map(([val, label]) => (
                          <button
                            key={val}
                            className={flag.state === val ? styles.active : ''}
                            onClick={() => setFlag(flag, val)}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                {(q.modCounts.length > 0 || q.stats.length > 0 || q.unmatched.length > 0) && (
                  <div className={styles.divider} />
                )}
              </>
            )}
            {/* Open-affix-slot counts (issue #22): rares/magic only. The flags
                block always precedes it on such items, so it owns the divider
                above; this section owns the divider below it. */}
            {q.modCounts.length > 0 && (
              <>
                <button
                  type="button"
                  className={styles['flags-header']}
                  onClick={() => setModsOpen((o) => !o)}
                  aria-expanded={modsOpen}
                >
                  <FunnelIcon />
                  <span className={styles['flags-title']}>Open Modifier Slots</span>
                  {activeModCounts > 0 && (
                    <span className={styles['flags-count']}>{activeModCounts}</span>
                  )}
                  <span className={styles.chevron}>{modsOpen ? '▾' : '▸'}</span>
                </button>
                {modsOpen && q.modCounts.map(renderModCountRow)}
                {(q.stats.length > 0 || q.unmatched.length > 0) && (
                  <div className={styles.divider} />
                )}
              </>
            )}
            {/* Grouped by affix: prefixes then suffixes (one contiguous block),
                then a divider before the tier-less rows (implicits/runes/
                enchants/pseudo totals). */}
            {(() => {
              const prefixes = q.stats.filter((s) => s.affix === 'prefix')
              const suffixes = q.stats.filter((s) => s.affix === 'suffix')
              const others = q.stats.filter((s) => s.affix === null)
              return (
                <>
                  {renderRows(prefixes)}
                  {renderRows(suffixes)}
                  {others.length > 0 && prefixes.length + suffixes.length > 0 && (
                    <div className={styles.divider} />
                  )}
                  {renderRows(others)}
                </>
              )
            })()}
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
              <span className={styles.buyout} data-picker>
                <button
                  type="button"
                  className={`${styles['trade-btn']} ${buyoutActive ? styles.active : ''}`}
                  onClick={toggleBuyout}
                  title={buyoutShown ? 'Hide buyout price' : 'Buyout price filter'}
                  aria-expanded={buyoutShown}
                >
                  <span className={styles['trade-label']}>{buyoutSummary}</span>
                  {q.buyout.option === null ? (
                    <span className={styles['cur-set']}>~{curIcon('exalted')}</span>
                  ) : q.buyout.option === 'exalted_divine' ? (
                    <span className={styles['cur-set']}>
                      {curIcon('exalted')}
                      <span className={styles['cur-slash']}>/</span>
                      {curIcon('divine')}
                    </span>
                  ) : (
                    (BUYOUT_ICON_KEYS[q.buyout.option] ?? []).map((k) => curIcon(k))
                  )}
                </button>
                {buyoutShown && (
                  <div className={styles['buyout-pop']} data-overlay>
                    <div className={styles['buyout-head']}>Buyout price</div>
                    <div className={styles['buyout-inputs']}>
                      <input
                        className={styles.num}
                        type="number"
                        placeholder="min"
                        value={q.buyout.min ?? ''}
                        onMouseDown={armFocus}
              onBlur={releaseFocus}
                        onChange={(e) => setBuyoutBound('min', e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runSearch()
                        }}
                      />
                      <input
                        className={styles.num}
                        type="number"
                        placeholder="max"
                        value={q.buyout.max ?? ''}
                        onMouseDown={armFocus}
              onBlur={releaseFocus}
                        onChange={(e) => setBuyoutBound('max', e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runSearch()
                        }}
                      />
                    </div>
                    <ul className={styles['buyout-cur']}>
                      {BUYOUT_OPTIONS.map(([id, label]) => (
                        <li key={id ?? 'eq'}>
                          <button
                            className={id === q.buyout.option ? styles['cur-active'] : ''}
                            onClick={() => pickBuyout(id)}
                          >
                            {label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </span>
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
            <div
              className={styles['results-resize']}
              onPointerDown={onResultsResizeStart}
              onPointerMove={onResultsResizeMove}
              onPointerUp={onResultsResizeEnd}
              onPointerCancel={onResultsResizeEnd}
              title="Drag to resize results"
              aria-hidden="true"
            />
          )}

          {outcome && outcome.listings.length > 0 && (
            <div className={styles.listings} ref={listingsRef} style={{ height: resultsHeight + 'px' }}>
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
