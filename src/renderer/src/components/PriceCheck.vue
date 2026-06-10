<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PreparedQuery, PreparedRange, PreparedStatFilter } from '../../../core/query/types'
import type { SearchOutcome } from '../../../core/trade/types'
import type { ItemPayload } from '../../../shared/ipc'

const props = defineProps<{ payload: ItemPayload }>()

const prepared = ref<PreparedQuery | null>(null)
const league = ref('')
const outcome = ref<SearchOutcome | null>(null)
const searching = ref(false)
const error = ref<string | null>(null)
const leagueOpen = ref(false)
let searchToken = 0
let debounce: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.payload,
  (p) => {
    // Deep-copy: the popup edits filters freely, IPC needs a plain object anyway.
    prepared.value = p.prepared ? (JSON.parse(JSON.stringify(p.prepared)) as PreparedQuery) : null
    league.value = p.league
    outcome.value = null
    error.value = null
    leagueOpen.value = false
    if (prepared.value) void runSearch()
  },
  { immediate: true }
)

async function runSearch(): Promise<void> {
  if (!prepared.value) return
  const token = ++searchToken
  searching.value = true
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

/** Re-search shortly after the last filter click so rapid toggles batch up. */
function queueSearch(): void {
  clearTimeout(debounce)
  debounce = setTimeout(() => void runSearch(), 350)
}

function pickLeague(id: string): void {
  leagueOpen.value = false
  if (id === league.value) return
  league.value = id
  void window.tradewind.setLeague(id)
  void runSearch()
}

interface ToggleRow {
  label: string
  model: { enabled: boolean }
}

const propertyRows = computed<ToggleRow[]>(() => {
  const q = prepared.value
  if (!q) return []
  const rows: ToggleRow[] = []
  const add = (name: string, r: PreparedRange | null, unit = ''): void => {
    if (!r) return
    const label =
      r.max !== null && r.max === r.min
        ? `${name} = ${r.value}${unit}`
        : `${name} ≥ ${r.min ?? r.value}${unit}`
    rows.push({ label, model: r })
  }
  add('Waystone Tier', q.mapTier)
  add('Gem Level', q.gemLevel)
  add('Item Level', q.ilvl)
  add('Quality', q.quality, '%')
  if (q.corrupted) {
    rows.push({ label: q.corrupted.value ? 'Corrupted' : 'Not Corrupted', model: q.corrupted })
  }
  return rows
})

function statHint(stat: PreparedStatFilter): string {
  if (stat.min === null && stat.max === null) return ''
  if (stat.max !== null && stat.max === stat.min) return `= ${stat.min}`
  return `≥ ${stat.min}`
}

function openOnTradeSite(): void {
  if (outcome.value) window.tradewind.openUrl(outcome.value.webUrl)
}

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
        <span class="item-class">{{ prepared?.itemClass }}</span>
      </div>
      <div class="league">
        <button class="league-btn" @click="leagueOpen = !leagueOpen">{{ league }} ▾</button>
        <ul v-if="leagueOpen" class="league-list">
          <li v-for="id in payload.leagues" :key="id">
            <button :class="{ active: id === league }" @click="pickLeague(id)">{{ id }}</button>
          </li>
        </ul>
      </div>
    </div>

    <template v-if="prepared">
      <div class="filters">
        <label v-for="row in propertyRows" :key="row.label" class="filter-row">
          <input v-model="row.model.enabled" type="checkbox" @change="queueSearch" />
          <span class="property">{{ row.label }}</span>
        </label>
        <label v-for="stat in prepared.stats" :key="stat.statId + stat.label" class="filter-row">
          <input v-model="stat.enabled" type="checkbox" @change="queueSearch" />
          <span class="stat" :class="'source-' + stat.source">{{ stat.label }}</span>
          <span class="hint">{{ statHint(stat) }}</span>
        </label>
        <div v-for="line in prepared.unmatched" :key="line" class="filter-row unmatched">
          <span class="badge">?</span>
          <span>{{ line }}</span>
        </div>
      </div>

      <div class="status">
        <span v-if="searching" class="busy">searching…</span>
        <span v-else-if="error" class="error">{{ error }}</span>
        <template v-else-if="outcome">
          <span v-if="outcome.total === 0" class="none">
            No listings match — try unchecking filters
          </span>
          <span v-else>
            {{ outcome.total }}{{ outcome.inexact ? '+' : '' }} listed · showing
            {{ outcome.listings.length }}
          </span>
        </template>
        <button v-if="outcome && !searching" class="web-btn" @click="openOnTradeSite">
          trade site ↗
        </button>
      </div>

      <div v-if="outcome && outcome.listings.length > 0" class="listings">
        <div v-for="l in outcome.listings" :key="l.id" class="listing">
          <span class="price">
            {{ l.price ? `${l.price.amount} ${l.price.currency}` : '—' }}
          </span>
          <span class="seller">{{ l.accountName }}</span>
          <span class="age">{{ age(l.indexed) }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <pre v-if="payload.text" class="raw">{{ payload.text }}</pre>
      <div v-else class="no-item">No item under cursor</div>
      <div v-if="payload.text" class="no-item">stat database still loading — raw view</div>
    </template>
  </div>
</template>

<style scoped>
.price-check {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 320px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid rgba(175, 96, 37, 0.35);
  padding-bottom: 6px;
}

.name {
  font-size: 13px;
  font-weight: bold;
}

.rarity-rare { color: #ffff77; }
.rarity-unique { color: #af6025; }
.rarity-magic { color: #8888ff; }
.rarity-gem { color: #1ba29b; }
.rarity-currency { color: #aa9e82; }

.item-class {
  color: #8a8782;
  margin-left: 8px;
  font-size: 11px;
}

.league {
  position: relative;
}

.league-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  color: #d6d3cd;
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}

.league-list {
  position: absolute;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: 2px;
  list-style: none;
  background: rgba(24, 24, 28, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  z-index: 10;
  white-space: nowrap;
}

.league-list button {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: #d6d3cd;
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}

.league-list button:hover { background: rgba(255, 255, 255, 0.08); }
.league-list button.active { color: #af6025; }

.filters {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.filter-row input {
  accent-color: #af6025;
  margin: 0;
  flex-shrink: 0;
}

.property { color: #b8b6b0; }

.source-rune { color: #88ccff; }
.source-enchant { color: #b4b4ff; }
.source-implicit { color: #a0a0a0; }

.hint {
  color: #6f6c66;
  margin-left: auto;
  padding-left: 8px;
}

.unmatched {
  color: #9a8a5a;
  cursor: default;
}

.badge {
  color: #c0a040;
  font-weight: bold;
  width: 13px;
  text-align: center;
  flex-shrink: 0;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 14px;
  color: #8a8782;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 6px;
}

.web-btn {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  color: #d6d3cd;
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.web-btn:hover {
  border-color: rgba(175, 96, 37, 0.7);
  color: #e8c878;
}

.busy { color: #c0a040; }
.error { color: #d05050; }
.none { color: #c0a040; }

.listings {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 220px;
  overflow-y: auto;
}

.listing {
  display: flex;
  gap: 10px;
  padding: 2px 4px;
  border-radius: 3px;
}

.listing:nth-child(odd) { background: rgba(255, 255, 255, 0.03); }

.price {
  color: #e8c878;
  min-width: 90px;
  font-weight: bold;
}

.seller {
  color: #8a8782;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.age {
  color: #6f6c66;
  flex-shrink: 0;
}

.raw {
  margin: 0;
  white-space: pre-wrap;
  max-height: 50vh;
  overflow-y: auto;
}

.no-item {
  color: #8a8782;
  font-style: italic;
}
</style>
