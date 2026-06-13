<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { anchorDiverges, formatEstimateRange, formatExalted } from '../../../core/pricing'
import type { ListingStatus, PreparedQuery, PreparedRange } from '../../../core/query/types'
import type { SearchOutcome } from '../../../core/trade/types'
import type { ItemPayload } from '../../../shared/ipc'

const props = defineProps<{ payload: ItemPayload }>()

const prepared = ref<PreparedQuery | null>(null)
const league = ref('')
const outcome = ref<SearchOutcome | null>(null)
const searching = ref(false)
const error = ref<string | null>(null)
const leagueOpen = ref(false)
const saleOpen = ref(false)

const SALE_OPTIONS: Array<[ListingStatus, string]> = [
  ['securable', 'Instant Buyout'],
  ['available', 'Instant + In Person'],
  ['online', 'In Person (Online)'],
  ['any', 'Any']
]

const saleLabel = computed(
  () => SALE_OPTIONS.find(([id]) => id === prepared.value?.status)?.[1] ?? 'Any'
)

function pickSale(id: ListingStatus): void {
  saleOpen.value = false
  if (!prepared.value || prepared.value.status === id) return
  prepared.value.status = id
  markDirty()
}

const rarityOpen = ref(false)

const RARITY_OPTIONS: Array<[string, string]> = [
  ['nonunique', 'Any Non-Unique'],
  ['normal', 'Normal'],
  ['magic', 'Magic'],
  ['rare', 'Rare']
]

const rarityLabel = computed(
  () => RARITY_OPTIONS.find(([id]) => id === prepared.value?.rarityOption)?.[1] ?? 'Any'
)

/** Shown for equipment searches so a base can be checked across rarities. */
const rarityEditable = computed(
  () => prepared.value?.rarityOption != null && prepared.value.rarityOption !== 'unique'
)

function pickRarity(id: string): void {
  rarityOpen.value = false
  if (!prepared.value || prepared.value.rarityOption === id) return
  prepared.value.rarityOption = id
  markDirty()
}
/** Filters changed since the last search — results on screen are stale. */
const dirty = ref(false)
let searchToken = 0

watch(
  () => props.payload,
  (p) => {
    // Deep-copy: the popup edits filters freely, IPC needs a plain object anyway.
    prepared.value = p.prepared ? (JSON.parse(JSON.stringify(p.prepared)) as PreparedQuery) : null
    league.value = p.league
    outcome.value = null
    error.value = null
    dirty.value = false
    leagueOpen.value = false
    saleOpen.value = false
    rarityOpen.value = false
    // Auto-search only when the query pins the item by name/type (uniques,
    // gems, currency, white bases) — those defaults are reliable. A rare with
    // every mod pre-checked rarely has market matches; arm Search instead.
    if (prepared.value) {
      if (prepared.value.name || prepared.value.type || prepared.value.exchangeId) {
        void runSearch()
      } else {
        dirty.value = true
      }
    }
  },
  { immediate: true }
)

async function runSearch(): Promise<void> {
  if (!prepared.value) return
  const token = ++searchToken
  searching.value = true
  dirty.value = false
  error.value = null
  try {
    const result = await window.tradewind.search(
      JSON.parse(JSON.stringify(prepared.value)) as PreparedQuery
    )
    if (token !== searchToken) return
    outcome.value = result
  } catch (err) {
    if (token !== searchToken) return
    outcome.value = null
    // Strip Electron's IPC wrapper ("Error invoking remote method 'tw:search': ...").
    error.value = (err instanceof Error ? err.message : String(err)).replace(
      /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
      ''
    )
  } finally {
    if (token === searchToken) searching.value = false
  }
}

/** Edits never auto-search (rate-limit budget is precious) — they arm the Search button. */
function markDirty(): void {
  dirty.value = true
}

function pickLeague(id: string): void {
  leagueOpen.value = false
  if (id === league.value) return
  league.value = id
  void window.tradewind.setLeague(id)
  markDirty()
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
  /** Extra behavior after the checkbox flips (e.g. base/category see-saw). */
  onToggle?: () => void
}

const propertyRows = computed<ToggleRow[]>(() => {
  const q = prepared.value
  if (!q) return []
  const rows: ToggleRow[] = []
  // Base and category are two scopes for the same search — exactly one stays
  // on: checking one unchecks the other, unchecking one re-checks the other.
  const base = q.baseTypeFilter
  const cat = q.categoryFilter
  if (base) {
    rows.push({
      label: `Base: ${base.value}`,
      model: base,
      onToggle: () => {
        if (cat) cat.enabled = !base.enabled
      }
    })
  }
  if (cat) {
    rows.push({
      label: `Category: ${cat.label}`,
      model: cat,
      onToggle: () => {
        if (base) base.enabled = !cat.enabled
      }
    })
  }
  const add = (name: string, r: PreparedRange | null): void => {
    if (r) rows.push({ label: name, model: r, range: r })
  }
  add('Waystone Tier', q.mapTier)
  add('Gem Level', q.gemLevel)
  for (const row of q.equipment) add(row.label, row)
  add('Item Level', q.ilvl)
  add('Quality %', q.quality)
  if (q.corrupted) {
    rows.push({ label: q.corrupted.value ? 'Corrupted' : 'Not Corrupted', model: q.corrupted })
  }
  return rows
})

const baseLabel = computed(() => {
  const q = prepared.value
  if (!q) return null
  if (q.type && q.type !== q.displayName) return q.type
  return null
})

/** Typing a bound checks the row; clearing both bounds unchecks it. */
function setBound(range: Bounded, key: 'min' | 'max', event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const num = raw === '' ? null : Number(raw)
  range[key] = num !== null && Number.isFinite(num) ? num : null
  range.enabled = range.min !== null || range.max !== null
  markDirty()
}

/**
 * The overlay window is non-focusable until an input is clicked, so typing
 * works without ordinary clicks ever stealing focus from the game. Focus the
 * input again once the window can actually hold it.
 */
function armFocus(event: MouseEvent): void {
  window.tradewind.requestFocus()
  const el = event.currentTarget as HTMLInputElement
  window.setTimeout(() => el.focus(), 80)
}

function openOnTradeSite(): void {
  if (outcome.value) window.tradewind.openUrl(outcome.value.webUrl)
}

const estimateDetail = computed(() => {
  const est = outcome.value?.estimate
  if (!est) return ''
  const parts = [
    `${est.confidence} confidence`,
    `${est.sampleSize} of ${est.total}${outcome.value?.inexact ? '+' : ''}`
  ]
  if (est.excludedLowball > 0) {
    parts.push(`${est.excludedLowball} lowball${est.excludedLowball > 1 ? 's' : ''} skipped`)
  }
  return parts.join(' · ')
})

function age(iso: string): string {
  const mins = Math.max(0, (Date.now() - Date.parse(iso)) / 60000)
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}
</script>

<template>
  <div class="price-check">
    <div class="header">
      <div class="title">
        <span class="name" :class="'rarity-' + (prepared?.rarity ?? 'Unknown').toLowerCase()">
          {{ prepared?.displayName ?? 'Item' }}
        </span>
        <span v-if="baseLabel" class="base">{{ baseLabel }}</span>
        <span class="item-class">{{ prepared?.itemClass }}</span>
      </div>
      <div class="picker">
        <button class="tw-btn" @click="leagueOpen = !leagueOpen">{{ league }} ▾</button>
        <ul v-if="leagueOpen" class="tw-menu">
          <li v-for="id in payload.leagues" :key="id">
            <button :class="{ active: id === league }" @click="pickLeague(id)">{{ id }}</button>
          </li>
        </ul>
      </div>
    </div>

    <template v-if="prepared">
      <div class="filter-row sale-row">
        <span class="tw-label">Listed</span>
        <div class="picker">
          <button class="tw-btn" @click="saleOpen = !saleOpen">{{ saleLabel }} ▾</button>
          <ul v-if="saleOpen" class="tw-menu">
            <li v-for="[id, label] in SALE_OPTIONS" :key="id">
              <button :class="{ active: id === prepared.status }" @click="pickSale(id)">
                {{ label }}
              </button>
            </li>
          </ul>
        </div>
        <template v-if="rarityEditable">
          <span class="tw-label rarity-label">Rarity</span>
          <div class="picker">
            <button class="tw-btn" @click="rarityOpen = !rarityOpen">{{ rarityLabel }} ▾</button>
            <ul v-if="rarityOpen" class="tw-menu">
              <li v-for="[id, label] in RARITY_OPTIONS" :key="id">
                <button :class="{ active: id === prepared.rarityOption }" @click="pickRarity(id)">
                  {{ label }}
                </button>
              </li>
            </ul>
          </div>
        </template>
      </div>
      <div class="filters">
        <label v-for="row in propertyRows" :key="row.label" class="filter-row">
          <input
            v-model="row.model.enabled"
            type="checkbox"
            @change="row.onToggle?.(), markDirty()"
          />
          <span class="property">{{ row.label }}</span>
          <span v-if="row.range" class="val">{{ row.range.value }}</span>
          <span v-if="row.range" class="bounds">
            <input
              class="num"
              type="number"
              placeholder="min"
              :value="row.range.min ?? ''"
              @mousedown="armFocus"
              @input="setBound(row.range, 'min', $event)"
              @keydown.enter="runSearch()"
            />
            <input
              class="num"
              type="number"
              placeholder="max"
              :value="row.range.max ?? ''"
              @mousedown="armFocus"
              @input="setBound(row.range, 'max', $event)"
              @keydown.enter="runSearch()"
            />
          </span>
        </label>
        <label v-for="stat in prepared.stats" :key="stat.statId + stat.label" class="filter-row">
          <input v-model="stat.enabled" type="checkbox" @change="markDirty" />
          <span
            v-if="stat.tier !== null"
            class="tier"
            :class="{ top: stat.tier === 1, good: stat.tier === 2 }"
          >
            T{{ stat.tier }}
          </span>
          <span class="stat" :class="'source-' + stat.source">{{ stat.label }}</span>
          <span class="bounds">
            <input
              class="num"
              type="number"
              placeholder="min"
              :value="stat.min ?? ''"
              @mousedown="armFocus"
              @input="setBound(stat, 'min', $event)"
              @keydown.enter="runSearch()"
            />
            <input
              class="num"
              type="number"
              placeholder="max"
              :value="stat.max ?? ''"
              @mousedown="armFocus"
              @input="setBound(stat, 'max', $event)"
              @keydown.enter="runSearch()"
            />
          </span>
        </label>
        <div v-for="line in prepared.unmatched" :key="line" class="filter-row unmatched">
          <span class="badge">?</span>
          <span>{{ line }}</span>
        </div>
      </div>

      <div v-if="outcome?.estimate && !searching" class="estimate" :class="{ stale: dirty }">
        <template v-if="anchorDiverges(outcome.estimate)">
          <!-- Every ask is far from the going rate — the rate is the honest headline. -->
          <span class="est-range">
            ≈ {{ formatExalted(outcome.estimate.anchorExalted!, outcome.estimate.divineRate) }}
          </span>
          <span class="est-market" title="aggregate market rate (poe2scout)">market rate</span>
          <span class="est-conf" :class="'conf-' + outcome.estimate.confidence">◆</span>
          <span class="est-detail">
            asks here {{ formatEstimateRange(outcome.estimate) }} · {{ estimateDetail }}
          </span>
        </template>
        <template v-else>
          <span class="est-range">≈ {{ formatEstimateRange(outcome.estimate) }}</span>
          <span class="est-conf" :class="'conf-' + outcome.estimate.confidence">◆</span>
          <span class="est-detail">{{ estimateDetail }}</span>
          <!-- Site asks and the aggregate bracket the true price from
               opposite sides — show both, the reader triangulates. -->
          <span
            v-if="outcome.estimate.anchorExalted !== undefined"
            class="est-market"
            title="aggregate market rate (poe2scout) — real trades usually land between this and the asks"
          >
            ref ~{{ formatExalted(outcome.estimate.anchorExalted, outcome.estimate.divineRate) }}
          </span>
        </template>
      </div>

      <div class="status">
        <span v-if="searching" class="busy">searching…</span>
        <span v-else-if="error" class="error">{{ error }}</span>
        <span v-else-if="dirty && !outcome" class="none">pick filters, then Search</span>
        <span v-else-if="dirty" class="none">filters changed</span>
        <template v-else-if="outcome">
          <span v-if="outcome.total === 0" class="none">
            No listings match — try unchecking filters
          </span>
          <span v-else>
            {{ outcome.total }}{{ outcome.inexact ? '+' : '' }} listed · showing
            {{ outcome.listings.length }}
          </span>
        </template>
        <span class="actions">
          <button
            v-if="!searching"
            class="tw-btn search-btn"
            :class="{ armed: dirty }"
            @click="runSearch"
          >
            Search
          </button>
          <button v-if="outcome && !searching" class="tw-btn" @click="openOnTradeSite">
            trade site ↗
          </button>
        </span>
      </div>

      <div v-if="outcome && outcome.listings.length > 0" class="listings">
        <div
          v-for="l in outcome.listings"
          :key="l.id"
          class="listing"
          :class="{ unpriceable: l.unpriceable, lowball: l.lowball }"
          :title="
            l.lowball
              ? 'far below the going rate — likely bait, not in the estimate'
              : l.unpriceable
                ? 'currency not in the estimate'
                : undefined
          "
        >
          <span class="price">
            {{ l.price ? `${l.price.amount} ${l.price.currency}` : '—' }}
          </span>
          <span v-if="l.stock !== undefined" class="stock">×{{ l.stock }}</span>
          <span class="seller">{{ l.accountName }}</span>
          <span class="age">{{ age(l.indexed) }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <pre class="raw">{{ payload.text }}</pre>
      <div class="no-item">stat database still loading — raw view</div>
    </template>
  </div>
</template>

<style scoped>
.price-check {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 340px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.title {
  min-width: 0;
}

/* Item name set in the display face — the popup's one piece of pageantry. */
.name {
  font-family: var(--tw-font-display);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.rarity-normal { color: var(--tw-rarity-normal); }
.rarity-rare { color: var(--tw-rarity-rare); }
.rarity-unique { color: var(--tw-rarity-unique); }
.rarity-magic { color: var(--tw-rarity-magic); }
.rarity-gem { color: var(--tw-rarity-gem); }
.rarity-currency { color: var(--tw-rarity-currency); }

.item-class {
  color: var(--tw-text-faint);
  margin-left: 8px;
  font-size: 11px;
}

.base {
  color: var(--tw-text-mute);
  margin-left: 8px;
  font-size: 11px;
}

.picker {
  position: relative;
  flex-shrink: 0;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid var(--tw-line);
  padding-top: 6px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  border-radius: 2px;
  padding: 1px 2px;
}

.filter-row:hover {
  background: var(--tw-bg-raised);
}

/* Socket-style checkbox: empty bronze socket, gold-lit when active. */
.filter-row input[type='checkbox'] {
  appearance: none;
  width: 11px;
  height: 11px;
  margin: 0;
  flex-shrink: 0;
  border: 1px solid var(--tw-bronze-dim);
  border-radius: 1px;
  background: var(--tw-bg-inset);
  cursor: pointer;
  transition:
    background-color 100ms ease,
    border-color 100ms ease;
}

.filter-row input[type='checkbox']:hover {
  border-color: var(--tw-bronze);
}

.filter-row input[type='checkbox']:checked {
  border-color: var(--tw-bronze-bright);
  background:
    radial-gradient(circle at 50% 50%, var(--tw-gold) 0 2.5px, transparent 3px),
    var(--tw-bg-inset);
}

.property { color: var(--tw-text-mute); }

.source-rune { color: #88ccff; }
.source-enchant { color: #b4b4ff; }
.source-implicit { color: #a0a0a0; }
.source-pseudo { color: #d4af6a; }

.stat,
.property {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Rows whose filter is off fade — checked state readable at a glance. */
.filter-row:has(input[type='checkbox']:not(:checked)) .stat,
.filter-row:has(input[type='checkbox']:not(:checked)) .property,
.filter-row:has(input[type='checkbox']:not(:checked)) .val {
  opacity: 0.55;
}

.val {
  color: var(--tw-gold);
  flex-shrink: 0;
}

.bounds {
  margin-left: auto;
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  padding-left: 8px;
}

.num {
  width: 48px;
  background: var(--tw-bg-inset);
  border: 1px solid var(--tw-line);
  border-radius: 2px;
  color: var(--tw-text);
  font: inherit;
  font-size: 12px;
  padding: 1px 5px;
  appearance: textfield;
  -moz-appearance: textfield;
  transition: border-color 120ms ease;
}

.num::-webkit-outer-spin-button,
.num::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}

.num:focus {
  outline: none;
  border-color: var(--tw-bronze);
}

.num::placeholder {
  color: var(--tw-text-faint);
}

.unmatched {
  color: #9a8a5a;
  cursor: default;
}

.unmatched:hover { background: none; }

.sale-row {
  cursor: default;
  align-items: center;
  gap: 8px;
}

.sale-row:hover { background: none; }

.badge {
  color: var(--tw-warn);
  font-weight: bold;
  width: 13px;
  text-align: center;
  flex-shrink: 0;
}

/* ---- Estimate: the hero line ------------------------------------------ */

.estimate {
  display: flex;
  align-items: baseline;
  gap: 8px;
  position: relative;
  padding-top: 8px;
  transition: opacity 150ms ease;
}

/* Hairline that brightens to bronze at the left, where the number sits. */
.estimate::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--tw-bronze-dim), var(--tw-line) 60%, transparent);
}

.est-range {
  font-family: var(--tw-font-display);
  color: var(--tw-gold);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 0 0 12px rgba(232, 200, 120, 0.25);
}

.est-conf {
  font-size: 8px;
  transform: translateY(-1px);
}

.conf-high { color: var(--tw-good); }
.conf-medium { color: var(--tw-warn); }
.conf-low { color: var(--tw-bad); }

.est-detail {
  color: var(--tw-text-mute);
  font-size: 11px;
}

/* Filters edited since this estimate was computed. */
.estimate.stale { opacity: 0.4; }

.est-market {
  color: var(--tw-bronze-bright);
  font-size: 10px;
  border: 1px solid var(--tw-bronze-dim);
  border-radius: 2px;
  padding: 0 4px;
  letter-spacing: 0.03em;
}

.rarity-label {
  margin-left: 10px;
}

.tier {
  flex-shrink: 0;
  color: var(--tw-text-mute);
  font-size: 10px;
  border: 1px solid var(--tw-line-strong);
  border-radius: 2px;
  padding: 0 3px;
  line-height: 13px;
}

/* PoE2: T1 is the top tier. */
.tier.top {
  color: var(--tw-gold);
  border-color: rgba(232, 200, 120, 0.55);
  background: rgba(232, 200, 120, 0.08);
}

.tier.good {
  color: #c9b37b;
  border-color: rgba(201, 179, 123, 0.4);
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 16px;
  color: var(--tw-text-mute);
  border-top: 1px solid var(--tw-line);
  padding-top: 6px;
  font-size: 12px;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.search-btn.armed {
  border-color: var(--tw-bronze);
  color: var(--tw-gold);
  background: var(--tw-bronze-faint);
  animation: armed-glow 2.4s ease-in-out infinite;
}

@keyframes armed-glow {
  50% {
    box-shadow: 0 0 8px rgba(208, 138, 60, 0.35);
  }
}

.busy {
  color: var(--tw-warn);
  animation: busy-pulse 1.1s ease-in-out infinite;
}

@keyframes busy-pulse {
  50% { opacity: 0.45; }
}

.error { color: var(--tw-bad); }
.none { color: var(--tw-warn); }

/* ---- Listings ledger --------------------------------------------------- */

.listings {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--tw-line);
  border-radius: 2px;
  background: var(--tw-bg-inset);
}

.listing {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 8px;
}

.listing + .listing {
  border-top: 1px solid rgba(216, 212, 203, 0.05);
}

.listing.unpriceable { opacity: 0.4; }

.listing.lowball { opacity: 0.4; }
.listing.lowball .price { text-decoration: line-through; }

.price {
  color: var(--tw-gold);
  min-width: 90px;
  font-weight: 700;
}

.stock {
  color: var(--tw-text-faint);
  flex-shrink: 0;
}

.seller {
  color: var(--tw-text-mute);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.age {
  color: var(--tw-text-faint);
  flex-shrink: 0;
  font-size: 11px;
}

.raw {
  margin: 0;
  white-space: pre-wrap;
  max-height: 50vh;
  overflow-y: auto;
  font: 12px/1.45 Consolas, monospace;
}

.no-item {
  color: var(--tw-text-mute);
  font-style: italic;
}
</style>
