/**
 * Generate src/core/craft/essences.json from poe2db's Essence page.
 *
 *   node scripts/gen-essences.mjs [path-to-saved-essence.html]
 *
 * poe2db renders client data we can't get from repoe-fork (the essence ->
 * guaranteed-mod table per item category). Re-run after PoE2 patches; the
 * output is committed so the app never scrapes at runtime.
 *
 * Each guaranteed mod is additionally tagged with its `groups` (mod-group
 * exclusivity) and `affix` (prefix/suffix), joined from repoe-fork's mod dump
 * (the same `mods.min.json` gen-mod-pool reads). This is what lets the Craft
 * tab gate essences/alloys that the game would block: two mods can never share
 * a group, and since an "augment a Rare" essence/alloy removes a *random* mod,
 * the game blocks it outright when the item already has a mod in the guaranteed
 * mod's group. The join is best-effort: if the dump can't be loaded the scrape
 * still succeeds, just without group tags.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const URL = 'https://poe2db.tw/us/Essence'
const REPOE_URL = 'https://repoe-fork.github.io/poe2'
const SCRATCH = new globalThis.URL('../scratch/', import.meta.url)
const OUT = new globalThis.URL('../src/core/craft/essences.json', import.meta.url)
const ICON_DIR = new globalThis.URL('../src/renderer/src/assets/essences/', import.meta.url)

const html = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : await (await fetch(URL, { headers: { 'User-Agent': 'tradewind-gen/0.0.1' } })).text()

// --- repoe-fork mod dump: scratch/mods.min.json if present, else fetched.
// Mirrors gen-mod-pool.mjs's loader so the two stay in sync.
async function loadMods() {
  const local = new globalThis.URL('mods.min.json', SCRATCH)
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'))
  const res = await fetch(`${REPOE_URL}/mods.min.json`, {
    headers: { 'User-Agent': 'tradewind-gen/0.0.1' }
  })
  if (!res.ok) throw new Error(`mods.min.json: HTTP ${res.status}`)
  return res.json()
}

// --- Mod-group join -------------------------------------------------------
// repoe text carries "[Display|key]" link markup; collapse it like
// gen-mod-pool. We match poe2db's display text to a dump mod by an
// order-independent word multiset (hybrid mods list their two lines in a
// different order on poe2db vs the dump) and unglue poe2db's occasional
// missing space between concatenated hybrid lines ("Cast SpeedGain…").
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
const rollable = (m) => (m.spawn_weights ?? []).some((w) => w.weight > 0)

function buildModIndex(mods) {
  const idx = new Map()
  for (const k in mods) {
    const m = mods[k]
    // Only gear mods can collide with a hovered item's affixes; the same text
    // in jewel/sanctum/expedition domains is a different mod we must ignore.
    if (!m.text || m.domain !== 'item') continue
    if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue
    const key = wordKey(m.text)
    if (!key) continue
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push({
      groups: m.groups ?? [],
      affix: m.generation_type,
      br: brackets(m.text),
      roll: rollable(m)
    })
  }
  return idx
}

const groupSet = (cands) => new Set(cands.map((c) => c.groups.join('+')))

// Resolve a scraped mod's groups + affix. Single group-set wins outright;
// otherwise the guaranteed mod's *exact roll range* pins the specific tier,
// which usually resolves the prefix/suffix family on its own — e.g. a (15-18)%
// Rarity essence is the suffix mod (group ItemFoundRarityIncrease); the prefix
// family's neighbouring tier is (16-19), so the bracket is unique. We match the
// bracket FIRST because the granted mod can be a normally rollable one (rarity),
// for which the non-rollable preference below would discard the right candidate.
// Only if the bracket is still split do we prefer the *non-rollable* candidate
// (an essence/alloy-only mod has empty spawn weights, disambiguating it from a
// same-text normal roll). When even that leaves it split we return the union of
// groups (a genuine exclusivity pair — blocking on either is the safe default)
// with a null affix.
function resolveGroups(text) {
  if (!modIndex) return { groups: [], affix: null }
  const cands = modIndex.get(wordKey(text))
  if (!cands) return { groups: [], affix: null, miss: true }
  let pool = cands
  if (groupSet(pool).size > 1) {
    const mb = brackets(text)
    const bm = pool.filter((c) => c.br === mb)
    if (bm.length) pool = bm
  }
  if (groupSet(pool).size > 1) {
    const deliberate = pool.filter((c) => !c.roll)
    if (deliberate.length) pool = deliberate
  }
  if (groupSet(pool).size === 1) return { groups: pool[0].groups, affix: pool[0].affix }
  const union = [...new Set(pool.flatMap((c) => c.groups))]
  return { groups: union, affix: null, ambiguous: true }
}

let modIndex = null
try {
  modIndex = buildModIndex(await loadMods())
} catch (err) {
  console.warn(`Skipping group tags — couldn't load mod dump: ${err.message}`)
}

/** Strip tags, decode the entities poe2db actually uses, squeeze whitespace. */
function clean(fragment) {
  return fragment
    .replace(/<span class="ndash">—<\/span>/g, '–')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

// Each essence card links its base-item metadata id; cards live in the
// "Essence" tab pane. Split on the card cells and parse each independently.
const pane = html.slice(html.indexOf('<div id="Essence"'), html.indexOf('<div id="EssenceStashTab"'))
const cards = pane.split('<div class="col">').slice(1)

const essences = []
const joinMisses = []
const joinAmbiguous = []
for (const card of cards) {
  const id = card.match(/Currency%2F(Currency[A-Za-z0-9]+)/)?.[1]
  const name = clean(card.match(/height="16" \/>([^<]+)<\/a>/)?.[1] ?? '')
  if (!id || !name) continue
  const iconUrl = card.match(/<img loading="lazy" src="(https:\/\/cdn\.poe2db\.tw\/[^"]+\.webp)"/)?.[1]

  const modLines = [...card.matchAll(/<div class="explicitMod">(.*?)<\/div>/gs)].map((m) =>
    clean(m[1])
  )
  if (modLines.length === 0) continue

  // First explicitMod is the behavior sentence; the rest are
  // "Category[, Category…]: mod text" lines.
  const [behavior, ...rest] = modLines
  const mods = []
  for (const line of rest) {
    const m = line.match(/^([A-Za-z][A-Za-z, ]*?): (.+)$/)
    let entry
    if (m) {
      // "Belt, Boots, Gloves, Helmet or Jewellery" -> individual tokens.
      const targets = m[1].split(/,| or /).map((t) => t.trim()).filter(Boolean)
      entry = { targets, text: m[2] }
    } else {
      entry = { targets: ['Any'], text: line }
    }
    const { groups, affix, miss, ambiguous } = resolveGroups(entry.text)
    entry.groups = groups
    entry.affix = affix
    if (miss) joinMisses.push(`${name} [${entry.targets.join('/')}] ${entry.text}`)
    else if (ambiguous)
      joinAmbiguous.push(`${name} [${entry.targets.join('/')}] ${entry.text} -> ${groups.join('+')}`)
    mods.push(entry)
  }

  essences.push({ id, name, behavior, mods, iconUrl })
}

if (essences.length < 50) {
  console.error(`Parsed only ${essences.length} essences — page layout changed?`)
  process.exit(1)
}

// Surface the distinct target tokens so the item-class mapping in
// essences.ts can be kept in sync by eye.
const tokens = new Set()
for (const e of essences) for (const m of e.mods) for (const t of m.targets) tokens.add(t)

// Bundle the item art locally: the overlay's CSP (img-src 'self') is right
// for an app that reads the game's screen, so no CDN hotlinking at runtime.
mkdirSync(ICON_DIR, { recursive: true })
let downloaded = 0
for (const e of essences) {
  if (!e.iconUrl) continue
  const file = new globalThis.URL(`${e.id}.webp`, ICON_DIR)
  if (!existsSync(file)) {
    // Some files 403 without a Referer (hotlink protection).
    const res = await fetch(e.iconUrl, {
      headers: { 'User-Agent': 'tradewind-gen/0.0.1', Referer: URL }
    })
    if (!res.ok) {
      console.warn(`icon ${e.id}: HTTP ${res.status}`)
      continue
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    downloaded++
    await new Promise((r) => setTimeout(r, 150))
  }
  e.icon = `${e.id}.webp`
}
for (const e of essences) delete e.iconUrl

writeFileSync(OUT, JSON.stringify({ generatedFrom: URL, essences }, null, 1))
console.log(`Wrote ${essences.length} essences, downloaded ${downloaded} icons.`)
console.log('Target tokens:', [...tokens].sort().join(' | '))

if (modIndex) {
  const totalMods = essences.reduce((n, e) => n + e.mods.length, 0)
  const tagged = essences.reduce(
    (n, e) => n + e.mods.filter((m) => m.groups.length).length,
    0
  )
  console.log(
    `Group tags: ${tagged}/${totalMods} mods tagged ` +
      `(${joinAmbiguous.length} ambiguous→union, ${joinMisses.length} no match).`
  )
  // Special mods with no normal group (choose-an-attribute, "Mark of the
  // Abyssal Lord", passive allocation) legitimately have none — these warnings
  // are for review after a patch, not failures.
  for (const m of joinMisses) console.warn(`  no group: ${m}`)
  for (const m of joinAmbiguous) console.warn(`  ambiguous: ${m}`)
}
