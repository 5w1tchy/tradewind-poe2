/**
 * Generate src/core/craft/liquids.json from poe2db's Liquid Emotions page.
 *
 *   node scripts/gen-liquids.mjs [path-to-saved-Liquid_Emotions.html]
 *
 * Liquid Emotions (PoE2 0.5; formerly Distilled Emotions) double as an
 * essence-like jewel crafting currency: applied to a Rare jewel they remove a
 * random modifier and augment it with a guaranteed crafted mod. The mod a
 * liquid grants depends on the jewel's GEM base (Ruby/Sapphire/Emerald/Diamond)
 * and on whether the jewel is a Basic or a Time-Lost jewel — poe2db is the only
 * source for that per-gem table. Re-run after PoE2 patches; output is committed
 * so the app never scrapes at runtime (the overlay CSP is img-src 'self').
 *
 * This mirrors gen-essences.mjs but the poe2db layout differs: the Essence page
 * keys mods by item category ("Boots: …"); the Liquid page keys them by gem +
 * affix slot ("Ruby Prefix: …") and states the target jewel family in the
 * behavior sentence ("…Augments a Rare Basic Jewel…" vs "…Time-Lost Jewel…").
 *
 * Each guaranteed mod is additionally tagged with its `groups` (mod-group
 * exclusivity), joined from repoe-fork's mod dump — but from the **'misc'**
 * domain, where jewel mods live (gear is 'item'). This is what lets the Craft
 * tab gate a liquid the game would block: two mods can't share a group, and a
 * liquid removes a *random* mod then stamps a guaranteed one, so it's refused
 * when the jewel already has a mod in the guaranteed mod's group (the jewel twin
 * of the essence gate, #78). Best-effort: Time-Lost "Passive Skills in Radius
 * also grant …" mods are absent from the dump, so they stay untagged (no block).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const URL = 'https://poe2db.tw/us/Liquid_Emotions'
const REPOE_URL = 'https://repoe-fork.github.io/poe2'
const SCRATCH = new globalThis.URL('../scratch/', import.meta.url)
const OUT = new globalThis.URL('../src/core/craft/liquids.json', import.meta.url)
const ICON_DIR = new globalThis.URL('../src/renderer/src/assets/liquids/', import.meta.url)

const html = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : await (await fetch(URL, { headers: { 'User-Agent': 'tradewind-gen/0.0.1' } })).text()

// --- repoe-fork mod dump: scratch/mods.min.json if present, else fetched.
async function loadMods() {
  const local = new globalThis.URL('mods.min.json', SCRATCH)
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'))
  const res = await fetch(`${REPOE_URL}/mods.min.json`, {
    headers: { 'User-Agent': 'tradewind-gen/0.0.1' }
  })
  if (!res.ok) throw new Error(`mods.min.json: HTTP ${res.status}`)
  return res.json()
}

// --- Jewel mod-group join (mirrors gen-essences, but indexes the 'misc' domain
// where jewel mods live, and uses the liquid's *known* prefix/suffix slot to
// disambiguate). repoe text carries "[Display|key]" link markup; collapse it.
const resolveLinks = (t) =>
  t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
const camelSplit = (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2')
const wordKey = (t) =>
  camelSplit(resolveLinks(t))
    .toLowerCase()
    .replace(/[\d.]+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
const brackets = (t) => {
  const out = []
  for (const m of resolveLinks(t).matchAll(/\((-?[\d.]+)[-–](-?[\d.]+)\)|(-?[\d.]+)/g)) {
    out.push(m[1] !== undefined ? Number(m[1]) : Number(m[3]))
  }
  return out.sort((a, b) => a - b).join(',')
}

function buildJewelIndex(mods) {
  const idx = new Map()
  for (const k in mods) {
    const m = mods[k]
    if (!m.text || m.domain !== 'misc') continue
    if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue
    if (!m.groups?.length) continue
    const key = wordKey(m.text)
    if (!key) continue
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push({ groups: m.groups, affix: m.generation_type, br: brackets(m.text) })
  }
  return idx
}

const groupSet = (cands) => new Set(cands.map((c) => c.groups.join('+')))

// Resolve a liquid mod's groups, using its known affix slot then the roll
// bracket to disambiguate. Returns [] (and flags a miss) when the text isn't a
// known jewel mod — Time-Lost passive-grant mods, which aren't in the dump.
function resolveGroups(text, affix, idx) {
  if (!idx) return { groups: [] }
  const cands = idx.get(wordKey(text))
  if (!cands) return { groups: [], miss: true }
  let pool = cands
  const byAffix = pool.filter((c) => c.affix === affix)
  if (byAffix.length) pool = byAffix
  if (groupSet(pool).size > 1) {
    const bm = pool.filter((c) => c.br === brackets(text))
    if (bm.length) pool = bm
  }
  return { groups: [...new Set(pool.flatMap((c) => c.groups))] }
}

let jewelIndex = null
try {
  jewelIndex = buildJewelIndex(await loadMods())
} catch (err) {
  console.warn(`Skipping group tags — couldn't load mod dump: ${err.message}`)
}

/** Strip tags, drop poe2db's secondary tooltip spans (e.g. the "local jewel
 *  effect base radius [500]" gloss glued onto "Upgrades Radius"), decode the
 *  entities the page uses, squeeze whitespace. */
function clean(fragment) {
  return fragment
    .replace(/<span class="ndash">—<\/span>/g, '–')
    .replace(/<span class="secondary">.*?<\/span>/gs, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// The jewel-crafting liquids live in the "Liquid Item" tab pane; the page's
// other tabs are amulet-instilling passives (out of scope, issue #48).
const pane = html.slice(html.indexOf('id="LiquidItem"'), html.indexOf('id="DistilledEmotionRef"'))
const cards = pane.split('<div class="col">').slice(1)

const GEMS = ['Ruby', 'Sapphire', 'Emerald', 'Diamond']

const liquids = []
const joinMisses = []
for (const card of cards) {
  const name = clean(card.match(/height="16" \/>([^<]+)<\/a>/)?.[1] ?? '')
  if (!name) continue
  const iconUrl = card.match(/<img loading="lazy" src="(https:\/\/cdn\.poe2db\.tw\/[^"]+\.webp)"/)?.[1]

  const modLines = [...card.matchAll(/<div class="explicitMod">(.*?)<\/div>/gs)]
    .map((m) => clean(m[1]))
    .filter((line) => line && line !== '&nbsp')
  if (modLines.length === 0) continue

  // First explicitMod is the behavior sentence; it names the target jewel
  // family. The rest are "<Gem> <Prefix|Suffix>: <mod text>" lines.
  const [behavior, ...rest] = modLines
  const target = /Time-Lost/.test(behavior) ? 'time-lost' : 'basic'

  const mods = []
  for (const line of rest) {
    const m = line.match(/^(Ruby|Sapphire|Emerald|Diamond) (Prefix|Suffix): (.+)$/)
    if (!m) {
      console.warn(`${name}: unparsed mod line "${line}"`)
      continue
    }
    const affix = m[2].toLowerCase()
    const { groups, miss } = resolveGroups(m[3], affix, jewelIndex)
    if (miss) joinMisses.push(`${name} [${m[1]} ${affix}] ${m[3]}`)
    mods.push({ gem: m[1], affix, text: m[3], groups })
  }
  if (mods.length === 0) continue

  liquids.push({
    id: slug(name),
    name,
    target,
    potent: /\bPotent\b/.test(name),
    mods,
    iconUrl
  })
}

if (liquids.length < 20) {
  console.error(`Parsed only ${liquids.length} liquids — page layout changed?`)
  process.exit(1)
}

const badGem = new Set()
for (const l of liquids) for (const m of l.mods) if (!GEMS.includes(m.gem)) badGem.add(m.gem)
if (badGem.size) console.warn('Unexpected gem tokens:', [...badGem].join(', '))

// Bundle the item art locally (overlay CSP is img-src 'self' — no CDN hotlink).
mkdirSync(ICON_DIR, { recursive: true })
let downloaded = 0
for (const l of liquids) {
  if (!l.iconUrl) continue
  const file = new globalThis.URL(`${l.id}.webp`, ICON_DIR)
  if (!existsSync(file)) {
    // Some files 403 without a Referer (hotlink protection).
    const res = await fetch(l.iconUrl, {
      headers: { 'User-Agent': 'tradewind-gen/0.0.1', Referer: URL }
    })
    if (!res.ok) {
      console.warn(`icon ${l.id}: HTTP ${res.status}`)
      continue
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    downloaded++
    await new Promise((r) => setTimeout(r, 150))
  }
  l.icon = `${l.id}.webp`
}
for (const l of liquids) delete l.iconUrl

writeFileSync(OUT, JSON.stringify({ generatedFrom: URL, liquids }, null, 1))
console.log(`Wrote ${liquids.length} liquids, downloaded ${downloaded} icons.`)
const byTarget = liquids.reduce((a, l) => ((a[l.target] = (a[l.target] ?? 0) + 1), a), {})
console.log('By target:', byTarget)

if (jewelIndex) {
  const total = liquids.reduce((n, l) => n + l.mods.length, 0)
  const tagged = liquids.reduce((n, l) => n + l.mods.filter((m) => m.groups.length).length, 0)
  console.log(`Group tags: ${tagged}/${total} mods tagged (${joinMisses.length} no match).`)
  // Expected misses are Time-Lost "Passive Skills in Radius also grant …" mods,
  // which aren't in the dump — these warnings are for post-patch review.
  for (const m of joinMisses) console.warn(`  no group: ${m}`)
}
