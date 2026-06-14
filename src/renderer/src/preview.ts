/**
 * Browser-only preview harness: mounts the overlay UI with a mocked
 * window.tradewind and a canned item, so the design can be inspected and
 * screenshotted without PoE2 or the Electron shell running.
 *
 *   npx vite --config vite.preview.config.ts
 *   open http://localhost:5173/preview.html
 */
import type { PreparedQuery } from '../../core/query/types'
import type { SearchOutcome } from '../../core/trade/types'
import type { ItemPayload, TradewindApi } from '../../shared/ipc'

const SAMPLE_QUERY: PreparedQuery = {
  itemClass: 'Rings',
  rarity: 'Rare',
  status: 'securable',
  displayName: 'Storm Whorl',
  name: null,
  type: 'Sapphire Ring',
  exchangeId: null,
  categoryFilter: { value: 'accessory.ring', label: 'Ring', enabled: false },
  rarityOption: 'nonunique',
  baseTypeFilter: { value: 'Sapphire Ring', enabled: true },
  ilvl: { value: 81, min: null, max: null, enabled: false },
  quality: null,
  gemLevel: null,
  mapTier: null,
  corrupted: { value: false, enabled: false },
  equipment: [],
  stats: [
    {
      statId: 'explicit.stat_1',
      label: '+329 to maximum Life',
      source: 'explicit',
      tier: 1,
      value: 329,
      min: 300,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.stat_2',
      label: '+38% to Cold Resistance',
      source: 'explicit',
      tier: 2,
      value: 38,
      min: 30,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.stat_3',
      label: '+24% to Lightning Resistance',
      source: 'explicit',
      tier: 4,
      value: 24,
      min: null,
      max: null,
      enabled: false
    },
    {
      statId: 'explicit.stat_4',
      label: '21% increased Cast Speed',
      source: 'explicit',
      tier: 3,
      value: 21,
      min: null,
      max: null,
      enabled: false
    },
    {
      statId: 'rune.stat_5',
      label: '+12% to Fire Resistance (rune)',
      source: 'rune',
      tier: null,
      value: 12,
      min: null,
      max: null,
      enabled: false
    },
    {
      statId: 'pseudo.total_resistance',
      label: '+74% total Elemental Resistance',
      source: 'pseudo',
      tier: null,
      value: 74,
      min: 60,
      max: null,
      enabled: true
    }
  ],
  unmatched: ['Allocates Inner Conviction (enchant)']
}

const SAMPLE_OUTCOME: SearchOutcome = {
  searchId: 'preview',
  total: 38,
  inexact: false,
  webUrl: 'https://www.pathofexile.com/trade2/search/poe2/preview',
  listings: [
    { id: '1', price: { amount: 95, currency: 'exalted', type: '~b/o' }, accountName: 'Velkharia', indexed: iso(22), itemName: 'Storm Whorl Sapphire Ring', online: true },
    { id: '2', price: { amount: 110, currency: 'exalted', type: '~b/o' }, accountName: 'drosslicht', indexed: iso(67), itemName: 'Gale Coil Sapphire Ring', online: true },
    { id: '3', price: { amount: 40, currency: 'exalted', type: '~b/o' }, accountName: 'baitmaster_9', indexed: iso(4300), itemName: 'Doom Loop Sapphire Ring', online: true, lowball: true },
    { id: '4', price: { amount: 120, currency: 'exalted', type: '~price' }, accountName: 'Ezomyte_Trader', indexed: iso(190), itemName: 'Storm Band Sapphire Ring', online: true },
    { id: '5', price: { amount: 1, currency: 'divine', type: '~b/o' }, accountName: 'KaruiWanderer', indexed: iso(310), itemName: 'Tempest Whorl Sapphire Ring', online: true },
    { id: '6', price: { amount: 150, currency: 'exalted', type: '~b/o' }, accountName: 'Sanctum_Lord', indexed: iso(2100), itemName: 'Sky Grip Sapphire Ring', online: true },
    { id: '7', price: { amount: 3, currency: 'annul', type: '~b/o' }, accountName: 'mirror_when', indexed: iso(880), itemName: 'Vortex Loop Sapphire Ring', online: true, unpriceable: true },
    { id: '8', price: { amount: 170, currency: 'exalted', type: '~b/o' }, accountName: 'OghamReaver', indexed: iso(5900), itemName: 'Storm Knot Sapphire Ring', online: true }
  ],
  estimate: {
    lowExalted: 95,
    highExalted: 135,
    confidence: 'high',
    sampleSize: 9,
    total: 38,
    excludedCurrency: 1,
    excludedLowball: 2,
    cutoffExalted: 55,
    divineRate: 320,
    anchorExalted: 118
  }
}

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

let deliverItem: ((payload: ItemPayload) => void) | null = null
let pending: ItemPayload | null = null

const mock: TradewindApi = {
  onItem(cb) {
    deliverItem = cb
    // React registers onItem in an effect that runs after main.tsx's dynamic
    // import resolves below, so the sample item may already be queued.
    if (pending) {
      cb(pending)
      pending = null
    }
  },
  onHide() {},
  async search() {
    await new Promise((r) => setTimeout(r, 250))
    return JSON.parse(JSON.stringify(SAMPLE_OUTCOME)) as SearchOutcome
  },
  async setLeague() {},
  setPopupRect() {},
  requestFocus() {},
  openUrl(url) {
    console.log('openUrl:', url)
  }
}

window.tradewind = mock

// Stand in for the game behind the overlay so contrast is judged honestly.
document.body.style.background =
  'radial-gradient(80% 90% at 60% 30%, #3a3128 0%, #17130e 60%, #0a0806 100%)'

// ?class=Boots&rarity=Magic overrides the sample item for quick UI checks.
const params = new URLSearchParams(location.search)
SAMPLE_QUERY.itemClass = params.get('class') ?? SAMPLE_QUERY.itemClass
SAMPLE_QUERY.rarity = params.get('rarity') ?? SAMPLE_QUERY.rarity

import('./main').then(() => {
  const item: ItemPayload = {
    x: 340,
    y: 120,
    text: 'Item Class: Rings\nRarity: Rare\nStorm Whorl\nSapphire Ring\n…',
    prepared: SAMPLE_QUERY,
    leagues: ['Rise of the Abyssal', 'HC Rise of the Abyssal', 'Standard'],
    league: 'Rise of the Abyssal'
  }
  if (deliverItem) deliverItem(item)
  else pending = item
})
