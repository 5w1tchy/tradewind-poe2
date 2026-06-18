/**
 * Browser-only preview harness: mounts the overlay UI with a mocked
 * window.tradewind and a canned item, so the design can be inspected and
 * screenshotted without PoE2 or the Electron shell running.
 *
 *   npx vite --config vite.preview.config.ts
 *   open http://localhost:5173/preview.html
 */
import type { CurrencyPoint, CurrencyQuote } from '../../core/exchange'
import type { PreparedQuery } from '../../core/query/types'
import type { ListingItem, ListingMod, SearchOutcome } from '../../core/trade/types'
import type { ItemMod } from '../../core/craft/conflict'
import type { ItemPayload, TradewindApi } from '../../shared/ipc'

/** Build a tagged affix from "+329 to maximum Life P1" shorthand. */
function mod(text: string, tag: string, source = 'explicit'): ListingMod {
  return {
    text,
    affix: tag[0] === 'P' ? 'P' : tag[0] === 'S' ? 'S' : null,
    tier: Number(tag.slice(1)) || null,
    source
  }
}

/** Canned listing item detail so the hover tooltip can be inspected in preview. */
function ring(
  name: string,
  affixMods: ListingMod[],
  opts: { implicit?: string; corrupted?: boolean; runes?: string[] } = {}
): ListingItem {
  return {
    rarity: 'rare',
    name,
    baseType: 'Sapphire Ring',
    ilvl: 81,
    corrupted: opts.corrupted,
    implicitMods: opts.implicit ? [opts.implicit] : undefined,
    runeMods: opts.runes,
    affixMods
  }
}

const SAMPLE_QUERY: PreparedQuery = {
  itemClass: 'Rings',
  rarity: 'Rare',
  status: 'securable',
  displayName: 'Storm Whorl',
  name: null,
  type: 'Sapphire Ring',
  exchangeId: null,
  categoryFilter: { value: 'accessory.ring', label: 'Ring', enabled: false },
  rarityOption: 'rare',
  baseTypeFilter: { value: 'Sapphire Ring', enabled: true },
  ilvl: { value: 81, min: null, max: null, enabled: false },
  quality: null,
  gemLevel: null,
  mapTier: null,
  flags: [
    { key: 'corrupted', label: 'Corrupted', state: 'any' },
    { key: 'mirrored', label: 'Mirrored', state: 'any' },
    { key: 'sanctified', label: 'Sanctified', state: 'any' },
    { key: 'crafted', label: 'Crafted', state: 'any' },
    { key: 'fractured_item', label: 'Fractured', state: 'any' },
    { key: 'desecrated', label: 'Desecrated', state: 'any' },
    { key: 'identified', label: 'Identified', state: 'any' }
  ],
  buyout: { min: null, max: null, option: null },
  equipment: [],
  stats: [
    {
      statId: 'explicit.stat_1',
      label: '+329 to maximum Life',
      source: 'explicit',
      affix: 'prefix',
      origin: 'fractured',
      tier: 1,
      value: 329,
      // 'custom': a hand-typed min sits off the cycle (shows the • dot).
      tierMin: 300,
      smartMin: 296,
      quickMode: 'custom',
      min: 300,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.stat_2',
      label: '+38% to Cold Resistance',
      source: 'explicit',
      affix: 'suffix',
      tier: 2,
      value: 38,
      tierMin: 36,
      smartMin: 34,
      quickMode: 'smart',
      min: 34,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.stat_3',
      label: '+24% to Lightning Resistance',
      source: 'explicit',
      affix: 'suffix',
      tier: 4,
      value: 24,
      tierMin: 21,
      smartMin: 21,
      quickMode: 'smart',
      min: null,
      max: null,
      enabled: false
    },
    {
      statId: 'explicit.stat_4',
      label: '21% increased Cast Speed',
      source: 'explicit',
      affix: 'prefix',
      origin: 'crafted',
      tier: 3,
      value: 21,
      // 'tier': matched to the tier floor (shows the T glyph).
      tierMin: 18,
      smartMin: 18,
      quickMode: 'tier',
      min: 18,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.spell_damage',
      label: '16% increased Spell Damage',
      source: 'explicit',
      affix: 'prefix',
      tier: 7,
      group: 99,
      value: 16,
      tierMin: 14,
      smartMin: 14,
      quickMode: 'smart',
      min: 14,
      max: null,
      enabled: false
    },
    {
      statId: 'explicit.maximum_mana',
      label: '+17 to maximum Mana',
      source: 'explicit',
      affix: 'prefix',
      tier: 7,
      group: 99,
      value: 17,
      tierMin: 15,
      smartMin: 15,
      quickMode: 'smart',
      min: 15,
      max: null,
      enabled: false
    },
    {
      statId: 'explicit.spell_damage',
      label: '41% increased Spell Damage',
      source: 'explicit',
      affix: 'suffix',
      tier: 7,
      value: 41,
      tierMin: 36,
      smartMin: 36,
      quickMode: 'smart',
      min: 36,
      max: null,
      enabled: false
    },
    {
      statId: 'explicit.spell_damage',
      label: '57% increased Spell Damage (total)',
      source: 'explicit',
      affix: null,
      tier: null,
      summed: true,
      value: 57,
      // A summed total has no single tier floor — cycle skips "Match Tier".
      tierMin: null,
      smartMin: 51,
      quickMode: 'smart',
      min: 51,
      max: null,
      enabled: true
    },
    {
      statId: 'explicit.maximum_mana',
      label: '+17 to maximum Mana',
      source: 'explicit',
      affix: null,
      tier: null,
      value: 17,
      tierMin: 15,
      smartMin: 15,
      quickMode: 'smart',
      min: 15,
      max: null,
      enabled: true
    },
    {
      statId: 'rune.stat_5',
      label: '+12% to Fire Resistance (rune)',
      source: 'rune',
      affix: null,
      tier: null,
      value: 12,
      tierMin: null,
      smartMin: 10,
      quickMode: 'smart',
      min: null,
      max: null,
      enabled: false
    },
    {
      statId: 'pseudo.total_resistance',
      label: '+74% total Elemental Resistance',
      source: 'pseudo',
      affix: null,
      tier: null,
      value: 74,
      tierMin: null,
      smartMin: 60,
      quickMode: 'smart',
      min: 60,
      max: null,
      enabled: true
    }
  ],
  modCounts: [
    { statId: 'pseudo.pseudo_number_of_empty_prefix_mods', label: 'Open Prefix Modifiers', min: 1, max: null, enabled: true },
    { statId: 'pseudo.pseudo_number_of_empty_suffix_mods', label: 'Open Suffix Modifiers', min: null, max: null, enabled: false },
    { statId: 'pseudo.pseudo_number_of_empty_affix_mods', label: 'Open Modifiers (total)', min: null, max: null, enabled: false }
  ],
  unmatched: ['Allocates Inner Conviction (enchant)']
}

const SAMPLE_OUTCOME: SearchOutcome = {
  searchId: 'preview',
  total: 38,
  inexact: false,
  webUrl: 'https://www.pathofexile.com/trade2/search/poe2/preview',
  listings: [
    { id: '1', price: { amount: 95, currency: 'exalted', type: '~b/o' }, accountName: 'Velkharia', indexed: iso(22), itemName: 'Storm Whorl Sapphire Ring', online: true, item: ring('Storm Whorl', [mod('+312 to maximum Life', 'P1'), mod('+38% to Cold Resistance', 'S2'), mod('21% increased Cast Speed', 'S3'), mod('+25 to Intelligence', 'P4'), mod('40% increased Projectile Speed', 'P1', 'desecrated')], { implicit: '+19% to Cold Resistance', runes: ['+12% to Fire Resistance'] }) },
    { id: '2', price: { amount: 110, currency: 'exalted', type: '~b/o' }, accountName: 'drosslicht', indexed: iso(67), itemName: 'Gale Coil Sapphire Ring', online: true, item: ring('Gale Coil', [mod('+329 to maximum Life', 'P1'), mod('+45% to Cold Resistance', 'S1'), mod('+31% to Lightning Resistance', 'S2'), mod('+2 to Level of all Projectile Skills', 'P1', 'fractured')], { implicit: '+24% to Cold Resistance' }) },
    { id: '3', price: { amount: 40, currency: 'exalted', type: '~b/o' }, accountName: 'baitmaster_9', indexed: iso(4300), itemName: 'Doom Loop Sapphire Ring', online: true, lowball: true, item: ring('Doom Loop', [mod('+88 to maximum Life', 'P5'), mod('+12% to Cold Resistance', 'S4')], { implicit: '+20% to Cold Resistance' }) },
    { id: '4', price: { amount: 120, currency: 'exalted', type: '~price' }, accountName: 'Ezomyte_Trader', indexed: iso(190), itemName: 'Storm Band Sapphire Ring', online: true, item: ring('Storm Band', [mod('+305 to maximum Life', 'P1'), mod('+41% to Cold Resistance', 'S1'), mod('24% increased Cast Speed', 'S2'), mod('+14% to all Elemental Resistances', 'P2'), mod('29% increased Critical Damage Bonus', 'S2', 'crafted')], { implicit: '+22% to Cold Resistance', corrupted: true }) },
    { id: '5', price: { amount: 1, currency: 'divine', type: '~b/o' }, accountName: 'KaruiWanderer', indexed: iso(310), itemName: 'Tempest Whorl Sapphire Ring', online: true, item: ring('Tempest Whorl', [mod('+341 to maximum Life', 'P1'), mod('+48% to Cold Resistance', 'S1'), mod('28% increased Cast Speed', 'S1'), mod('+33 to Intelligence', 'P2'), mod('+11% to Chaos Resistance', 'S3')], { implicit: '+25% to Cold Resistance', runes: ['Can roll Caster modifiers', 'Bonded: 18% increased Spell Damage'] }) },
    { id: '6', price: { amount: 150, currency: 'exalted', type: '~b/o' }, accountName: 'Sanctum_Lord', indexed: iso(2100), itemName: 'Sky Grip Sapphire Ring', online: true, item: ring('Sky Grip', [mod('+298 to maximum Life', 'P2'), mod('+39% to Cold Resistance', 'S2')], { implicit: '+21% to Cold Resistance' }) },
    { id: '7', price: { amount: 3, currency: 'annul', type: '~b/o' }, accountName: 'mirror_when', indexed: iso(880), itemName: 'Vortex Loop Sapphire Ring', online: true, unpriceable: true },
    { id: '8', price: { amount: 170, currency: 'exalted', type: '~b/o' }, accountName: 'OghamReaver', indexed: iso(5900), itemName: 'Storm Knot Sapphire Ring', online: true, item: ring('Storm Knot', [mod('+335 to maximum Life', 'P1'), mod('+44% to Cold Resistance', 'S1'), mod('22% increased Cast Speed', 'S3')], { implicit: '+23% to Cold Resistance' }) }
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

// Canned currency-exchange item (Rakiata's Flow) for ?view=currency.
const SAMPLE_CURRENCY: CurrencyQuote = {
  apiId: 'rakiatas-flow',
  text: "Rakiata's Flow",
  category: 'lineagesupportgems',
  iconUrl: null,
  priceExalted: 22570,
  rates: { divine: 201.44, chaos: 19.56 }
}

const SAMPLE_HISTORY: CurrencyPoint[] = [
  [18831, 892],
  [19250, 587],
  [18544, 466],
  [18670, 772],
  [20322, 863],
  [22570, 493]
].map(([priceExalted, quantity], i) => ({
  time: new Date(Date.now() - (5 - i) * 6 * 3_600_000).toISOString(),
  priceExalted,
  quantity
}))

const CURRENCY_QUERY: PreparedQuery = {
  ...SAMPLE_QUERY,
  itemClass: 'Lineage Support Gems',
  rarity: 'Currency',
  displayName: "Rakiata's Flow",
  name: null,
  type: null,
  exchangeId: 'rakiatas-flow',
  categoryFilter: null,
  baseTypeFilter: null,
  rarityOption: null,
  ilvl: null,
  stats: [],
  modCounts: [],
  unmatched: []
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
  async getCurrencyQuote() {
    return SAMPLE_CURRENCY
  },
  async getCurrencyHistory() {
    await new Promise((r) => setTimeout(r, 200))
    return SAMPLE_HISTORY
  },
  async setLeague() {},
  setBuyoutCurrency() {},
  setPopupRect() {},
  setTooltipRect() {},
  setPinned() {},
  setPopupSize() {},
  setResultsHeight() {},
  requestFocus() {},
  releaseFocus() {},
  openUrl(url) {
    console.log('openUrl:', url)
  },
  onUpdateStatus() {},
  downloadUpdate() {},
  restartToUpdate() {},
  setToastRect() {}
}

window.tradewind = mock

// Stand in for the game behind the overlay so contrast is judged honestly.
document.body.style.background =
  'radial-gradient(80% 90% at 60% 30%, #3a3128 0%, #17130e 60%, #0a0806 100%)'

// ?class=Boots&rarity=Magic overrides the sample item for quick UI checks;
// ?class=Jewels&base=Emerald exercises the Craft tab's Liquids section (#48).
const params = new URLSearchParams(location.search)
SAMPLE_QUERY.itemClass = params.get('class') ?? SAMPLE_QUERY.itemClass
SAMPLE_QUERY.rarity = params.get('rarity') ?? SAMPLE_QUERY.rarity
const baseParam = params.get('base')
if (baseParam) SAMPLE_QUERY.baseTypeFilter = { value: baseParam, enabled: true }

const isCurrency = params.get('view') === 'currency'

// ?used=2&cap=2 exercises the essence crafted-mod cap (issue #24) on the Craft
// tab; defaults to a full single slot (blocked) so the new state is visible.
const craftedSlots = {
  used: Number(params.get('used') ?? 1),
  cap: Number(params.get('cap') ?? 1)
}

// Existing item mods + groups for the essence group-conflict gate (#72): the
// "% increased maximum Mana" mod shares MaximumManaIncreasePercent with Perfect
// Essence of the Mind, so it shows blocked. Try ?used=0 to clear the #24 cap
// block and see the gate on the listed essences.
const SAMPLE_ITEM_MODS: ItemMod[] = [
  { label: '8% increased maximum Mana', groups: ['MaximumManaIncreasePercent'] },
  { label: '+38% to Cold Resistance', groups: ['ColdResistance'] },
  { label: '16% increased Spell Damage', groups: ['SpellDamage'] }
]

import('./main').then(() => {
  const item: ItemPayload = {
    x: 340,
    y: 120,
    text: 'Item Class: Rings\nRarity: Rare\nStorm Whorl\nSapphire Ring\n…',
    prepared: isCurrency ? CURRENCY_QUERY : SAMPLE_QUERY,
    craftedSlots: isCurrency ? null : craftedSlots,
    itemMods: isCurrency ? null : SAMPLE_ITEM_MODS,
    currency: isCurrency ? SAMPLE_CURRENCY : null,
    leagues: ['Rise of the Abyssal', 'HC Rise of the Abyssal', 'Standard'],
    league: 'Rise of the Abyssal',
    popupSize: { w: 520, h: 560 },
    resultsHeight: 200,
    currencyIcons: {
      exalted:
        'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lBZGRNb2RUb1JhcmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/ad7c366789/CurrencyAddModToRare.png',
      divine:
        'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lNb2RWYWx1ZXMiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/2986e220b3/CurrencyModValues.png',
      chaos:
        'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwic2NhbGUiOjEsInJlYWxtIjoicG9lMiJ9XQ/c0ca392a78/CurrencyRerollRare.png'
    }
  }
  if (deliverItem) deliverItem(item)
  else pending = item
})
